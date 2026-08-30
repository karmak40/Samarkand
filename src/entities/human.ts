import {
  ENEMY_TIER_SCALING,
  HUMAN_ARCHETYPES,
  INQUISITOR_ABILITIES,
  KHAGAN_ABILITIES,
  PYROMANCER_ABILITIES,
  WARLORD_ABILITIES,
} from '../balance';
import { type DamagePacket, type DamageResult, type Defenses, type DamageType } from '../combat/damage';
import { type StatusApplication } from '../combat/status';
import { angleDelta, clamp, damp, dist2, TAU } from '../core/math';
import { t } from '../i18n';
import { drawGroundShadow } from '../render/shadow';
import type { World } from '../world/world';
import type { Building } from './building';
import { Combatant, type DeathContext } from './entity';

export type HumanRole = 'civilian' | 'melee' | 'ranged' | 'support' | 'turret' | 'boss';

export type HumanId =
  | 'peasant'
  | 'militia'
  | 'archer'
  | 'spearman'
  | 'crossbowman'
  | 'torchbearer'
  | 'priest'
  | 'knight'
  | 'ballista'
  | 'rider'
  | 'siegeEngine'
  | 'inquisitor'
  | 'warlord'
  | 'pyromancer'
  | 'khagan';

/** Every boss the first biome's run can end on. One is drawn per run from the seed. */
export const BOSS_IDS = ['inquisitor', 'warlord', 'pyromancer'] as const;

export type BossId = (typeof BOSS_IDS)[number];

export interface HumanArchetype {
  readonly id: HumanId;
  readonly name: string;
  readonly role: HumanRole;
  /** Balance-file toggle: false removes this unit from the random spawn pool. */
  readonly enabled: boolean;
  readonly hp: number;
  readonly armor: number;
  readonly resist: Partial<Record<DamageType, number>>;
  readonly speed: number;
  readonly radius: number;
  /** Damage of a single attack, before difficulty scaling. */
  readonly damage: DamagePacket[];
  readonly attackRange: number;
  /** Distance the AI tries to hold. Melee units use attackRange instead. */
  readonly preferredRange: number;
  readonly attackCooldown: number;
  /** Telegraph before the hit lands. */
  readonly windup: number;
  readonly recover: number;
  readonly souls: number;
  readonly knockbackResist: number;
  /** Base colours: tunic, skin, metal. */
  readonly tunic: string;
  readonly accent: string;
  /** Applied to the monster on a successful hit. */
  readonly onHitStatuses?: StatusApplication[];
  /** Weight in the spawn table; 0 means "never rolled randomly". */
  readonly spawnWeight: number;
  /** Earliest room index *within its biome* this unit can appear in. */
  readonly minDepth: number;
  /**
   * Earliest biome this unit can appear in. Omitted means every biome — most units
   * predate the war-camp and have nothing biome-specific about them. Kept separate
   * from `minDepth` because a biome picked directly from the menu restarts the depth
   * count from 0, and a war-camp specialist must still show up on room 1 of it.
   */
  readonly minBiome?: 1 | 2;
  /** Chance to drop a blood (healing) orb. */
  readonly bloodChance: number;
  /** Chance this unit drops a relic granting a temporary form. */
  readonly relicChance: number;
  readonly courage: number;
}

// The actual roster (stats, damage, spawn gating, ...) lives in `../balance` now —
// re-exporting it keeps every existing `from './human'` / `from '../entities/human'`
// import working unchanged.
export { HUMAN_ARCHETYPES };

type AiState = 'idle' | 'approach' | 'windup' | 'recover' | 'reposition' | 'flee' | 'stunned';

/**
 * A human defender. One class, one state machine; the archetype table decides how
 * it behaves. Civilians flee, melee closes, ranged kites, support heals — all driven
 * by `role` plus a couple of per-archetype numbers.
 */
export class Human extends Combatant {
  readonly archetype: HumanArchetype;
  /** Scales HP and damage with room depth. */
  readonly tier: number;

  private state: AiState = 'idle';
  private stateTimer = 0;
  private attackCooldown = 0;
  /** Direction the unit is facing; visual only, damped toward movement/target. */
  private facing = 0;
  /** Wander target used when the monster is out of sight. */
  private wanderX = 0;
  private wanderY = 0;
  private wanderTimer = 0;
  /** Set once the unit has noticed the monster; alerted units never calm down. */
  private alerted = false;
  private alertDelay = 0;

  /** Panic level 0..1, from fear status or watching allies die. */
  private panic = 0;
  /** Seconds spent running away, used for the stamina cycle and for giving up. */
  private fleeTime = 0;
  /** Seconds since this unit last managed to swing or shoot. */
  private timeSinceAttack = 0;
  /** Seconds left of a stalemate-breaking charge straight at the monster. */
  private charging = 0;
  /** Edge-detects the freeze status so the ice sound plays once, not every frame. */
  private wasFrozen = false;

  // --- obstacle avoidance ---------------------------------------------------
  /** Seconds spent trying to move but going nowhere (walking into a wall). */
  private blockedTime = 0;
  /** While positive, steering is rotated 90° to slide around the obstruction. */
  private avoidTimer = 0;
  private avoidDir = 1;

  /** Animation phase for the walk cycle. */
  private stride = 0;
  private windupProgress = 0;

  /** Boss-only: seconds until the next special ability. */
  private specialTimer = 6;
  private specialIndex = 0;

  untargetable = false;

  /**
   * The tower/wall this unit is stationed on, for turrets paired with a watchtower
   * or stronghold. While it stands, hits meant for this unit are redirected to the
   * structure instead — break the wall before the archer on it is actually
   * vulnerable. Cleared automatically once the structure falls (see `Projectile`).
   */
  mountedOn: Building | null = null;

  constructor(id: HumanId, x: number, y: number, tier: number) {
    super();
    const archetype = HUMAN_ARCHETYPES[id];
    this.archetype = archetype;
    this.tier = tier;
    this.x = x;
    this.y = y;
    this.faction = 'human';
    this.radius = archetype.radius;

    // Depth scaling tuned in ../balance's ENEMY_TIER_SCALING. Was 18%/11% HP/damage —
    // that pace made the mid-run rooms (where the enemy count is also ramping up)
    // spike much harder than the player's own growth could keep up with.
    const hpScale = Math.pow(ENEMY_TIER_SCALING.hpPerTier, tier);
    this.maxHp = archetype.hp * hpScale;
    this.hp = this.maxHp;

    this.wanderX = x;
    this.wanderY = y;
    this.alertDelay = 0.1 + Math.random() * 0.5;
  }

