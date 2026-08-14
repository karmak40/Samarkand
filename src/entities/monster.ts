import {
  type DamageOptions,
  type DamagePacket,
  type DamageResult,
  type DamageType,
  type Defenses,
  type PlayerDamageType,
} from '../combat/damage';
import { type StatusApplication } from '../combat/status';
import { type Input } from '../core/input';
import { clamp, damp, TAU } from '../core/math';
import { t } from '../i18n';
import { type BoonDef } from '../progression/boons';
import {
  cloneBody,
  createBaseBody,
  type Mutation,
  type MonsterBody,
} from '../progression/evolution';
import { DEFAULT_SPECIES_ID, resolveSpecies, speciesBody, type Species } from '../progression/species';
import { StatSheet } from '../progression/stats';
import { drawMonster } from '../render/monster-render';
import type { World } from '../world/world';
import { Combatant, type DeathContext } from './entity';
import type { Human } from './human';

/** After standing still this long, shots tighten to their full accuracy. */
const STEADY_TIME = 0.25;

/** Extra spread applied while running. Standing still is a bonus, not a gate. */
const MOVING_SPREAD_PENALTY = 2.1;

interface Orbital {
  angle: number;
  /** Per-target damage cooldowns, keyed by entity id. */
  cooldowns: Map<number, number>;
}

/** A temporary form currently worn by the monster. */
export interface ActiveBoon {
  def: BoonDef;
  remaining: number;
  /** Full duration, so the HUD can draw a depleting timer. */
  total: number;
}

/**
 * XP needed to go from `level` to the next one.
 *
 * Calibrated against the actual soul economy — a cleared settlement yields roughly
 * 12-40 souls depending on depth, so this curve lands a level about once per room
 * early on and stretches to two rooms per level by the end of a biome.
 */
export function xpRequirement(level: number): number {
  return Math.round(5 + 3 * Math.pow(level, 1.5));
}

/**
 * The player.
 *
 * Attacks fire automatically at the nearest human whether moving or not; standing
 * still only tightens the shot pattern. Everything else (elements, extra projectiles,
 * on-kill effects) is layered on top by the stat sheet and behaviour flags.
 */
export class Monster extends Combatant {
  /** The body this run started in. Fixed for the whole run. */
  readonly species: Species;

  readonly stats: StatSheet;

  /** The permanent body: base shape plus every mutation taken this run. */
  body: MonsterBody;

  /**
   * The body as it currently looks, with temporary forms layered on top.
   * Rebuilt only when a boon starts or ends — the renderer reads it every frame.
   */
  private form: MonsterBody = createBaseBody();

  private readonly boons: ActiveBoon[] = [];

  souls = 0;
  /** Souls banked this run, before the meta screen converts them. */
  soulsThisRun = 0;

  // --- experience -----------------------------------------------------------
  /** Every soul absorbed is also experience; the two are tracked separately so
   *  spending souls on rerolls never costs progress toward the next level. */
  level = 1;
  xpIntoLevel = 0;
  /** Level-ups earned but not yet spent. The draft can be opened at any moment. */
  pendingLevels = 0;

  /** Mutation ids already taken, so they are never offered twice. */
  readonly mutations = new Set<string>();

  /** Curse ids carried for the rest of the run, taken willingly at cursed altars. */
  readonly curses = new Set<string>();

  // --- combat timing --------------------------------------------------------
  private attackTimer = 0;
  private stillTime = 0;
  /** 0..1 attack animation progress, drives the lunge in the renderer. */
  attackAnim = 0;
  /** Direction the monster is aiming; the renderer leans the body toward it. */
  aim = 0;
  /** Direction of travel, used for the body's motion stretch. */
  heading = 0;

  // --- animation clocks -----------------------------------------------------
  /**
   * Gait and wing cycles are integrated rather than derived from `age * rate`.
   * Multiplying a large elapsed time by a changing rate makes the phase jump
   * whenever speed changes, which reads as the animation glitching or speeding up.
   */
  gaitPhase = 0;
  wingPhase = 0;

  // --- dash -----------------------------------------------------------------
  private dashCharges = 1;
  private dashRecharge = 0;
  dashActive = 0;

  // --- temporary buffs ------------------------------------------------------
  private frenzyTimer = 0;
  private frenzyPower = 0;

  // --- behaviour state ------------------------------------------------------
  private readonly orbitals: Orbital[] = [];
  private orbitalPhase = 0;
  private secondWindReady = true;
  /** Permanent damage bonus accumulated by the Razer legendary. */
  private razeBonus = 0;
  private auraTimer = 0;
  private regenAccumulator = 0;

  /** Current target, cached for the renderer's gaze direction. */
  target: Human | null = null;

