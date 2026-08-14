import { type DamageOptions, type DamagePacket, type DamageResult, type Defenses, type DamageType } from '../combat/damage';
import { type StatusApplication } from '../combat/status';
import { angleDelta, clamp, damp, dist2, TAU } from '../core/math';
import { t } from '../i18n';
import type { World } from '../world/world';
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
  | 'inquisitor'
  | 'warlord'
  | 'pyromancer';

/** Every boss the run can end on. One is drawn per run from the seed. */
export const BOSS_IDS = ['inquisitor', 'warlord', 'pyromancer'] as const;

export type BossId = (typeof BOSS_IDS)[number];

export interface HumanArchetype {
  readonly id: HumanId;
  readonly name: string;
  readonly role: HumanRole;
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
  /** Earliest room index this unit can appear in. */
  readonly minDepth: number;
  /** Chance to drop a blood (healing) orb. */
  readonly bloodChance: number;
  /** Chance this unit drops a relic granting a temporary form. */
  readonly relicChance: number;
  readonly courage: number;
}

const NO_RESIST: Partial<Record<DamageType, number>> = {};

export const HUMAN_ARCHETYPES: Record<HumanId, HumanArchetype> = {
  peasant: {
    id: 'peasant',
    get name() { return t('enemy.peasant.name'); },
    role: 'civilian',
    hp: 22,
    armor: 0,
    resist: NO_RESIST,
    speed: 128,
    radius: 10,
    damage: [{ type: 'physical', amount: 3 }],
    attackRange: 26,
    preferredRange: 26,
    attackCooldown: 1.6,
    windup: 0.35,
    recover: 0.4,
    souls: 1,
    knockbackResist: 0.7,
    tunic: '#9a8460',
    accent: '#6f5c3f',
    spawnWeight: 30,
    minDepth: 0,
    bloodChance: 0.18,
    relicChance: 0,
    courage: 0,
  },
  militia: {
    id: 'militia',
    get name() { return t('enemy.militia.name'); },
    role: 'melee',
    hp: 52,
    armor: 6,
    resist: NO_RESIST,
    speed: 152,
    radius: 11,
    damage: [{ type: 'physical', amount: 9 }],
    attackRange: 34,
    preferredRange: 34,
    attackCooldown: 1.1,
    windup: 0.32,
    recover: 0.35,
    souls: 2,
    knockbackResist: 1,
    tunic: '#7c6a52',
    accent: '#b4a583',
    spawnWeight: 26,
    minDepth: 0,
    bloodChance: 0.1,
    relicChance: 0,
    courage: 0.5,
  },
  archer: {
    id: 'archer',
    get name() { return t('enemy.archer.name'); },
    role: 'ranged',
    hp: 40,
    armor: 2,
    resist: NO_RESIST,
    speed: 146,
    radius: 10,
    damage: [{ type: 'physical', amount: 11 }],
    attackRange: 400,
    preferredRange: 280,
    attackCooldown: 1.7,
    windup: 0.55,
    recover: 0.35,
    souls: 3,
    knockbackResist: 0.9,
    tunic: '#5d6b48',
    accent: '#8a9a68',
    spawnWeight: 20,
    minDepth: 0,
    bloodChance: 0.1,
    relicChance: 0,
    courage: 0.35,
  },
  spearman: {
    id: 'spearman',
    get name() { return t('enemy.spearman.name'); },
    role: 'melee',
    hp: 78,
    armor: 14,
    resist: NO_RESIST,
    speed: 138,
    radius: 12,
    damage: [{ type: 'physical', amount: 15 }],
    attackRange: 62,
    preferredRange: 62,
    attackCooldown: 1.4,
    windup: 0.45,
    recover: 0.45,
    souls: 4,
    knockbackResist: 1.4,
    tunic: '#5a5f6b',
    accent: '#9aa3b2',
    spawnWeight: 16,
    minDepth: 1,
    bloodChance: 0.12,
    relicChance: 0.03,
    courage: 0.7,
  },
  crossbowman: {
    id: 'crossbowman',
    get name() { return t('enemy.crossbowman.name'); },
    role: 'ranged',
    hp: 54,
    armor: 8,
    resist: NO_RESIST,
    speed: 122,
    radius: 11,
    damage: [{ type: 'physical', amount: 26 }],
    attackRange: 460,
    preferredRange: 330,
    attackCooldown: 2.6,
    windup: 0.9,
    recover: 0.6,
    souls: 5,
    knockbackResist: 1.1,
    tunic: '#4f4a52',
    accent: '#8d8798',
    spawnWeight: 12,
    minDepth: 2,
    bloodChance: 0.12,
    relicChance: 0.05,
    courage: 0.5,
  },
  torchbearer: {
    id: 'torchbearer',
    get name() { return t('enemy.torchbearer.name'); },
    role: 'melee',
    hp: 46,
    armor: 2,
    resist: { fire: 0.6 },
    speed: 168,
    radius: 10,
    damage: [
      { type: 'physical', amount: 5 },
      { type: 'fire', amount: 10 },
    ],
    attackRange: 36,
    preferredRange: 36,
    attackCooldown: 1.2,
    windup: 0.3,
    recover: 0.3,
    souls: 4,
    knockbackResist: 0.8,
    tunic: '#7a4a2e',
    accent: '#ff9a3c',
    onHitStatuses: [{ id: 'burn', duration: 4, stacks: 2, power: 2.5, get sourceLabel() { return t('effect.torch'); } }],
    spawnWeight: 14,
    minDepth: 2,
    bloodChance: 0.1,
    relicChance: 0.03,
    courage: 0.6,
  },
  priest: {
    id: 'priest',
    get name() { return t('enemy.priest.name'); },
    role: 'support',
    hp: 66,
    armor: 4,
    resist: { unholy: 0.5, holy: 0.9 },
    speed: 126,
    radius: 11,
    damage: [{ type: 'holy', amount: 16 }],
    attackRange: 320,
    preferredRange: 300,
    attackCooldown: 2.2,
    windup: 0.7,
    recover: 0.5,
    souls: 7,
    knockbackResist: 1,
    tunic: '#d8d2c0',
    accent: '#e8c96a',
    spawnWeight: 10,
    minDepth: 3,
    bloodChance: 0.2,
    relicChance: 0.14,
    courage: 0.8,
  },
  knight: {
    id: 'knight',
    get name() { return t('enemy.knight.name'); },
    role: 'melee',
    hp: 190,
    armor: 46,
    resist: { physical: 0.15 },
    speed: 132,
    radius: 14,
    damage: [{ type: 'physical', amount: 24 }],
    attackRange: 46,
    preferredRange: 46,
    attackCooldown: 1.5,
    windup: 0.55,
    recover: 0.55,
    souls: 12,
    knockbackResist: 2.6,
    tunic: '#6b7280',
    accent: '#c8cdd6',
    spawnWeight: 8,
    minDepth: 4,
    bloodChance: 0.25,
    relicChance: 0.22,
    courage: 1,
  },
  ballista: {
    id: 'ballista',
    get name() { return t('enemy.ballista.name'); },
    role: 'turret',
    hp: 120,
    armor: 20,
    resist: { poison: 0.9, frost: 0.5 },
    speed: 0,
    radius: 16,
    damage: [{ type: 'physical', amount: 38 }],
    attackRange: 620,
    preferredRange: 620,
    attackCooldown: 3.2,
    windup: 1.2,
    recover: 0.8,
    souls: 9,
    knockbackResist: 99,
    tunic: '#5c4c38',
    accent: '#8d7a5c',
    spawnWeight: 0,
    minDepth: 4,
    bloodChance: 0,
    relicChance: 0.08,
    courage: 1,
  },
  inquisitor: {
    id: 'inquisitor',
    get name() { return t('enemy.inquisitor.name'); },
    role: 'boss',
    hp: 1400,
    armor: 40,
    resist: { holy: 0.9, unholy: 0.35, fire: 0.2 },
    speed: 118,
    radius: 22,
    damage: [{ type: 'holy', amount: 30 }],
    attackRange: 380,
    preferredRange: 240,
    attackCooldown: 1.8,
    windup: 0.65,
    recover: 0.5,
    souls: 80,
    knockbackResist: 8,
    tunic: '#efe7d2',
    accent: '#d4af37',
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },

  /**
   * The Warlord: a pure bruiser.
   *
   * Where the Inquisitor punishes standing still, this one punishes standing
   * anywhere near it. Heavy armour and physical resistance mean an elemental build
   * handles it far better than a claws-and-crits one.
   */
  warlord: {
    id: 'warlord',
    get name() { return t('enemy.warlord.name'); },
    role: 'boss',
    hp: 1750,
    armor: 75,
    resist: { physical: 0.3, frost: 0.2 },
    speed: 142,
    radius: 24,
    damage: [{ type: 'physical', amount: 34 }],
    attackRange: 74,
    preferredRange: 66,
    attackCooldown: 1.5,
    windup: 0.6,
    recover: 0.55,
    souls: 85,
    knockbackResist: 12,
    tunic: '#6b3b2e',
    accent: '#c8cdd6',
    onHitStatuses: [{ id: 'bleed', duration: 6, stacks: 3, power: 3, sourceLabel: 'Warlord' }],
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },

  /**
   * The Pyromancer: fragile, but turns the arena itself against you.
   *
   * Low armour and the least health of the three — the difficulty is in the floor
   * catching fire, not in the health bar.
   */
  pyromancer: {
    id: 'pyromancer',
    get name() { return t('enemy.pyromancer.name'); },
    role: 'boss',
    hp: 1150,
    armor: 18,
    resist: { fire: 0.9, poison: 0.3 },
    speed: 130,
    radius: 20,
    damage: [{ type: 'fire', amount: 26 }],
    attackRange: 430,
    preferredRange: 300,
    attackCooldown: 1.5,
    windup: 0.55,
    recover: 0.45,
    souls: 80,
    knockbackResist: 5,
    tunic: '#8a3417',
    accent: '#ff9a3c',
    onHitStatuses: [{ id: 'burn', duration: 5, stacks: 3, power: 4, sourceLabel: 'Pyromancer' }],
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },
};

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

  constructor(id: HumanId, x: number, y: number, tier: number) {
    super();
    const archetype = HUMAN_ARCHETYPES[id];
    this.archetype = archetype;
    this.tier = tier;
    this.x = x;
    this.y = y;
    this.faction = 'human';
    this.radius = archetype.radius;

    // Depth scaling: +18% HP and +11% damage per room, compounding.
    const hpScale = Math.pow(1.18, tier);
    this.maxHp = archetype.hp * hpScale;
    this.hp = this.maxHp;

    this.wanderX = x;
    this.wanderY = y;
    this.alertDelay = 0.1 + Math.random() * 0.5;
  }

  get damageScale(): number {
    return Math.pow(1.11, this.tier);
  }

  override defenses(): Defenses {
    return {
      armor: this.archetype.armor * (1 + this.tier * 0.06),
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
    for (const other of world.humansInRadius(this.x, this.y, 190)) {
      if (other === this || !other.alive) continue;
      other.witnessDeath(1 - other.archetype.courage);
    }

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
    if (this.alerted && this.archetype.role !== 'civilian' && this.archetype.speed > 0) {
      this.timeSinceAttack += dt;
      if (this.timeSinceAttack > 7) {
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
    const toMonster = Math.atan2(monster.y - this.y, monster.x - this.x);

    // While charging, everything else is suspended: close the distance.
    if (this.charging > 0 && this.state !== 'windup' && this.state !== 'recover') {
      this.moveToward(toMonster, dt, 1.15);
      this.facing = damp(this.facing, toMonster, 10, dt);
      if (this.attackCooldown <= 0 && distance <= a.attackRange && (a.role !== 'ranged' || hasLos)) {
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

    const canAttack =
      this.state !== 'windup' &&
      this.state !== 'recover' &&
      this.attackCooldown <= 0 &&
      distance <= a.attackRange &&
      (a.role !== 'ranged' || hasLos);

    if (canAttack) this.beginAttack(world);
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

    const toMonster = Math.atan2(monster.y - this.y, monster.x - this.x);
    if (distance < a.preferredRange * 0.7) this.moveToward(toMonster + Math.PI, dt, 1);
    else if (distance > a.preferredRange * 1.2) this.moveToward(toMonster, dt, 0.9);
    else this.decelerate(dt);

    if (
      this.attackCooldown <= 0 &&
      distance <= a.attackRange &&
      world.hasLineOfSight(this.x, this.y, monster.x, monster.y)
    ) {
      this.beginAttack(world);
    }
    this.advanceAttack(dt, world, distance);
    this.facing = damp(this.facing, toMonster, 8, dt);
  }

  private updateBoss(dt: number, world: World, distance: number): void {
    const monster = world.monster;
    const a = this.archetype;
    this.alerted = true;

    this.specialTimer -= dt;
    if (this.specialTimer <= 0 && this.state !== 'windup') {
      this.specialTimer = this.hp / this.maxHp < 0.5 ? 5 : 8;
      this.castSpecial(world);
      return;
    }

    const toMonster = Math.atan2(monster.y - this.y, monster.x - this.x);

    if (this.state === 'windup' || this.state === 'recover') {
      this.decelerate(dt, 5);
    } else if (distance > a.preferredRange * 1.1) {
      this.moveToward(toMonster, dt, 1);
    } else if (distance < a.preferredRange * 0.55) {
      this.moveToward(toMonster + Math.PI, dt, 0.8);
    } else {
      this.moveToward(toMonster + Math.PI / 2, dt, 0.6);
    }

    if (this.state !== 'windup' && this.state !== 'recover' && this.attackCooldown <= 0) {
      if (distance <= a.attackRange) this.beginAttack(world);
    }
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
        const tx = monster.x;
        const ty = monster.y;
        world.particles.ring(tx, ty, '#e0655f', 120, 0.75, true);
        world.sound.enemyWindup(this, 0.7);
        world.scheduleDelayed?.(0.75, (w) => {
          if (!this.alive) return;
          this.x = tx;
          this.y = ty;
          w.collideWithWorld(this);
          w.explode(
            tx,
            ty,
            130,
            [{ type: 'physical', amount: 46 * this.damageScale }],
            t('effect.warlordLeap'),
            { color: '#e0655f', knockback: 320, shake: 11 },
          );
        });
        break;
      }
      case 1: {
        // Shockwave: a ring of low projectiles racing outward along the ground.
        const count = 18;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * TAU;
          world.spawnProjectile({
            x: this.x + Math.cos(a) * 30,
            y: this.y + Math.sin(a) * 30,
            angle: a,
            speed: 300,
            packets: [{ type: 'physical', amount: 20 * this.damageScale }],
            faction: 'human',
            sourceLabel: t('effect.shockwave'),
            radius: 9,
            range: 700,
            color: '#c8a08a',
            glow: '#f0d8c0',
            shape: 'rock',
            owner: this,
            knockback: 90,
            ignoresWalls: true,
          });
        }
        world.camera.shake(9);
        break;
      }
      default: {
        // Bodyguards, not a swarm: two knights are a real problem on their own.
        for (let i = 0; i < 2; i++) {
          const a = angle + Math.PI + (i - 0.5) * 0.9;
          world.spawnHuman?.('knight', this.x + Math.cos(a) * 80, this.y + Math.sin(a) * 80, this.tier);
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
        for (let i = 1; i <= 5; i++) {
          const distance = i * 110;
          const x = this.x + Math.cos(angle) * distance;
          const y = this.y + Math.sin(angle) * distance;
          world.scheduleDelayed?.(i * 0.14, (w) => {
            w.addGroundHazard({
              x,
              y,
              radius: 74,
              life: 6,
              dps: 26 * power,
              type: 'fire',
              color: '#ff7b31',
              sourceLabel: t('effect.firewall'),
              status: { id: 'burn', duration: 4, stacks: 2, power: 4 * power, sourceLabel: t('effect.firewall') },
            });
          });
        }
        break;
      }
      case 1: {
        // Fan of bolts: dodgeable sideways, punishing if you back straight up.
        for (let i = -3; i <= 3; i++) {
          world.spawnProjectile({
            x: this.x + Math.cos(angle) * 24,
            y: this.y + Math.sin(angle) * 24,
            angle: angle + i * 0.17,
            speed: 380,
            packets: [{ type: 'fire', amount: 18 * power }],
            faction: 'human',
            sourceLabel: t('effect.emberFan'),
            radius: 7,
            range: 800,
            color: '#ff7b31',
            glow: '#ffd27a',
            shape: 'spit',
            owner: this,
            statuses: [{ id: 'burn', duration: 4, stacks: 1, power: 3 * power, sourceLabel: t('effect.emberFan') }],
          });
        }
        break;
      }
      default: {
        // Ring of fire around itself — you cannot simply stand on top of it.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          world.addGroundHazard({
            x: this.x + Math.cos(a) * 110,
            y: this.y + Math.sin(a) * 110,
            radius: 70,
            life: 7,
            dps: 22 * power,
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
        const count = 14;
        const gap = world.rng.int(0, count - 1);
        for (let i = 0; i < count; i++) {
          if (i === gap || i === (gap + 1) % count) continue;
          const angle = (i / count) * TAU;
          world.spawnProjectile({
            x: this.x + Math.cos(angle) * 26,
            y: this.y + Math.sin(angle) * 26,
            angle,
            speed: 210,
            packets: [{ type: 'holy', amount: 22 * this.damageScale }],
            faction: 'human',
            sourceLabel: t('effect.divineJudgment'),
            radius: 7,
            range: 900,
            color: '#ffe9a8',
            glow: '#fffdf0',
            shape: 'orb',
            owner: this,
          });
        }
        world.particles.ring(this.x, this.y, '#ffe9a8', 60, 0.5);
        world.camera.shake(5);
        break;
      }
      case 1: {
        // Consecrated ground under the player's feet, forcing them to move.
        const tx = monster.x;
        const ty = monster.y;
        world.particles.ring(tx, ty, '#ffd98a', 90, 0.9, true);
        world.scheduleDelayed?.(0.9, (w) => {
          w.explode(
            tx,
            ty,
            110,
            [{ type: 'holy', amount: 40 * this.damageScale }],
            t('effect.consecration'),
            { color: '#ffe9a8', hurtsBuildings: false, shake: 7 },
          );
        });
        break;
      }
      default: {
        // Call the faithful.
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * TAU + world.rng.next();
          world.spawnHuman?.(
            world.rng.bool(0.5) ? 'militia' : 'archer',
            this.x + Math.cos(angle) * 90,
            this.y + Math.sin(angle) * 90,
            this.tier,
          );
        }
        world.texts.add(this.x, this.y - 40, t('text.lightCalls'), '#ffe9a8', 18);
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
    for (const other of world.humansInRadius(this.x, this.y, this.radius * 2.4)) {
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

  override draw(ctx: CanvasRenderingContext2D, world: World): void {
    const a = this.archetype;
    const bob = Math.sin(this.stride) * 2;
    const lean = Math.cos(this.stride) * 0.08;
    const isBoss = a.role === 'boss';
    const scale = isBoss ? 1.9 : 1;

    ctx.save();
    ctx.translate(this.x, this.y);

    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, this.radius * 0.6, this.radius * 0.95, this.radius * 0.36, 0, 0, TAU);
    ctx.fill();

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

    ctx.translate(0, bob - this.radius * 0.4);
    ctx.rotate(lean);
    ctx.scale(scale, scale);

    const flash = this.hitFlash;
    const tint = this.statuses.tint();

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

  private drawWeapon(ctx: CanvasRenderingContext2D): void {
    const a = this.archetype;
    // The weapon swings forward through the wind-up, so the telegraph is readable.
    const swing = this.state === 'windup' ? -0.9 + this.windupProgress * 1.7 : 0;

    ctx.save();
    ctx.rotate(this.facing + swing);
    ctx.translate(this.radius * 0.6, 0);

    switch (a.id) {
      case 'spearman':
        ctx.strokeStyle = '#6b5334';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(this.radius * 2.6, 0);
        ctx.stroke();
        ctx.fillStyle = a.accent;
        ctx.beginPath();
        ctx.moveTo(this.radius * 2.6, 0);
        ctx.lineTo(this.radius * 2.1, -3.5);
        ctx.lineTo(this.radius * 2.1, 3.5);
        ctx.closePath();
        ctx.fill();
        break;

      case 'archer':
        ctx.strokeStyle = '#6b5334';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(2, 0, this.radius * 0.85, -1.2, 1.2);
        ctx.stroke();
        break;

      case 'crossbowman':
      case 'ballista':
        ctx.fillStyle = '#5c4c38';
        ctx.fillRect(-2, -2, this.radius * 1.6, 4);
        ctx.fillRect(this.radius * 0.5, -this.radius * 0.7, 3, this.radius * 1.4);
        break;

      case 'torchbearer': {
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
        break;
      }

      case 'priest':
      case 'inquisitor': {
        ctx.strokeStyle = a.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -this.radius * 0.4);
        ctx.lineTo(0, this.radius * 1.2);
        ctx.moveTo(-4, this.radius * 0.1);
        ctx.lineTo(4, this.radius * 0.1);
        ctx.stroke();
        break;
      }

      case 'warlord': {
        // A two-handed maul: a long haft with a heavy head.
        ctx.strokeStyle = '#4a3a2c';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(this.radius * 1.9, 0);
        ctx.stroke();
        ctx.fillStyle = a.accent;
        ctx.fillRect(this.radius * 1.7, -7, 12, 14);
        break;
      }

      case 'pyromancer': {
        // A burning brand held out front.
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
        break;
      }

      case 'knight':
        ctx.fillStyle = a.accent;
        ctx.fillRect(-2, -2.5, this.radius * 1.7, 5);
        // Shield on the off hand.
        ctx.rotate(-1.6);
        ctx.fillStyle = '#8d939e';
        ctx.beginPath();
        ctx.ellipse(this.radius * 0.5, 0, this.radius * 0.4, this.radius * 0.75, 0, 0, TAU);
        ctx.fill();
        break;

      case 'militia':
        ctx.fillStyle = '#b4a583';
        ctx.fillRect(-2, -2, this.radius * 1.3, 4);
        break;

      default:
        // Civilians carry nothing worth drawing.
        break;
    }

    ctx.restore();
  }

  private drawOverlays(ctx: CanvasRenderingContext2D, world: World): void {
    const a = this.archetype;
    const isBoss = a.role === 'boss';

    // Health bar, only once wounded (or always for the boss).
    if (this.hp < this.maxHp || isBoss) {
      const w = isBoss ? 70 : Math.max(20, this.radius * 2.2);
      const h = isBoss ? 6 : 3;
      const y = -this.radius * (isBoss ? 3.4 : 2.4);

      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w / 2 - 1, y - 1, w + 2, h + 2);
      ctx.fillStyle = isBoss ? '#c0343c' : '#a8232a';
      ctx.fillRect(-w / 2, y, w * this.healthFraction, h);
      ctx.restore();
    }

    // Wind-up telegraph: a growing arc in the attack direction.
    if (this.state === 'windup') {
      ctx.save();
      ctx.translate(this.x, this.y);
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
      ctx.translate(this.x, this.y - this.radius * 2.9);
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
    for (const other of world.humansInRadius(this.x, this.y, 260)) {
      if (other === this || !other.alive) continue;
      const fraction = other.healthFraction;
      if (fraction < worstFraction) {
        worstFraction = fraction;
        best = other;
      }
    }
    return best;
  }
}

/** Damage options helper used by the monster's melee sweep. */
export function meleeOptions(
  packets: DamagePacket[],
  label: string,
  dirX: number,
  dirY: number,
  knockback: number,
  crit: boolean,
  lifesteal: number,
  armorPen: number,
): DamageOptions {
  return {
    packets,
    sourceLabel: label,
    kind: 'attack',
    crit,
    lifesteal,
    armorPen,
    knockback,
    dirX,
    dirY,
    dodgeable: true,
  };
}