  get damageScale(): number {
    return Math.pow(ENEMY_TIER_SCALING.damagePerTier, this.tier);
  }

  override defenses(): Defenses {
    return {
      armor: this.archetype.armor * (1 + this.tier * ENEMY_TIER_SCALING.armorPerTier),
      resist: this.archetype.resist,
      dodge: 0,
      vulnerability: 1,
    };
  }

  protected override knockbackResistance(): number {
    return this.archetype.knockbackResist;
  }

  protected override onDamaged(world: World, result: DamageResult): void {
    // Getting hit alerts the unit instantly, and rattles the timid ones.
    this.alerted = true;
    this.alertDelay = 0;

    const shock = result.total / this.maxHp;
    this.panic = clamp(this.panic + shock * (1.4 - this.archetype.courage), 0, 1);

    // A big hit interrupts a wind-up: the player is rewarded for pre-empting attacks.
    if (this.state === 'windup' && shock > 0.12 && this.archetype.role !== 'boss') {
      this.state = 'stunned';
      this.stateTimer = 0.25;
    }

    world.decals.splatter(this.x, this.y, result.total * 0.4);
  }

  protected override onDeath(world: World, ctx: DeathContext): void {
    const a = this.archetype;

    world.tracker.recordKill(a.id, a.name, ctx.sourceLabel, ctx.overkill);
    world.sound.kill(this, Math.min(1, this.maxHp / 400));

    world.particles.emit({
      count: a.role === 'boss' ? 60 : 14,
      x: this.x,
      y: this.y,
      color: '#7d1418',
      shape: 'blob',
      speed: [70, 300],
      size: [2, 6],
      life: [0.3, 0.8],
      gravity: 400,
    });
    world.decals.splatter(this.x, this.y, 40 + this.maxHp * 0.1);

    world.spawnPickup('soul', this.x, this.y, a.souls * (1 + this.tier * 0.1));
    if (world.rng.next() < a.bloodChance) {
      world.spawnPickup('blood', this.x, this.y, 6 + this.tier);
    }
    // Champions carry relics. Killing the knight is worth the risk beyond its souls.
    if (a.relicChance > 0 && world.rng.next() < a.relicChance) {
      world.spawnBoon(this.x, this.y);
    }

    if (a.role === 'boss') world.camera.shake(16);

    // Nearby survivors witness the kill and lose their nerve.
    const witnesses = world.acquireHumanBuffer();
    world.humansInRadiusInto(this.x, this.y, 190, witnesses);
    for (const other of witnesses) {
      if (other === this || !other.alive) continue;
      other.witnessDeath(1 - other.archetype.courage);
    }
    world.releaseHumanBuffer(witnesses);

    world.onHumanKilled?.(this, ctx);
  }

  protected override recordDamage(): void {
    // Damage dealt to humans is recorded centrally in World.onDamageDealt.
  }

  witnessDeath(amount: number): void {
    this.alerted = true;
    this.panic = clamp(this.panic + amount * 0.35, 0, 1);
  }

  /** Called by the world when the monster roars, or a building is breached. */
  alert(): void {
    this.alerted = true;
    this.alertDelay = 0;
  }

  override update(dt: number, world: World): void {
    // Bleeding humans lose blood faster while sprinting.
    const dotMultiplier = this.speed > 60 ? 1.6 : 1;
    this.updateCommon(dt, world, dotMultiplier);
    if (!this.alive) return;

    this.panic = Math.max(0, this.panic - dt * 0.12);
    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Stalemate breaker. A defender that has been alerted for a long stretch
    // without landing a blow — because it is stuck behind a house, or kiting a
    // player who is also kiting — commits and charges. Without this, the tail of
    // a room degenerates into chasing survivors around buildings.
    //
    // A Rider trips this almost on sight rather than waiting out the room: a horse
    // that patiently jogs into position reads as a slow militiaman, not a charge.
    if (this.alerted && this.archetype.role !== 'civilian' && this.archetype.speed > 0) {
      const patience = this.archetype.id === 'rider' ? 1.4 : 7;
      this.timeSinceAttack += dt;
      if (this.timeSinceAttack > patience) {
        this.timeSinceAttack = 0;
        this.charging = 4;
      }
    }
    if (this.charging > 0) this.charging -= dt;

    const monster = world.monster;
    const distance = this.distanceTo(monster);

    if (!this.alerted) {
      const sightRange = 380;
      if (distance < sightRange && world.hasLineOfSight(this.x, this.y, monster.x, monster.y)) {
        this.alertDelay -= dt;
        if (this.alertDelay <= 0) this.alerted = true;
      }
    }

    if (this.statuses.isIncapacitated()) {
      // Ring the ice only on the transition, not every frame it stays frozen.
      if (!this.wasFrozen) {
        this.wasFrozen = true;
        world.sound.freeze(this);
      }
      this.decelerate(dt);
      this.integrate(dt, world);
      return;
    }
    this.wasFrozen = false;

    const feared = this.statuses.isFeared() || this.panic > 0.75;
    if (this.archetype.role === 'boss') this.updateBoss(dt, world, distance);
    else if (feared || this.archetype.role === 'civilian') this.updateFlee(dt, world, distance);
    else this.updateFighter(dt, world, distance);

    this.integrate(dt, world);
  }

  // ---- behaviours ----------------------------------------------------------

  private updateFlee(dt: number, world: World, distance: number): void {
    const monster = world.monster;
    const panicRange = this.archetype.role === 'civilian' ? 300 : 240;

    if (!this.alerted && distance > panicRange) {
      this.wander(dt, world);
      return;
    }

    this.alerted = true;
    this.state = 'flee';

    if (distance < panicRange * 1.6) {
      this.fleeTime += dt;

      // Eventually they simply give out. A cowering villager is trivial to kill,
      // which is the point: the chase has a guaranteed end.
      if (this.fleeTime > 13) {
        this.decelerate(dt, 5);
        this.state = 'flee';
        if (world.rng.next() < dt * 0.8) {
          world.texts.add(this.x, this.y - this.radius * 2, t('text.exhausted'), '#8b8578', 11);
        }
        this.advanceAttack(dt, world, distance);
        return;
      }

      // Stamina cycle: four seconds of sprinting, then two and a half of gasping.
      // Without this, a single terrified peasant can outrun the fight forever and
      // the room ends with a tedious chase across the whole map.
      const winded = this.fleeTime % 6.5 > 4;
      // Occasional gasp so the slowdown is legible rather than feeling like lag.
      if (winded && world.rng.next() < dt * 1.5) {
        world.texts.add(this.x, this.y - this.radius * 2, '…', '#b9b2a2', 12);
      }

      // Run directly away, with a slight tangential bias so crowds fan out
      // instead of forming a single conga line.
      const away = Math.atan2(this.y - monster.y, this.x - monster.x);
      const bias = ((this.id % 2) * 2 - 1) * 0.45;
      this.moveToward(away + bias, dt, winded ? 0.5 : 1.15);
    } else {
      this.fleeTime = Math.max(0, this.fleeTime - dt * 2);
      this.decelerate(dt);
    }

    // Cornered civilians lash out rather than standing still and dying.
    if (
      this.archetype.role === 'civilian' &&
      distance < this.archetype.attackRange &&
      this.attackCooldown <= 0
    ) {
      this.beginAttack(world);
    }
    this.advanceAttack(dt, world, distance);
  }