  constructor(x: number, y: number, species: Species = resolveSpecies(DEFAULT_SPECIES_ID)) {
    super();
    this.species = species;
    // Species set *base* stats rather than modifiers, so every percentage the run
    // layers on top compounds with the body instead of drowning it out.
    this.stats = new StatSheet(species.stats);
    for (const flag of species.behaviors ?? []) this.stats.addBehavior(flag);
    this.body = speciesBody(species);
    this.x = x;
    this.y = y;
    this.faction = 'monster';
    // Derived from the body, never hardcoded: the renderer sizes the creature from
    // the same numbers, and a mismatch shows up as enemies clipping the silhouette.
    this.refreshForm();
    this.maxHp = this.stats.get('maxHp');
    this.hp = this.maxHp;
    this.dashCharges = this.stats.getInt('dashCharges');
  }

  // ---- derived -------------------------------------------------------------

  override defenses(): Defenses {
    return {
      armor: this.stats.get('armor'),
      resist: this.stats.resistances(),
      dodge: this.stats.get('dodge'),
      vulnerability: 1,
    };
  }

  get dashChargesAvailable(): number {
    return this.dashCharges;
  }

  get dashCooldownFraction(): number {
    const total = this.stats.get('dashCooldown');
    return total > 0 ? 1 - clamp(this.dashRecharge / total, 0, 1) : 1;
  }

  get isFrenzied(): boolean {
    return this.frenzyTimer > 0;
  }

  /** Multiplier applied to all outgoing damage from situational behaviours. */
  private situationalDamageMultiplier(): number {
    let mult = 1 + this.razeBonus;

    if (this.stats.has('rageAtLowHp')) {
      // Up to +80% at 1 HP, scaling smoothly, per stack diminishing.
      const missing = 1 - this.healthFraction;
      mult *= 1 + 0.8 * missing * Math.min(1, this.stats.count('rageAtLowHp') * 0.75 + 0.25);
    }

    if (this.frenzyTimer > 0) mult *= 1 + this.frenzyPower * 0.25;

    return mult;
  }

  /** Effective seconds between attacks, including frenzy. */
  attackInterval(): number {
    const speed = this.stats.get('attackSpeed') * (this.frenzyTimer > 0 ? 1 + this.frenzyPower : 1);
    return 1 / Math.max(0.2, speed);
  }

  // ---- progression ---------------------------------------------------------

  applyMutation(mutation: Mutation, world: World): void {
    this.mutations.add(mutation.id);

    if (mutation.modifiers) {
      this.stats.addModifiers(
        mutation.modifiers.map((m) => ({
          key: m.key,
          flat: m.flat,
          mult: m.mult,
          source: mutation.id,
        })),
      );
    }
    for (const behavior of mutation.behaviors ?? []) this.stats.addBehavior(behavior);

    mutation.mutate(this.body);
    this.syncMaxHp(true);
    this.refreshForm();

    world.tracker.recordMutation(mutation.id, mutation.name);
    world.sound.mutation();
    world.particles.ring(this.x, this.y, this.form.glowColor, 120, 0.8);
    world.camera.shake(8);
  }

  // ---- temporary forms -----------------------------------------------------

  /** Body the renderer should draw. Never mutate it — it is rebuilt from scratch. */
  get appearance(): MonsterBody {
    return this.form;
  }

  get activeBoons(): readonly ActiveBoon[] {
    return this.boons;
  }

  hasBoon(id: string): boolean {
    return this.boons.some((b) => b.def.id === id);
  }

  /**
   * Put on a temporary form.
   *
   * Re-picking one that is already running just tops its timer back up rather than
   * stacking a second copy of its modifiers.
   */
  grantBoon(def: BoonDef, world: World): void {
    const existing = this.boons.find((b) => b.def.id === def.id);
    if (existing) {
      existing.remaining = def.duration;
      existing.total = def.duration;
    } else {
      this.boons.push({ def, remaining: def.duration, total: def.duration });

      if (def.modifiers) {
        this.stats.addModifiers(
          def.modifiers.map((m) => ({
            key: m.key,
            flat: m.flat,
            mult: m.mult,
            source: def.id,
          })),
        );
      }
      for (const behavior of def.behaviors ?? []) this.stats.addBehavior(behavior);
      this.syncMaxHp(true);
      this.refreshForm();
    }

    world.texts.add(this.x, this.y - this.radius - 34, def.name.toUpperCase(), def.color, 19, 1);
    world.particles.ring(this.x, this.y, def.color, 110, 0.7);
    world.particles.emit({
      count: 26,
      x: this.x,
      y: this.y,
      color: def.color,
      shape: 'ember',
      speed: [60, 220],
      size: [2, 5],
      life: [0.4, 0.9],
      additive: true,
      drag: 3,
    });
    world.camera.shake(5);
    world.sound.boon(this);
  }

  private expireBoon(index: number, world: World): void {
    const boon = this.boons[index]!;
    this.boons.splice(index, 1);

    this.stats.removeBySource(boon.def.id);
    for (const behavior of boon.def.behaviors ?? []) this.stats.removeBehavior(behavior);
    // Losing max HP must not kill you: keep the ratio rather than the absolute.
    this.syncMaxHp(false);
    this.refreshForm();

    world.texts.add(this.x, this.y - this.radius - 24, t('text.boonFading', { name: boon.def.name }), '#8b8578', 13);
    world.sound.boonExpire(this);
    world.particles.emit({
      count: 12,
      x: this.x,
      y: this.y,
      color: boon.def.color,
      shape: 'smoke',
      speed: [20, 80],
      size: [5, 12],
      life: [0.4, 0.9],
    });
  }

  /**
   * Recompute the drawn body and the collision radius.
   *
   * Boons are applied in the order they were taken, so a later form wins on any
   * value it overwrites (colour, aura) while additive parts simply accumulate.
   */
  private refreshForm(): void {
    const form = cloneBody(this.body);
    for (const boon of this.boons) boon.def.shape(form);

    // Frenzy is a lighter buff with no shape of its own; give it a visible tell.
    if (this.frenzyTimer > 0) form.glowStrength += 0.35;

    this.form = form;
    this.radius = form.coreRadius * form.bulk;
  }

  /**
   * Recompute max HP after a stat change.
   * @param heal when true, the HP gained is granted immediately (mutations feel
   *             like a reward); otherwise the ratio is preserved.
   */
  syncMaxHp(heal: boolean): void {
    const newMax = this.stats.get('maxHp');
    if (newMax === this.maxHp) return;

    if (heal) {
      const gained = Math.max(0, newMax - this.maxHp);
      this.hp = Math.min(newMax, this.hp + gained);
    } else {
      const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
      this.hp = newMax * ratio;
    }
    this.maxHp = newMax;
  }

  /** XP still needed for the next level. */
  get xpForNextLevel(): number {
    return xpRequirement(this.level);
  }

  get xpFraction(): number {
    const need = this.xpForNextLevel;
    return need > 0 ? clamp(this.xpIntoLevel / need, 0, 1) : 0;
  }

  gainSouls(amount: number, world: World): void {
    this.souls += amount;
    this.soulsThisRun += amount;
    world.tracker.recordSouls(amount);

    // Souls double as experience. Levels bank up and are spent whenever the
    // player chooses, so a level-up never yanks control away mid-fight.
    this.xpIntoLevel += amount;
    let levelled = 0;
    while (this.xpIntoLevel >= this.xpForNextLevel) {
      this.xpIntoLevel -= this.xpForNextLevel;
      this.level++;
      this.pendingLevels++;
      levelled++;
      if (levelled > 20) break;
    }

    if (levelled > 0) {
      world.texts.add(this.x, this.y - this.radius - 30, t('text.levelUp', { n: this.level }), '#ffe28a', 20, 1);
      world.sound.levelUp();
      world.particles.ring(this.x, this.y, '#ffe28a', 90, 0.6);
      world.camera.shake(3);
    }

    if (this.stats.has('soulHarvest')) {
      this.heal(amount * 0.6, world, t('skill.soul-harvest.name'));
      this.grantFrenzy(0.35, world);
    }
  }

  grantFrenzy(power: number, world: World): void {
    const wasCalm = this.frenzyTimer <= 0;
    this.frenzyPower = Math.min(1.2, this.frenzyPower + power * 0.5);
    this.frenzyTimer = Math.max(this.frenzyTimer, 3);
    if (wasCalm) this.refreshForm();
    world.particles.emit({
      count: 6,
      x: this.x,
      y: this.y,
      color: '#ffb347',
      shape: 'spark',
      speed: [40, 120],
      size: [1.5, 3],
      life: [0.2, 0.5],
      additive: true,
    });
  }

  /** Called by the run when a building falls, for the Razer legendary. */
  noteBuildingRazed(): void {
    if (this.stats.has('razeBuildings')) this.razeBonus += 0.02;
  }

  onRoomStart(world: World): void {
    this.secondWindReady = true;
    this.dashCharges = this.stats.getInt('dashCharges');
    this.dashRecharge = 0;

    const shield = this.stats.get('shieldOnRoom');
    if (shield > 0) this.addShield(shield);

    // Devouring a settlement mends you a little. Without this, chip damage
    // compounds across rooms and a run is decided by attrition rather than by
    // whether you can handle the room in front of you.
    if (this.hp < this.maxHp && world.tracker.roomsCleared > 0) {
      const mended = this.maxHp * 0.14 * this.stats.get('healingReceived');
      this.hp = Math.min(this.maxHp, this.hp + mended);
    }

    this.syncOrbitals();
  }