  /** Angle from this unit straight to the monster — every AI branch steers by it. */
  private angleToMonster(world: World): number {
    const monster = world.monster;
    return Math.atan2(monster.y - this.y, monster.x - this.x);
  }

  /**
   * Gate for starting a new swing: cooldown ready and in range, plus whichever of
   * the two extra checks the caller needs. Both default on, since that's what
   * most roles want; `updateSupport` turns `requireIdle` off (it always has, and
   * that's a real behaviour difference from the other roles, not an oversight
   * this is fixing), and `updateBoss` leaves `hasLos` at its default `true`
   * (never actually checked) since bosses have never required a sightline.
   */
  private canBeginAttack(distance: number, options: { requireIdle?: boolean; hasLos?: boolean } = {}): boolean {
    const { requireIdle = true, hasLos = true } = options;
    if (requireIdle && (this.state === 'windup' || this.state === 'recover')) return false;
    return this.attackCooldown <= 0 && distance <= this.archetype.attackRange && hasLos;
  }

  private updateFighter(dt: number, world: World, distance: number): void {
    const monster = world.monster;
    const a = this.archetype;

    if (!this.alerted) {
      this.wander(dt, world);
      return;
    }

    if (a.role === 'support') {
      this.updateSupport(dt, world, distance);
      return;
    }

    const hasLos = world.hasLineOfSight(this.x, this.y, monster.x, monster.y);
    const toMonster = this.angleToMonster(world);

    // While charging, everything else is suspended: close the distance.
    if (this.charging > 0 && this.state !== 'windup' && this.state !== 'recover') {
      this.moveToward(toMonster, dt, 1.15);
      this.facing = damp(this.facing, toMonster, 10, dt);
      if (this.canBeginAttack(distance, { hasLos: a.role !== 'ranged' || hasLos })) {
        this.beginAttack(world);
      }
      this.advanceAttack(dt, world, distance);
      return;
    }

    switch (this.state) {
      case 'windup':
      case 'recover':
        this.decelerate(dt, 4);
        break;

      case 'reposition': {
        this.stateTimer -= dt;
        this.moveToward(this.wanderAngle(), dt, 0.9);
        if (this.stateTimer <= 0) this.state = 'approach';
        break;
      }

      default: {
        if (a.role === 'turret') {
          this.decelerate(dt);
          break;
        }

        if (a.role === 'ranged') {
          // Kite: back off when too close, close in when out of range or blocked.
          if (!hasLos || distance > a.preferredRange * 1.15) {
            this.moveToward(toMonster, dt, 1);
          } else if (distance < a.preferredRange * 0.62) {
            this.moveToward(toMonster + Math.PI, dt, 1.05);
          } else {
            // Strafe so archers are moving targets rather than statues.
            const side = (this.id % 2) * 2 - 1;
            this.moveToward(toMonster + (Math.PI / 2) * side, dt, 0.55);
          }
        } else {
          // Melee units stop at the edge of their reach instead of walking into
          // the monster. Standing inside the player's body looks broken and makes
          // the swing telegraph impossible to read.
          const standoff = this.standoffDistance(monster.radius);
          if (distance > standoff) this.moveToward(toMonster, dt, 1);
          else if (distance < standoff * 0.78) this.moveToward(toMonster + Math.PI, dt, 0.7);
          else this.decelerate(dt, 6);
        }
        break;
      }
    }

    if (this.canBeginAttack(distance, { hasLos: a.role !== 'ranged' || hasLos })) this.beginAttack(world);
    this.advanceAttack(dt, world, distance);

    this.facing = damp(this.facing, toMonster, 10, dt);
  }

  private updateSupport(dt: number, world: World, distance: number): void {
    const monster = world.monster;
    const a = this.archetype;

    // Priests prioritise healing a wounded ally over attacking.
    const wounded = this.findWoundedAlly(world);
    if (wounded && this.attackCooldown <= 0) {
      this.attackCooldown = a.attackCooldown;
      const healAmount = 18 * (1 + this.tier * 0.2);
      wounded.heal(healAmount, world, t('effect.prayer'));
      world.particles.emit({
        count: 12,
        x: wounded.x,
        y: wounded.y,
        color: '#ffe9a8',
        shape: 'spark',
        speed: [20, 90],
        size: [1.5, 3],
        life: [0.4, 0.8],
        additive: true,
        gravity: -80,
      });
      world.arcs.push({ x1: this.x, y1: this.y, x2: wounded.x, y2: wounded.y, life: 0.25 });
      return;
    }

    const toMonster = this.angleToMonster(world);
    if (distance < a.preferredRange * 0.7) this.moveToward(toMonster + Math.PI, dt, 1);
    else if (distance > a.preferredRange * 1.2) this.moveToward(toMonster, dt, 0.9);
    else this.decelerate(dt);

    const hasLos = world.hasLineOfSight(this.x, this.y, monster.x, monster.y);
    if (this.canBeginAttack(distance, { requireIdle: false, hasLos })) {
      this.beginAttack(world);
    }
    this.advanceAttack(dt, world, distance);
    this.facing = damp(this.facing, toMonster, 8, dt);
  }

  private updateBoss(dt: number, world: World, distance: number): void {
    const a = this.archetype;
    this.alerted = true;

    this.specialTimer -= dt;
    if (this.specialTimer <= 0 && this.state !== 'windup') {
      this.specialTimer = this.hp / this.maxHp < 0.5 ? 5 : 8;
      this.castSpecial(world);
      return;
    }

    const toMonster = this.angleToMonster(world);

    if (this.state === 'windup' || this.state === 'recover') {
      this.decelerate(dt, 5);
    } else if (distance > a.preferredRange * 1.1) {
      this.moveToward(toMonster, dt, 1);
    } else if (distance < a.preferredRange * 0.55) {
      this.moveToward(toMonster + Math.PI, dt, 0.8);
    } else {
      this.moveToward(toMonster + Math.PI / 2, dt, 0.6);
    }

    if (this.canBeginAttack(distance)) this.beginAttack(world);
    this.advanceAttack(dt, world, distance);
    this.facing = damp(this.facing, toMonster, 7, dt);
  }