  private syncOrbitals(): void {
    const wanted = this.stats.count('orbitingSpawn') * 2;
    while (this.orbitals.length < wanted) {
      this.orbitals.push({
        angle: (this.orbitals.length / Math.max(1, wanted)) * TAU,
        cooldowns: new Map(),
      });
    }
    if (this.orbitals.length > wanted) this.orbitals.length = wanted;
  }

  // ---- damage --------------------------------------------------------------

  override takeDamage(
    options: DamageOptions,
    world: World,
    attacker: Combatant | null,
  ): DamageResult {
    // Dash grants brief invulnerability; that's the whole point of dashing.
    if (this.dashActive > 0 && options.kind !== 'dot') {
      world.onDodge(this);
      return {
        total: 0,
        byType: {},
        crit: false,
        dodged: true,
        applied: 0,
        overkill: 0,
        lethal: false,
      };
    }

    const result = super.takeDamage(options, world, attacker);

    if (result.applied > 0) {
      world.tracker.recordHealth(this.healthFraction);
      // Getting hit briefly protects against follow-ups, so a crowd can't chain-stun.
      if (options.kind === 'attack' || options.kind === 'contact') this.invulnerable = 0.25;

      const thorns = this.stats.get('thorns');
      if (thorns > 0 && attacker && attacker.alive && attacker.faction === 'human') {
        attacker.takeDamage(
          {
            packets: [{ type: 'unholy', amount: result.applied * thorns }],
            sourceLabel: t('effect.thorns'),
            kind: 'thorns',
            dodgeable: false,
          },
          world,
          this,
        );
      }
    }

    // Second wind converts a lethal blow into a comeback, once per room.
    if (!this.alive && this.secondWindReady && this.stats.has('secondWind')) {
      this.secondWindReady = false;
      this.revive(world, 0.25, t('effect.secondWind'), () => world.sound.secondWind());
    }

    return result;
  }

  /**
   * Bring the monster back from a killing blow.
   *
   * Shared by the in-run second-wind proc and the meta-level ad revive offered from
   * `Game` — both need the same choreography, not just the same effect on `hp`. Health
   * restored to a *fraction* of max rather than a flat amount, so a revive stays
   * proportionate to whatever curses or upgrades have changed the ceiling this run.
   * The crowd is knocked back and frightened off regardless of who granted the
   * revive, or it would be undone on the very next tick by whoever landed the kill.
   */
  revive(world: World, healthFraction: number, label: string, playSound: () => void): void {
    this.alive = true;
    this.hp = this.maxHp * healthFraction;
    this.invulnerable = 1.4;
    this.deathTime = -1;
    world.camera.shake(14);
    world.particles.ring(this.x, this.y, '#ffe28a', 180, 0.9);
    world.texts.add(this.x, this.y - 40, label.toUpperCase(), '#ffe28a', 22, 1);
    playSound();
    for (const human of world.humansInRadius(this.x, this.y, 200)) {
      const angle = Math.atan2(human.y - this.y, human.x - this.x);
      human.vx += Math.cos(angle) * 420;
      human.vy += Math.sin(angle) * 420;
      human.statuses.apply({ id: 'fear', duration: 2.5, sourceLabel: label });
    }
  }

  protected override onDeath(world: World, ctx: DeathContext): void {
    world.tracker.outcome = 'death';
    world.tracker.killedBy = ctx.sourceLabel;
    world.camera.shake(20);
    world.camera.freeze(0.35);
    world.sound.death();
    world.particles.emit({
      count: 70,
      x: this.x,
      y: this.y,
      color: this.form.glowColor,
      shape: 'ember',
      speed: [80, 380],
      size: [3, 8],
      life: [0.6, 1.6],
      additive: true,
      drag: 1.6,
    });
  }

  protected override recordDamage(): void {
    // Damage taken is recorded centrally in World.onDamageDealt.
  }

  // ---- attack construction -------------------------------------------------

  /**
   * Build one attack's damage packets and status applications from the current
   * stat sheet. Physical is the base; every conversion adds a *new* packet on top
   * rather than replacing physical, so elemental builds are additive power.
   */
  buildAttack(crit: boolean): { packets: DamagePacket[]; statuses: StatusApplication[] } {
    const base = this.stats.get('damage') * this.situationalDamageMultiplier();
    const critMult = crit ? 1 + this.stats.get('critDamage') : 1;
    const statusPower = this.stats.get('statusPower');
    const statusDuration = this.stats.get('statusDuration');

    const packets: DamagePacket[] = [
      {
        type: 'physical',
        amount: base * this.stats.damageMultiplierFor('physical') * critMult,
      },
    ];
    const statuses: StatusApplication[] = [];

    for (const { type, fraction } of this.stats.conversions()) {
      const amount = base * fraction * this.stats.damageMultiplierFor(type) * critMult;
      packets.push({ type, amount });
      const status = statusFor(type, base * fraction, statusPower, statusDuration);
      if (status) statuses.push(status);
    }

    if (crit && this.stats.has('bleedOnCrit')) {
      statuses.push({
        id: 'bleed',
        duration: 5 * statusDuration,
        stacks: 2,
        power: base * 0.12 * statusPower,
        sourceLabel: t('effect.hemorrhage'),
      });
    }

    if (this.stats.has('curseOnHit')) {
      statuses.push({
        id: 'curse',
        duration: 5 * statusDuration,
        stacks: 1,
        sourceLabel: t('status.curse.name'),
      });
    }

    return { packets, statuses };
  }

  private rollCrit(world: World): boolean {
    return world.rng.next() < this.stats.get('critChance');
  }

  private fire(world: World, target: Human): void {
    const crit = this.rollCrit(world);
    const { packets, statuses } = this.buildAttack(crit);

    const count = this.stats.getInt('projectiles');
    const projectileSpeed = this.stats.get('projectileSpeed');

    // Firing on the move is allowed, but the pattern opens up until you plant your
    // feet. That keeps standing still worth doing without forbidding the shot.
    const steadiness = clamp(this.stillTime / STEADY_TIME, 0, 1);
    const spread = this.stats.get('spread') * (MOVING_SPREAD_PENALTY - (MOVING_SPREAD_PENALTY - 1) * steadiness);

    // Aim where the target *will* be. Without this, anything that strafes or flees
    // is nearly unhittable at range and the auto-attack feels broken.
    const lead = interceptPoint(
      this.x,
      this.y,
      target.x,
      target.y,
      target.vx,
      target.vy,
      projectileSpeed,
    );
    const baseAngle = Math.atan2(lead.y - this.y, lead.x - this.x);
    this.aim = baseAngle;

    const perProjectile = 1 / Math.sqrt(Math.max(1, count));
    // Extra projectiles each carry slightly less damage, so +N shots is strong but
    // not strictly better than +N% damage.
    const scaled = packets.map((p) => ({ type: p.type, amount: p.amount * perProjectile }));

    const lifesteal = this.stats.get('lifesteal');
    const armorPen = this.stats.get('armorPen');
    const knockback = this.stats.get('knockback');
    const homing = this.stats.has('homing') ? 3 * this.stats.count('homing') : 0;
    const executeThreshold = this.stats.has('executeWeak') ? this.stats.get('executeThreshold') : 0;
    const burning = this.stats.has('burningGround');
    const chain = this.stats.has('chainLightning');
    const chainJumps = this.stats.count('chainLightning') + 1;

    for (let i = 0; i < count; i++) {
      // Fan the shots symmetrically around the aim direction. A single projectile
      // still drifts a little while running, so movement has a real cost.
      const offset =
        count === 1
          ? (world.rng.next() - 0.5) * spread * (1 - steadiness) * 2
          : (i / (count - 1) - 0.5) * (spread + 0.12 * (count - 1));

      world.spawnProjectile({
        x: this.x + Math.cos(baseAngle) * (this.radius * 0.8),
        y: this.y + Math.sin(baseAngle) * (this.radius * 0.8),
        angle: baseAngle + offset,
        speed: projectileSpeed,
        packets: scaled,
        faction: 'monster',
        sourceLabel: t('effect.corruptedClaw'),
        radius: 6 * this.stats.get('projectileSize'),
        range: this.stats.get('range'),
        pierce: this.stats.getInt('pierce'),
        bounce: this.stats.getInt('bounce'),
        homing,
        crit,
        lifesteal,
        armorPen,
        knockback,
        color: this.form.glowColor,
        glow: lighten(this.form.glowColor),
        shape: 'claw',
        statuses,
        owner: this,
        damagesBuildings: this.stats.has('razeBuildings'),
        onHit: (hitTarget, w) => {
          if (executeThreshold > 0 && hitTarget.faction === 'human') {
            const human = hitTarget as Human;
            if (human.healthFraction <= executeThreshold && human.archetype.role !== 'boss') {
              human.takeDamage(
                {
                  packets: [{ type: 'true', amount: human.hp + 1 }],
                  sourceLabel: t('effect.execute'),
                  kind: 'execute',
                  dodgeable: false,
                },
                w,
                this,
              );
              w.texts.add(human.x, human.y - 24, t('text.executed'), '#ffe28a', 16, 1);
            }
          }
          if (chain && hitTarget.faction === 'human') {
            const lightning = scaled.filter((p) => p.type === 'lightning');
            if (lightning.length > 0) {
              w.chainLightning(hitTarget as Human, lightning, chainJumps, 220, t('effect.chainLightning'));
            }
          }
        },
        onExpire: burning
          ? (w, projectile) => {
              w.addGroundHazard({
                x: projectile.x,
                y: projectile.y,
                radius: 42 * this.stats.get('areaSize'),
                life: 4,
                dps: this.stats.get('damage') * 0.25 * this.stats.damageMultiplierFor('fire'),
                type: 'fire',
                color: '#ff7b31',
                sourceLabel: t('effect.scorchedGround'),
                status: {
                  id: 'burn',
                  duration: 3,
                  stacks: 1,
                  power: this.stats.get('damage') * 0.08,
                  sourceLabel: t('effect.scorchedGround'),
                },
              });
            }
          : undefined,
      });
    }

    this.attackAnim = 1;
    world.tracker.attacksFired++;
    world.sound.monsterShot(dominantElement(scaled), this);
    world.camera.shake(0.8);

    world.particles.emit({
      count: 5,
      x: this.x + Math.cos(baseAngle) * this.radius,
      y: this.y + Math.sin(baseAngle) * this.radius,
      color: this.form.glowColor,
      shape: 'spark',
      speed: [60, 180],
      size: [1.5, 3],
      life: [0.12, 0.3],
      angle: baseAngle,
      spread: 0.5,
      additive: true,
    });
  }