  /**
   * Boss abilities.
   *
   * Each boss cycles its own set of three, so which one the run ends on changes how
   * the last fight is played rather than just how much health it has.
   */
  private castSpecial(world: World): void {
    this.specialIndex = (this.specialIndex + 1) % 3;

    switch (this.archetype.id) {
      case 'warlord':
        this.castWarlord(world);
        return;
      case 'pyromancer':
        this.castPyromancer(world);
        return;
      case 'khagan':
        this.castKhagan(world);
        return;
      default:
        this.castInquisitor(world);
    }
  }

  /** Melee pressure: a leap, an expanding shockwave, and a bodyguard call. */
  private castWarlord(world: World): void {
    const monster = world.monster;
    const angle = Math.atan2(monster.y - this.y, monster.x - this.x);

    switch (this.specialIndex) {
      case 0: {
        // Telegraphed leap. The landing is what hurts, so it can be walked out of.
        const cfg = WARLORD_ABILITIES.leap;
        const tx = monster.x;
        const ty = monster.y;
        world.particles.ring(tx, ty, '#e0655f', 120, cfg.telegraphSeconds, true);
        world.sound.enemyWindup(this, cfg.windupSoundSeconds);
        world.scheduleDelayed?.(cfg.telegraphSeconds, (w) => {
          if (!this.alive) return;
          this.x = tx;
          this.y = ty;
          w.collideWithWorld(this);
          w.explode(
            tx,
            ty,
            cfg.radius,
            [{ type: 'physical', amount: cfg.damage * this.damageScale }],
            t('effect.warlordLeap'),
            { color: '#e0655f', knockback: cfg.knockback, shake: cfg.shake },
          );
        });
        break;
      }
      case 1: {
        // Shockwave: a ring of low projectiles racing outward along the ground.
        const cfg = WARLORD_ABILITIES.shockwave;
        for (let i = 0; i < cfg.count; i++) {
          const a = (i / cfg.count) * TAU;
          world.spawnProjectile({
            x: this.x + Math.cos(a) * cfg.spawnRadius,
            y: this.y + Math.sin(a) * cfg.spawnRadius,
            angle: a,
            speed: cfg.speed,
            packets: [{ type: 'physical', amount: cfg.damage * this.damageScale }],
            faction: 'human',
            sourceLabel: t('effect.shockwave'),
            radius: cfg.projectileRadius,
            range: cfg.range,
            color: '#c8a08a',
            glow: '#f0d8c0',
            shape: 'rock',
            owner: this,
            knockback: cfg.knockback,
            ignoresWalls: true,
          });
        }
        world.camera.shake(cfg.shake);
        break;
      }
      default: {
        // Bodyguards, not a swarm: two knights are a real problem on their own.
        const cfg = WARLORD_ABILITIES.rally;
        for (let i = 0; i < cfg.count; i++) {
          const a = angle + Math.PI + (i - 0.5) * cfg.angleSpread;
          world.spawnHuman?.(
            'knight',
            this.x + Math.cos(a) * cfg.spawnRadius,
            this.y + Math.sin(a) * cfg.spawnRadius,
            this.tier,
          );
        }
        world.texts.add(this.x, this.y - 40, t('text.warlordRally'), '#e0655f', 18);
        break;
      }
    }
  }

  /** Zone control: burning ground, a fan of bolts, and a ring of fire. */
  private castPyromancer(world: World): void {
    const monster = world.monster;
    const angle = Math.atan2(monster.y - this.y, monster.x - this.x);
    const power = this.damageScale;

    switch (this.specialIndex) {
      case 0: {
        // A trail of fire pools walking toward the player, cutting the arena in two.
        const cfg = PYROMANCER_ABILITIES.firewall;
        for (let i = 1; i <= cfg.poolCount; i++) {
          const distance = i * cfg.spacing;
          const x = this.x + Math.cos(angle) * distance;
          const y = this.y + Math.sin(angle) * distance;
          world.scheduleDelayed?.(i * cfg.staggerSeconds, (w) => {
            w.addGroundHazard({
              x,
              y,
              radius: cfg.hazardRadius,
              life: cfg.life,
              dps: cfg.dps * power,
              type: 'fire',
              color: '#ff7b31',
              sourceLabel: t('effect.firewall'),
              status: {
                id: 'burn',
                duration: cfg.burnDuration,
                stacks: cfg.burnStacks,
                power: cfg.burnPower * power,
                sourceLabel: t('effect.firewall'),
              },
            });
          });
        }
        break;
      }
      case 1: {
        // Fan of bolts: dodgeable sideways, punishing if you back straight up.
        const cfg = PYROMANCER_ABILITIES.emberFan;
        for (let i = -cfg.halfSpread; i <= cfg.halfSpread; i++) {
          world.spawnProjectile({
            x: this.x + Math.cos(angle) * cfg.spawnRadius,
            y: this.y + Math.sin(angle) * cfg.spawnRadius,
            angle: angle + i * cfg.angleStep,
            speed: cfg.speed,
            packets: [{ type: 'fire', amount: cfg.damage * power }],
            faction: 'human',
            sourceLabel: t('effect.emberFan'),
            radius: cfg.projectileRadius,
            range: cfg.range,
            color: '#ff7b31',
            glow: '#ffd27a',
            shape: 'spit',
            owner: this,
            statuses: [
              { id: 'burn', duration: cfg.burnDuration, stacks: 1, power: cfg.burnPower * power, sourceLabel: t('effect.emberFan') },
            ],
          });
        }
        break;
      }
      default: {
        // Ring of fire around itself — you cannot simply stand on top of it.
        const cfg = PYROMANCER_ABILITIES.pyreRing;
        for (let i = 0; i < cfg.count; i++) {
          const a = (i / cfg.count) * TAU;
          world.addGroundHazard({
            x: this.x + Math.cos(a) * cfg.ringRadius,
            y: this.y + Math.sin(a) * cfg.ringRadius,
            radius: cfg.hazardRadius,
            life: cfg.life,
            dps: cfg.dps * power,
            type: 'fire',
            color: '#ff7b31',
            sourceLabel: t('effect.pyreRing'),
          });
        }
        world.particles.ring(this.x, this.y, '#ff7b31', 150, 0.8);
        world.texts.add(this.x, this.y - 40, t('text.pyreRises'), '#ffd27a', 18);
        break;
      }
    }
  }