  // ---- movement ------------------------------------------------------------

  private tryDash(world: World, dirX: number, dirY: number): void {
    if (this.dashCharges <= 0) return;
    if (dirX === 0 && dirY === 0) {
      dirX = Math.cos(this.aim);
      dirY = Math.sin(this.aim);
    }

    this.dashCharges--;
    this.dashActive = 0.18;

    const power = this.stats.get('dashDistance') / this.dashActive;
    this.vx = dirX * power;
    this.vy = dirY * power;

    world.tracker.dashesUsed++;
    world.camera.shake(2);
    world.sound.dash(this);
    world.particles.emit({
      count: 14,
      x: this.x,
      y: this.y,
      color: this.form.glowColor,
      shape: 'smoke',
      speed: [30, 110],
      size: [5, 12],
      life: [0.25, 0.6],
      angle: Math.atan2(-dirY, -dirX),
      spread: 0.9,
    });

    if (this.stats.has('frostNova')) {
      const power2 = this.stats.get('damage') * 0.8 * this.stats.damageMultiplierFor('frost');
      const radius = 130 * this.stats.get('areaSize');
      world.explode(this.x, this.y, radius, [{ type: 'frost', amount: power2 }], t('effect.frostNova'), {
        color: '#6fd0ff',
        knockback: 40,
        hurtsBuildings: false,
        statuses: [
          {
            id: 'chill',
            duration: 4 * this.stats.get('statusDuration'),
            stacks: 4,
            sourceLabel: t('effect.frostNova'),
          },
        ],
      });
    }
  }

  // ---- per-frame -----------------------------------------------------------

  /** Called by the game before `update`, so input never leaks into the simulation. */
  handleInput(input: Input, world: World, dt: number): void {
    const axis = input.moveAxis();
    const moving = axis.x !== 0 || axis.y !== 0;

    if (input.wasPressed('dash')) this.tryDash(world, axis.x, axis.y);

    if (this.dashActive <= 0) {
      const targetSpeed = this.stats.get('moveSpeed') * this.statuses.moveMultiplier();
      const desiredVx = axis.x * targetSpeed;
      const desiredVy = axis.y * targetSpeed;
      // Snappy acceleration, slower deceleration — feels responsive without ice.
      const rate = moving ? 18 : 12;
      this.vx = damp(this.vx, desiredVx, rate, dt);
      this.vy = damp(this.vy, desiredVy, rate, dt);
      if (moving) this.heading = Math.atan2(axis.y, axis.x);
    }

    // Tracked for shot steadiness only — moving no longer blocks the attack.
    if (moving) this.stillTime = 0;
    else this.stillTime += dt;
  }

  override update(dt: number, world: World): void {
    this.updateCommon(dt, world);
    if (!this.alive) return;

    if (this.dashActive > 0) {
      this.dashActive -= dt;
      if (this.dashActive <= 0) {
        // Bleed off most of the dash momentum so it doesn't fling you into a wall.
        this.vx *= 0.35;
        this.vy *= 0.35;
      }
    }

    // Dash recharge.
    const maxCharges = this.stats.getInt('dashCharges');
    if (this.dashCharges < maxCharges) {
      this.dashRecharge += dt;
      if (this.dashRecharge >= this.stats.get('dashCooldown')) {
        this.dashRecharge = 0;
        this.dashCharges++;
      }
    } else {
      this.dashRecharge = 0;
    }

    if (this.frenzyTimer > 0) {
      this.frenzyTimer -= dt;
      if (this.frenzyTimer <= 0) {
        this.frenzyPower = 0;
        this.refreshForm();
      }
    }

    // Temporary forms. Iterated backwards so an expiry can splice safely.
    for (let i = this.boons.length - 1; i >= 0; i--) {
      const boon = this.boons[i]!;
      boon.remaining -= dt;
      if (boon.remaining <= 0) this.expireBoon(i, world);
    }
    this.emitBoonAmbience(dt, world);

    // Regeneration accrues fractionally so low regen values still tick.
    const regen = this.stats.get('hpRegen');
    if (regen > 0 && this.hp < this.maxHp) {
      this.regenAccumulator += regen * dt;
      if (this.regenAccumulator >= 1) {
        const whole = Math.floor(this.regenAccumulator);
        this.regenAccumulator -= whole;
        this.hp = Math.min(this.maxHp, this.hp + whole);
      }
    }

    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt * 5);

    // Integrate the animation clocks so a change of pace speeds the cycle up
    // smoothly instead of teleporting it to a new phase.
    const travelSpeed = Math.hypot(this.vx, this.vy);
    this.gaitPhase += (3 + Math.min(9, travelSpeed / 32)) * dt;
    this.wingPhase += (4 + Math.min(1.3, travelSpeed / 320) * 8) * dt;
    if (this.gaitPhase > TAU * 1000) this.gaitPhase -= TAU * 1000;
    if (this.wingPhase > TAU * 1000) this.wingPhase -= TAU * 1000;

    // Movement integration.
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    world.collideWithWorld(this);
    world.tracker.distanceTravelled += Math.hypot(this.vx, this.vy) * dt;
    this.pushHumansOut(world);

    this.updateAttack(dt, world);
    this.updateOrbitals(dt, world);
    this.updateAuras(dt, world);
  }

  /**
   * Eject any human the monster just walked into.
   *
   * Humans already separate themselves, but they update before the monster moves,
   * so charging into a crowd leaves a frame of overlap — enough to see bodies
   * clipping into the silhouette. Resolving again from this side removes it.
   */
  private pushHumansOut(world: World): void {
    for (const human of world.humansInRadius(this.x, this.y, this.radius + 24)) {
      if (!human.alive) continue;
      const dx = human.x - this.x;
      const dy = human.y - this.y;
      const d = Math.hypot(dx, dy);
      const minDist = this.radius + human.radius;
      if (d >= minDist) continue;

      const nx = d > 1e-3 ? dx / d : Math.cos(human.id);
      const ny = d > 1e-3 ? dy / d : Math.sin(human.id);
      human.x = this.x + nx * minDist;
      human.y = this.y + ny * minDist;
      world.collideWithWorld(human);
    }
  }

  private updateAttack(dt: number, world: World): void {
    const range = this.stats.get('range');
    this.target = world.nearestHuman(this.x, this.y, range, true);

    if (this.target) {
      // Always face the target, even while moving — it reads as "stalking".
      const desired = Math.atan2(this.target.y - this.y, this.target.x - this.x);
      this.aim = damp(this.aim, desired, 12, dt);
    } else if (this.speed > 20) {
      this.aim = damp(this.aim, this.heading, 6, dt);
    }

    // Dashing is the only thing that interrupts the attack rhythm.
    if (this.dashActive > 0) return;

    this.attackTimer -= dt;
    if (this.attackTimer > 0) return;
    if (!this.target) return;

    this.fire(world, this.target);
    this.attackTimer = this.attackInterval();
  }

  private updateOrbitals(dt: number, world: World): void {
    if (this.orbitals.length === 0) return;

    this.orbitalPhase += dt * 2.2;
    const distance = 62 * this.stats.get('areaSize');
    const damage = this.stats.get('damage') * 0.45 * this.situationalDamageMultiplier();

    for (let i = 0; i < this.orbitals.length; i++) {
      const orb = this.orbitals[i]!;
      orb.angle = this.orbitalPhase + (i / this.orbitals.length) * TAU;
      const ox = this.x + Math.cos(orb.angle) * distance;
      const oy = this.y + Math.sin(orb.angle) * distance;

      for (const [id, time] of orb.cooldowns) {
        const next = time - dt;
        if (next <= 0) orb.cooldowns.delete(id);
        else orb.cooldowns.set(id, next);
      }

      for (const human of world.humansInRadius(ox, oy, 20)) {
        if (orb.cooldowns.has(human.id)) continue;
        orb.cooldowns.set(human.id, 0.4);
        human.takeDamage(
          {
            packets: [{ type: 'unholy', amount: damage }],
            sourceLabel: t('effect.broodContact'),
            kind: 'contact',
            knockback: 30,
            dirX: human.x - this.x,
            dirY: human.y - this.y,
            dodgeable: false,
          },
          world,
          this,
        );
      }
    }
  }

  /**
   * Trailing particles while a form is worn.
   *
   * The aura gradient alone is easy to lose against a bright fight; a steady drip
   * of embers in the boon's colour keeps the transformation legible in motion.
   */
  private emitBoonAmbience(dt: number, world: World): void {
    if (this.boons.length === 0) return;

    for (const boon of this.boons) {
      // Roughly eight puffs a second per form, with a flare as it runs out.
      const urgency = boon.remaining < 3 ? 2.4 : 1;
      if (world.rng.next() > dt * 8 * urgency) continue;

      const angle = world.rng.next() * TAU;
      const distance = this.radius * world.rng.range(0.5, 1.05);
      world.particles.emit({
        count: 1,
        x: this.x + Math.cos(angle) * distance,
        y: this.y + Math.sin(angle) * distance,
        color: boon.def.color,
        shape: 'ember',
        speed: [8, 46],
        size: [2, 4.5],
        life: [0.35, 0.8],
        additive: true,
        gravity: -55,
        drag: 2,
      });
    }
  }

  private updateAuras(dt: number, world: World): void {
    this.auraTimer -= dt;
    if (this.auraTimer > 0) return;
    this.auraTimer = 0.5;

    if (this.stats.has('terrorAura')) {
      const radius = 170 * this.stats.get('areaSize');
      for (const human of world.humansInRadius(this.x, this.y, radius)) {
        if (human.archetype.role === 'boss') continue;
        // Only the weak break; knights and priests hold the line.
        if (human.archetype.courage >= 0.9) continue;
        human.statuses.apply({ id: 'fear', duration: 1.2, sourceLabel: t('effect.terrorAura') });
      }
    }
  }

  override draw(ctx: CanvasRenderingContext2D, world: World): void {
    drawMonster(ctx, this, world);
  }

  /** Orbital positions, for the renderer. */
  orbitalPositions(): Array<{ x: number; y: number }> {
    const distance = 62 * this.stats.get('areaSize');
    return this.orbitals.map((o) => ({
      x: this.x + Math.cos(o.angle) * distance,
      y: this.y + Math.sin(o.angle) * distance,
    }));
  }
}