  private castInquisitor(world: World): void {
    const monster = world.monster;

    switch (this.specialIndex) {
      case 0: {
        // Ring of holy bolts, with a gap the player can dash through.
        const cfg = INQUISITOR_ABILITIES.divineJudgment;
        const gap = world.rng.int(0, cfg.count - 1);
        for (let i = 0; i < cfg.count; i++) {
          if (i === gap || i === (gap + 1) % cfg.count) continue;
          const angle = (i / cfg.count) * TAU;
          world.spawnProjectile({
            x: this.x + Math.cos(angle) * cfg.spawnRadius,
            y: this.y + Math.sin(angle) * cfg.spawnRadius,
            angle,
            speed: cfg.speed,
            packets: [{ type: 'holy', amount: cfg.damage * this.damageScale }],
            faction: 'human',
            sourceLabel: t('effect.divineJudgment'),
            radius: cfg.projectileRadius,
            range: cfg.range,
            color: '#ffe9a8',
            glow: '#fffdf0',
            shape: 'orb',
            owner: this,
          });
        }
        world.particles.ring(this.x, this.y, '#ffe9a8', 60, 0.5);
        world.camera.shake(cfg.shake);
        break;
      }
      case 1: {
        // Consecrated ground under the player's feet, forcing them to move.
        const cfg = INQUISITOR_ABILITIES.consecration;
        const tx = monster.x;
        const ty = monster.y;
        world.particles.ring(tx, ty, '#ffd98a', 90, cfg.telegraphSeconds, true);
        world.scheduleDelayed?.(cfg.telegraphSeconds, (w) => {
          w.explode(
            tx,
            ty,
            cfg.radius,
            [{ type: 'holy', amount: cfg.damage * this.damageScale }],
            t('effect.consecration'),
            { color: '#ffe9a8', hurtsBuildings: false, shake: cfg.shake },
          );
        });
        break;
      }
      default: {
        // Call the faithful.
        const cfg = INQUISITOR_ABILITIES.callFaithful;
        for (let i = 0; i < cfg.count; i++) {
          const angle = (i / cfg.count) * TAU + world.rng.next();
          world.spawnHuman?.(
            world.rng.bool(0.5) ? 'militia' : 'archer',
            this.x + Math.cos(angle) * cfg.spawnRadius,
            this.y + Math.sin(angle) * cfg.spawnRadius,
            this.tier,
          );
        }
        world.texts.add(this.x, this.y - 40, t('text.lightCalls'), '#ffe9a8', 18);
        break;
      }
    }
  }

  /** War-camp pressure: call the horde, a javelin volley, and a blinding sandstorm. */
  private castKhagan(world: World): void {
    const monster = world.monster;
    const angle = Math.atan2(monster.y - this.y, monster.x - this.x);
    const power = this.damageScale;

    switch (this.specialIndex) {
      case 0: {
        // Riders answer the horn rather than the Khagan closing the distance itself.
        const cfg = KHAGAN_ABILITIES.hordeCall;
        for (let i = 0; i < cfg.count; i++) {
          const a = angle + Math.PI + (i - 0.5) * cfg.angleSpread;
          world.spawnHuman?.('rider', this.x + Math.cos(a) * cfg.spawnRadius, this.y + Math.sin(a) * cfg.spawnRadius, this.tier);
        }
        world.texts.add(this.x, this.y - 40, t('text.khaganHorde'), '#d4af37', 18);
        break;
      }
      case 1: {
        // A fan of javelins — dodgeable sideways, like the Pyromancer's bolts, but
        // hitting harder and flying faster to fit a mounted throw.
        const cfg = KHAGAN_ABILITIES.javelinVolley;
        for (let i = -cfg.halfSpread; i <= cfg.halfSpread; i++) {
          world.spawnProjectile({
            x: this.x + Math.cos(angle) * cfg.spawnRadius,
            y: this.y + Math.sin(angle) * cfg.spawnRadius,
            angle: angle + i * cfg.angleStep,
            speed: cfg.speed,
            packets: [{ type: 'physical', amount: cfg.damage * power }],
            faction: 'human',
            sourceLabel: t('effect.javelinVolley'),
            radius: cfg.projectileRadius,
            range: cfg.range,
            color: '#c9a25c',
            glow: '#f0d8a0',
            shape: 'bolt',
            owner: this,
            knockback: cfg.knockback,
          });
        }
        break;
      }
      default: {
        // A ring of blinding dust that doesn't care where you're standing when it
        // lands — the one answer the Khagan has to a player who just kites forever.
        const cfg = KHAGAN_ABILITIES.sandstorm;
        for (let i = 0; i < cfg.count; i++) {
          const a = (i / cfg.count) * TAU;
          world.addGroundHazard({
            x: this.x + Math.cos(a) * cfg.ringRadius,
            y: this.y + Math.sin(a) * cfg.ringRadius,
            radius: cfg.hazardRadius,
            life: cfg.life,
            dps: cfg.dps * power,
            type: 'physical',
            color: '#c9a25c',
            sourceLabel: t('effect.sandstorm'),
          });
        }
        world.particles.ring(this.x, this.y, '#c9a25c', 160, 0.8);
        world.camera.shake(cfg.shake);
        world.texts.add(this.x, this.y - 40, t('text.sandstormRises'), '#e8d4a0', 18);
        break;
      }
    }
  }

  // ---- attack pipeline -----------------------------------------------------

  private beginAttack(world: World): void {
    // The audio telegraph matters as much as the visual arc: it is what lets you
    // react to a swing coming from off-screen.
    world.sound.enemyWindup(this, this.archetype.windup);
    this.state = 'windup';
    this.stateTimer = this.archetype.windup;
    this.windupProgress = 0;
    this.attackCooldown = this.archetype.attackCooldown;
    this.timeSinceAttack = 0;
    this.charging = 0;
  }

  private advanceAttack(dt: number, world: World, distance: number): void {
    if (this.state === 'stunned') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'approach';
      return;
    }

    if (this.state === 'windup') {
      this.stateTimer -= dt;
      this.windupProgress = 1 - clamp(this.stateTimer / Math.max(0.01, this.archetype.windup), 0, 1);
      if (this.stateTimer <= 0) {
        this.releaseAttack(world, distance);
        this.state = 'recover';
        this.stateTimer = this.archetype.recover;
      }
      return;
    }