/**
 * Where to aim so a constant-speed projectile meets a constant-velocity target.
 *
 * Solved by fixed-point iteration rather than the quadratic: two passes are already
 * accurate to a few pixels at gameplay speeds, and it degrades gracefully when the
 * target is faster than the projectile (the quadratic has no solution there).
 */
function interceptPoint(
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  targetVx: number,
  targetVy: number,
  projectileSpeed: number,
): { x: number; y: number } {
  let x = targetX;
  let y = targetY;

  for (let i = 0; i < 2; i++) {
    const time = Math.hypot(x - fromX, y - fromY) / projectileSpeed;
    // Cap the lead so a knockback-launched target doesn't drag aim off-screen.
    const clamped = Math.min(time, 0.9);
    x = targetX + targetVx * clamped;
    y = targetY + targetVy * clamped;
  }

  return { x, y };
}

/** Largest packet in an attack — decides which element colours the shot's sound. */
function dominantElement(packets: readonly DamagePacket[]): DamageType {
  let best: DamageType = 'physical';
  let bestAmount = -1;
  for (const packet of packets) {
    if (packet.amount > bestAmount) {
      bestAmount = packet.amount;
      best = packet.type;
    }
  }
  return best;
}

/** Status applied by an elemental conversion on hit. */
function statusFor(
  type: PlayerDamageType,
  elementalDamage: number,
  power: number,
  duration: number,
): StatusApplication | null {
  switch (type) {
    case 'fire':
      return {
        id: 'burn',
        duration: 4 * duration,
        stacks: 1,
        power: elementalDamage * 0.35 * power,
        sourceLabel: t('status.burn.name'),
      };
    case 'poison':
      return {
        id: 'poison',
        duration: 7 * duration,
        stacks: 2,
        power: elementalDamage * 0.22 * power,
        sourceLabel: t('damageType.poison.name'),
      };
    case 'frost':
      return { id: 'chill', duration: 3 * duration, stacks: 2, sourceLabel: t('damageType.frost.name') };
    case 'lightning':
      return { id: 'shock', duration: 4 * duration, stacks: 1, sourceLabel: t('status.shock.name') };
    case 'unholy':
      return { id: 'curse', duration: 5 * duration, stacks: 1, sourceLabel: t('damageType.unholy.name') };
    default:
      return null;
  }
}

/** Cheap hex lighten for glow colours. */
function lighten(hex: string): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 70);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 70);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 70);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