    if (this.state === 'recover') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.state = 'approach';
    }
  }

  private releaseAttack(world: World, distance: number): void {
    const a = this.archetype;
    const monster = world.monster;
    const scale = this.damageScale * this.statuses.outputMultiplier();
    const packets = a.damage.map((p) => ({ type: p.type, amount: p.amount * scale }));
    const angle = Math.atan2(monster.y - this.y, monster.x - this.x);

    if (a.role === 'ranged' || a.role === 'support' || a.role === 'turret' || a.role === 'boss') {
      const shape = a.id === 'crossbowman' ? 'bolt' : a.id === 'ballista' ? 'bolt' : a.id === 'archer' ? 'arrow' : 'orb';
      const speed = a.id === 'ballista' ? 700 : a.id === 'crossbowman' ? 620 : 430;

      world.spawnProjectile({
        x: this.x + Math.cos(angle) * (this.radius + 6),
        y: this.y + Math.sin(angle) * (this.radius + 6),
        angle,
        speed,
        packets,
        faction: 'human',
        sourceLabel: a.name,
        radius: a.id === 'ballista' ? 8 : 5,
        range: a.attackRange + 120,
        color: a.role === 'support' || a.role === 'boss' ? '#ffe9a8' : '#d8cbb0',
        glow: a.role === 'support' || a.role === 'boss' ? '#fffdf0' : '#fff6e0',
        shape,
        statuses: a.onHitStatuses,
        owner: this,
        knockback: 30,
      });

      world.sound.enemyShot(this);
      world.particles.emit({
        count: 3,
        x: this.x,
        y: this.y,
        color: '#cfc6ad',
        shape: 'spark',
        speed: [40, 110],
        size: [1, 2],
        life: [0.1, 0.25],
        angle,
        spread: 0.4,
      });
      return;
    }

    // Melee: an arc sweep in front of the attacker. The player can sidestep out of
    // the swing during the wind-up, so the cone check happens at release time.
    if (distance > a.attackRange * 1.5) return;
    if (Math.abs(angleDelta(this.facing, angle)) > 1.1) return;

    monster.takeDamage(
      {
        packets,
        sourceLabel: a.name,
        kind: 'attack',
        knockback: 90,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle),
        dodgeable: true,
      },
      world,
      this,
    );

    for (const status of a.onHitStatuses ?? []) monster.statuses.apply(status);
    world.sound.enemyMelee(this);

    world.particles.emit({
      count: 6,
      x: this.x + Math.cos(angle) * a.attackRange * 0.7,
      y: this.y + Math.sin(angle) * a.attackRange * 0.7,
      color: a.accent,
      shape: 'spark',
      speed: [80, 200],
      size: [1.5, 3],
      life: [0.12, 0.3],
      angle,
      spread: 0.8,
    });
  }

  // ---- movement ------------------------------------------------------------

  /**
   * How close a melee unit tries to get. Never less than the two bodies touching,
   * and never more than its actual reach, so short-reach units still connect.
   */
  private standoffDistance(monsterRadius: number): number {
    const touching = monsterRadius + this.radius + 4;
    return Math.max(touching, this.archetype.attackRange * 0.82);
  }

  private wanderAngle(): number {
    return Math.atan2(this.wanderY - this.y, this.wanderX - this.x);
  }

  private wander(dt: number, world: World): void {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0 || dist2(this.x, this.y, this.wanderX, this.wanderY) < 400) {
      this.wanderTimer = world.rng.range(1.5, 4);
      const angle = world.rng.next() * TAU;
      const radius = world.rng.range(40, 150);
      this.wanderX = this.x + Math.cos(angle) * radius;
      this.wanderY = this.y + Math.sin(angle) * radius;
    }
    this.moveToward(this.wanderAngle(), dt, 0.35);
  }

  private moveToward(angle: number, dt: number, speedScale: number): void {
    if (this.archetype.speed <= 0) return;

    // Walking straight into a wall face produces zero net movement forever, because
    // the collision solver just pushes back along the same axis. When that happens,
    // slide sideways for a beat so the unit rounds the corner.
    if (this.avoidTimer > 0) {
      this.avoidTimer -= dt;
      angle += (Math.PI / 2) * this.avoidDir;
    }

    const target = this.archetype.speed * speedScale * this.statuses.moveMultiplier();
    const accel = 900;
    this.vx = damp(this.vx, Math.cos(angle) * target, accel / Math.max(60, target), dt);
    this.vy = damp(this.vy, Math.sin(angle) * target, accel / Math.max(60, target), dt);
    this.facing = damp(this.facing, angle, 9, dt);
    this.stride += Math.hypot(this.vx, this.vy) * dt * 0.06;
  }

  private decelerate(dt: number, rate = 8): void {
    this.vx = damp(this.vx, 0, rate, dt);
    this.vy = damp(this.vy, 0, rate, dt);
  }

  private integrate(dt: number, world: World): void {
    const startX = this.x;
    const startY = this.y;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Soft separation so units form a crowd rather than a single stacked blob.
    let pushX = 0;
    let pushY = 0;
    const neighbors = world.acquireHumanBuffer();
    world.humansInRadiusInto(this.x, this.y, this.radius * 2.4, neighbors);
    for (const other of neighbors) {
      if (other === this || !other.alive) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const d = Math.hypot(dx, dy);
      const minDist = this.radius + other.radius;
      if (d > 1e-3 && d < minDist) {
        const overlap = (minDist - d) / minDist;
        pushX += (dx / d) * overlap;
        pushY += (dy / d) * overlap;
      }
    }
    world.releaseHumanBuffer(neighbors);
    this.x += pushX * 120 * dt;
    this.y += pushY * 120 * dt;

    // Hard separation from the monster. Soft steering alone lets a shoving crowd
    // squeeze bodies inside the player's silhouette; this is a positional clamp,
    // so nothing ever overlaps the hero no matter how many units press in.
    const monster = world.monster;
    if (monster.alive) {
      const dx = this.x - monster.x;
      const dy = this.y - monster.y;
      const d = Math.hypot(dx, dy);
      const minDist = monster.radius + this.radius;
      if (d < minDist) {
        // Degenerate case: exactly co-located. Pick a deterministic direction.
        const nx = d > 1e-3 ? dx / d : Math.cos(this.id);
        const ny = d > 1e-3 ? dy / d : Math.sin(this.id);
        this.x = monster.x + nx * minDist;
        this.y = monster.y + ny * minDist;
        // Kill inward momentum so the unit doesn't grind against the boundary.
        const inward = this.vx * nx + this.vy * ny;
        if (inward < 0) {
          this.vx -= nx * inward;
          this.vy -= ny * inward;
        }
      }
    }

    world.collideWithWorld(this);

    // Compare intended travel against what actually happened.
    const wanted = Math.hypot(this.vx, this.vy) * dt;
    if (wanted > 0.4) {
      const actual = Math.hypot(this.x - startX, this.y - startY);
      if (actual < wanted * 0.3) {
        this.blockedTime += dt;
        if (this.blockedTime > 0.3 && this.avoidTimer <= 0) {
          // Pick a consistent side per unit so a crowd fans around both edges of
          // the same building instead of all queueing at one corner.
          this.avoidDir = this.id % 2 === 0 ? 1 : -1;
          this.avoidTimer = 0.9;
          this.blockedTime = 0;
        }
      } else {
        this.blockedTime = Math.max(0, this.blockedTime - dt);
      }
    }
  }

  // ---- rendering -----------------------------------------------------------

  /**
   * How far above the ground a wall-mounted defender's platform sits.
   *
   * Scaled to the tower's own footprint so the unit visually reaches parapet
   * height instead of floating a fixed, tower-size-agnostic amount above the
   * ground next to it — a watchtower and a much taller stronghold shouldn't
   * raise their defender by the same few pixels.
   */
  private wallStandHeight(): number {
    const towerH = this.mountedOn?.rect.h ?? 0;
    return clamp(towerH * 0.45, 22, 60);
  }

  override draw(ctx: CanvasRenderingContext2D, world: World): void {
    const a = this.archetype;
    const bob = Math.sin(this.stride) * 2;
    const lean = Math.cos(this.stride) * 0.08;
    const isBoss = a.role === 'boss';
    const scale = isBoss ? 1.9 : 1;

    ctx.save();
    ctx.translate(this.x, this.y);

    // Shadow.
    drawGroundShadow(ctx, 0, this.radius * 0.6, this.radius * 0.95, this.radius * 0.36);

    // The boss gets a halo so it never gets lost in a crowd of its own soldiers.
    if (isBoss) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const halo = ctx.createRadialGradient(0, -this.radius, 0, 0, -this.radius, this.radius * 4);
      halo.addColorStop(0, 'rgba(255,236,170,0.35)');
      halo.addColorStop(0.5, 'rgba(212,175,55,0.14)');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, -this.radius, this.radius * 4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    // A defender shielded by its tower stands on the parapet, not the ground —
    // the shadow above stays put so the platform actually reads as height.
    if (this.mountedOn?.alive) ctx.translate(0, -this.wallStandHeight());

    ctx.translate(0, bob - this.radius * 0.4);
    ctx.rotate(lean);
    ctx.scale(scale, scale);

    const flash = this.hitFlash;
    const tint = this.statuses.tint();
    const mounted = a.id === 'rider' || a.id === 'khagan';

    if (mounted) {
      this.drawMount(ctx);
    } else {
      // Legs: two simple strokes swinging out of phase.
      const legSwing = Math.sin(this.stride * 2) * this.radius * 0.55;
      ctx.strokeStyle = '#3b3128';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-2, this.radius * 0.2);
      ctx.lineTo(-2 + legSwing, this.radius * 1.05);
      ctx.moveTo(2, this.radius * 0.2);
      ctx.lineTo(2 - legSwing, this.radius * 1.05);
      ctx.stroke();
    }

    // Torso.
    ctx.fillStyle = a.tunic;
    ctx.beginPath();
    ctx.ellipse(0, 0, this.radius * 0.72, this.radius * 0.95, 0, 0, TAU);
    ctx.fill();

    // Armour plate / tabard accent.
    ctx.fillStyle = a.accent;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(0, -this.radius * 0.15, this.radius * 0.45, this.radius * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Head.
    ctx.fillStyle = '#c9a37c';
    ctx.beginPath();
    ctx.arc(0, -this.radius * 1.05, this.radius * 0.44, 0, TAU);
    ctx.fill();

    this.drawWeapon(ctx);

    // Damage flash sits on top of everything.
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.85;
      ctx.fillStyle = this.hitFlashColor;
      ctx.beginPath();
      ctx.ellipse(0, -this.radius * 0.2, this.radius * 0.95, this.radius * 1.35, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (tint) {
      // A rim rather than a wash: a filled overlay large enough to be legible on a
      // boss ends up hiding the whole figure.
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = tint;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, -this.radius * 0.2, this.radius * 0.85, this.radius * 1.25, 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = tint;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    this.drawOverlays(ctx, world);
  }

  /** A horse under a Rider or the Khagan, drawn in place of walking legs. */
  private drawMount(ctx: CanvasRenderingContext2D): void {
    const r = this.radius;

    // Four legs, cantering in diagonal pairs.
    ctx.strokeStyle = '#3b3128';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [ox, phase] of [
      [-r * 0.75, 0],
      [-r * 0.35, Math.PI],
      [r * 0.35, 0],
      [r * 0.75, Math.PI],
    ] as const) {
      const swing = Math.sin(this.stride * 2.4 + phase) * r * 0.4;
      ctx.moveTo(ox, r * 0.35);
      ctx.lineTo(ox + swing * 0.3, r * 1.15);
    }
    ctx.stroke();

    // A low, elongated barrel for the body.
    ctx.fillStyle = '#5c4a36';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.25, r * 1.15, r * 0.55, 0, 0, TAU);
    ctx.fill();

    // Neck and head, reaching toward whatever the rider is facing.
    ctx.save();
    ctx.rotate(this.facing);
    ctx.fillStyle = '#4a3a2a';
    ctx.beginPath();
    ctx.ellipse(r * 1.1, -r * 0.05, r * 0.55, r * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    // Tail, trailing behind.
    ctx.strokeStyle = '#3b2e22';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, r * 0.1);
    ctx.lineTo(-r * 1.4, r * 0.6 + Math.sin(this.stride) * 3);
    ctx.stroke();
  }

  private drawWeapon(ctx: CanvasRenderingContext2D): void {
    const a = this.archetype;
    // The weapon swings forward through the wind-up, so the telegraph is readable.
    const swing = this.state === 'windup' ? -0.9 + this.windupProgress * 1.7 : 0;

    ctx.save();
    ctx.rotate(this.facing + swing);
    ctx.translate(this.radius * 0.6, 0);

    switch (a.id) {
      case 'spearman':
        this.drawSpear(ctx);
        break;
      case 'archer':
        this.drawBow(ctx);
        break;
      case 'crossbowman':
      case 'ballista':
      case 'siegeEngine':
        this.drawCrossbow(ctx);
        break;
      case 'rider':
        this.drawLance(ctx);
        break;
      case 'torchbearer':
        this.drawTorch(ctx);
        break;
      case 'priest':
      case 'inquisitor':
        this.drawHolySymbol(ctx);
        break;
      case 'warlord':
        this.drawMaul(ctx);
        break;
      case 'pyromancer':
        this.drawFireBrand(ctx);
        break;
      case 'knight':
        this.drawSwordAndShield(ctx);
        break;
      case 'khagan':
        this.drawSabre(ctx);
        break;
      case 'militia':
        this.drawClub(ctx);
        break;
      default:
        // Civilians carry nothing worth drawing.
        break;
    }

    ctx.restore();
  }

  private drawSpear(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#6b5334';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(this.radius * 2.6, 0);
    ctx.stroke();
    ctx.fillStyle = this.archetype.accent;
    ctx.beginPath();
    ctx.moveTo(this.radius * 2.6, 0);
    ctx.lineTo(this.radius * 2.1, -3.5);
    ctx.lineTo(this.radius * 2.1, 3.5);
    ctx.closePath();
    ctx.fill();
  }

  private drawBow(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#6b5334';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(2, 0, this.radius * 0.85, -1.2, 1.2);
    ctx.stroke();
  }

  /** Shared by every archetype that fires a bolt: crossbowman, ballista, siege engine. */
  private drawCrossbow(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#5c4c38';
    ctx.fillRect(-2, -2, this.radius * 1.6, 4);
    ctx.fillRect(this.radius * 0.5, -this.radius * 0.7, 3, this.radius * 1.4);
  }

  /** A lance, held level rather than swept in an arc — a charge doesn't wind up. */
  private drawLance(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#6b5334';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(this.radius * 2.8, 0);
    ctx.stroke();
    ctx.fillStyle = this.archetype.accent;
    ctx.beginPath();
    ctx.arc(this.radius * 2.8, 0, 3, 0, TAU);
    ctx.fill();
  }

  private drawTorch(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#5b4229';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.radius * 1.1, 0);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const flame = ctx.createRadialGradient(this.radius * 1.2, 0, 0, this.radius * 1.2, 0, 9);
    flame.addColorStop(0, '#fff0b0');
    flame.addColorStop(0.4, '#ff9a3c');
    flame.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.arc(this.radius * 1.2, 0, 9, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Shared by priest and inquisitor. */
  private drawHolySymbol(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = this.archetype.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -this.radius * 0.4);
    ctx.lineTo(0, this.radius * 1.2);
    ctx.moveTo(-4, this.radius * 0.1);
    ctx.lineTo(4, this.radius * 0.1);
    ctx.stroke();
  }

  /** A two-handed maul: a long haft with a heavy head. */
  private drawMaul(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#4a3a2c';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(this.radius * 1.9, 0);
    ctx.stroke();
    ctx.fillStyle = this.archetype.accent;
    ctx.fillRect(this.radius * 1.7, -7, 12, 14);
  }

  /** A burning brand held out front. */
  private drawFireBrand(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = '#3a2a1e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-6, 0);
    ctx.lineTo(this.radius * 1.4, 0);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    const fire = ctx.createRadialGradient(this.radius * 1.6, 0, 0, this.radius * 1.6, 0, 16);
    fire.addColorStop(0, '#fff0b0');
    fire.addColorStop(0.4, '#ff7b31');
    fire.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.arc(this.radius * 1.6, 0, 16, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSwordAndShield(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = this.archetype.accent;
    ctx.fillRect(-2, -2.5, this.radius * 1.7, 5);
    // Shield on the off hand.
    ctx.rotate(-1.6);
    ctx.fillStyle = '#8d939e';
    ctx.beginPath();
    ctx.ellipse(this.radius * 0.5, 0, this.radius * 0.4, this.radius * 0.75, 0, 0, TAU);
    ctx.fill();
  }

  /** A curved sabre, held forward. */
  private drawSabre(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = this.archetype.accent;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, 2);
    ctx.quadraticCurveTo(this.radius * 1.2, -6, this.radius * 2.1, 0);
    ctx.stroke();
  }

  private drawClub(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#b4a583';
    ctx.fillRect(-2, -2, this.radius * 1.3, 4);
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, world: World): void {
    const a = this.archetype;
    const isBoss = a.role === 'boss';
    const mountY = this.y - (this.mountedOn?.alive ? this.wallStandHeight() : 0);

    // Health bar, only once wounded (or always for the boss).
    if (this.hp < this.maxHp || isBoss) {
      const w = isBoss ? 70 : Math.max(20, this.radius * 2.2);
      const h = isBoss ? 6 : 3;
      const y = -this.radius * (isBoss ? 3.4 : 2.4);

      ctx.save();
      ctx.translate(this.x, mountY);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = isBoss ? '#c0343c' : '#a8232a';
      ctx.fillRect(-w / 2, y, w * this.healthFraction, h);
      ctx.restore();
    }

    // Wind-up telegraph: a growing arc in the attack direction.
    if (this.state === 'windup') {
      ctx.save();
      ctx.translate(this.x, mountY);
      ctx.rotate(this.facing);
      ctx.globalAlpha = 0.25 + this.windupProgress * 0.5;
      ctx.strokeStyle = a.role === 'support' || isBoss ? '#ffe9a8' : '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const reach = Math.min(a.attackRange, 90);
      ctx.arc(0, 0, reach * (0.4 + this.windupProgress * 0.6), -0.6, 0.6);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Panic marker so the player can read who is about to break and run.
    if (this.panic > 0.5 && !isBoss) {
      ctx.save();
      ctx.translate(this.x, mountY - this.radius * 2.9);
      ctx.globalAlpha = clamp((this.panic - 0.5) * 2, 0, 1);
      ctx.fillStyle = '#e8e2d4';
      ctx.font = 'bold 13px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, 0);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    void world;
  }

  private findWoundedAlly(world: World): Human | null {
    let best: Human | null = null;
    let worstFraction = 0.85;
    const nearby = world.acquireHumanBuffer();
    world.humansInRadiusInto(this.x, this.y, 260, nearby);
    for (const other of nearby) {
      if (other === this || !other.alive) continue;
      const fraction = other.healthFraction;
      if (fraction < worstFraction) {
        worstFraction = fraction;
        best = other;
      }
    }
    world.releaseHumanBuffer(nearby);
    return best;
  }
}
