import { type DamageType, type PlayerDamageType } from '../combat/damage';

/**
 * Every number that a skill, mutation or meta upgrade is allowed to touch.
 * Adding a stat here and giving it a base value is all that's needed to make it
 * modifiable — the skill system addresses stats purely by key.
 */
export type StatKey =
  // survivability
  | 'maxHp'
  | 'hpRegen'
  | 'lifesteal'
  | 'armor'
  | 'dodge'
  | 'thorns'
  | 'shieldOnRoom'
  // movement
  | 'moveSpeed'
  | 'dashCharges'
  | 'dashCooldown'
  | 'dashDistance'
  // offence
  | 'damage'
  | 'attackSpeed'
  | 'critChance'
  | 'critDamage'
  | 'armorPen'
  | 'knockback'
  | 'executeThreshold'
  // projectiles
  | 'projectiles'
  | 'projectileSpeed'
  | 'projectileSize'
  | 'pierce'
  | 'bounce'
  | 'range'
  | 'spread'
  // effects
  | 'areaSize'
  | 'statusPower'
  | 'statusDuration'
  | 'statusChance'
  // economy
  | 'pickupRadius'
  | 'soulGain'
  | 'healingReceived'
  // per-element damage multipliers (additive fractions, 0 = no bonus)
  | 'dmgPhysical'
  | 'dmgFire'
  | 'dmgPoison'
  | 'dmgFrost'
  | 'dmgLightning'
  | 'dmgUnholy'
  // per-element conversion: fraction of base damage *added* as that element
  | 'convFire'
  | 'convPoison'
  | 'convFrost'
  | 'convLightning'
  | 'convUnholy'
  // resistances (fractions, 0..1)
  | 'resPhysical'
  | 'resFire'
  | 'resPoison'
  | 'resFrost'
  | 'resLightning'
  | 'resUnholy'
  | 'resHoly';

/**
 * Behaviour switches. Unlike stats these are not numbers — they turn extra logic on.
 * Most are also counters (see `StatSheet.count`) so taking a skill twice stacks.
 */
export type BehaviorFlag =
  | 'ricochet'
  | 'homing'
  | 'explodeOnKill'
  | 'burningGround'
  | 'poisonCloud'
  | 'chainLightning'
  | 'frostNova'
  | 'soulHarvest'
  | 'orbitingSpawn'
  | 'rageAtLowHp'
  | 'executeWeak'
  | 'bleedOnCrit'
  | 'curseOnHit'
  | 'fearOnKill'
  | 'deathBlossom'
  | 'devourCorpses'
  | 'razeBuildings'
  | 'terrorAura'
  | 'secondWind'
  | 'glassCannon';

export interface StatModifier {
  key: StatKey;
  /** Added to the base before multipliers. */
  flat?: number;
  /** Additive fraction: two +0.2 mods give x1.4, not x1.44. Keeps stacking readable. */
  mult?: number;
  /** Where this came from, so the UI can group and the stats screen can explain. */
  source: string;
}

export const STAT_LABELS: Partial<Record<StatKey, string>> = {
  maxHp: 'Здоровье',
  hpRegen: 'Регенерация',
  lifesteal: 'Вампиризм',
  armor: 'Броня',
  dodge: 'Уклонение',
  thorns: 'Шипы',
  shieldOnRoom: 'Щит за комнату',
  moveSpeed: 'Скорость',
  dashCharges: 'Заряды рывка',
  dashCooldown: 'Откат рывка',
  dashDistance: 'Дальность рывка',
  damage: 'Урон',
  attackSpeed: 'Скорость атаки',
  critChance: 'Шанс крита',
  critDamage: 'Сила крита',
  armorPen: 'Пробитие брони',
  knockback: 'Отбрасывание',
  executeThreshold: 'Добивание',
  projectiles: 'Снарядов',
  projectileSpeed: 'Скорость снаряда',
  projectileSize: 'Размер снаряда',
  pierce: 'Пробитие',
  bounce: 'Рикошеты',
  range: 'Дальность',
  spread: 'Разброс',
  areaSize: 'Радиус эффектов',
  statusPower: 'Сила эффектов',
  statusDuration: 'Длительность эффектов',
  statusChance: 'Шанс эффектов',
  pickupRadius: 'Радиус подбора',
  soulGain: 'Добыча душ',
  healingReceived: 'Получаемое лечение',
  dmgPhysical: 'Физический урон',
  dmgFire: 'Урон огнём',
  dmgPoison: 'Урон ядом',
  dmgFrost: 'Урон морозом',
  dmgLightning: 'Урон молнией',
  dmgUnholy: 'Урон скверной',
  convFire: 'Огненная пропитка',
  convPoison: 'Ядовитая пропитка',
  convFrost: 'Морозная пропитка',
  convLightning: 'Грозовая пропитка',
  convUnholy: 'Пропитка скверной',
  resPhysical: 'Сопр. физическому',
  resFire: 'Сопр. огню',
  resPoison: 'Сопр. яду',
  resFrost: 'Сопр. морозу',
  resLightning: 'Сопр. молнии',
  resUnholy: 'Сопр. скверне',
  resHoly: 'Сопр. свету',
};

/** Stats shown as percentages in the UI rather than raw numbers. */
export const PERCENT_STATS = new Set<StatKey>([
  'lifesteal',
  'dodge',
  'critChance',
  'critDamage',
  'armorPen',
  'executeThreshold',
  'statusChance',
  'healingReceived',
  'dmgPhysical',
  'dmgFire',
  'dmgPoison',
  'dmgFrost',
  'dmgLightning',
  'dmgUnholy',
  'convFire',
  'convPoison',
  'convFrost',
  'convLightning',
  'convUnholy',
  'resPhysical',
  'resFire',
  'resPoison',
  'resFrost',
  'resLightning',
  'resUnholy',
  'resHoly',
]);

/** Stats where a lower value is an improvement (used for green/red colouring). */
export const LOWER_IS_BETTER = new Set<StatKey>(['dashCooldown', 'spread']);

export const BASE_STATS: Record<StatKey, number> = {
  maxHp: 120,
  hpRegen: 0,
  lifesteal: 0,
  armor: 0,
  dodge: 0,
  thorns: 0,
  shieldOnRoom: 0,

  moveSpeed: 210,
  dashCharges: 1,
  dashCooldown: 3,
  dashDistance: 150,

  damage: 16,
  attackSpeed: 1.7,
  critChance: 0.05,
  critDamage: 0.5,
  armorPen: 0,
  knockback: 60,
  executeThreshold: 0,

  projectiles: 1,
  projectileSpeed: 620,
  projectileSize: 1,
  pierce: 0,
  bounce: 0,
  range: 420,
  spread: 0.06,

  areaSize: 1,
  statusPower: 1,
  statusDuration: 1,
  statusChance: 1,

  pickupRadius: 110,
  soulGain: 1,
  healingReceived: 1,

  dmgPhysical: 0,
  dmgFire: 0,
  dmgPoison: 0,
  dmgFrost: 0,
  dmgLightning: 0,
  dmgUnholy: 0,

  convFire: 0,
  convPoison: 0,
  convFrost: 0,
  convLightning: 0,
  convUnholy: 0,

  resPhysical: 0,
  resFire: 0,
  resPoison: 0,
  resFrost: 0,
  resLightning: 0,
  resUnholy: 0,
  resHoly: 0,
};

const STAT_KEYS = Object.keys(BASE_STATS) as StatKey[];

/** Stats that must never go below these values, whatever the modifiers say. */
const STAT_FLOORS: Partial<Record<StatKey, number>> = {
  maxHp: 1,
  moveSpeed: 40,
  damage: 1,
  attackSpeed: 0.2,
  projectiles: 1,
  projectileSpeed: 100,
  projectileSize: 0.3,
  range: 80,
  dashCooldown: 0.3,
  spread: 0,
  areaSize: 0.2,
  healingReceived: 0,
};

/** Hard ceilings on stats that would break the game if stacked without limit. */
const STAT_CEILINGS: Partial<Record<StatKey, number>> = {
  dodge: 0.6,
  critChance: 1,
  armorPen: 0.9,
  lifesteal: 0.6,
  executeThreshold: 0.35,
  resPhysical: 0.8,
  resFire: 0.8,
  resPoison: 0.8,
  resFrost: 0.8,
  resLightning: 0.8,
  resUnholy: 0.8,
  resHoly: 0.8,
  attackSpeed: 12,
  projectiles: 16,
};

const CONVERSION_KEY: Record<Exclude<PlayerDamageType, 'physical'>, StatKey> = {
  fire: 'convFire',
  poison: 'convPoison',
  frost: 'convFrost',
  lightning: 'convLightning',
  unholy: 'convUnholy',
};

const DAMAGE_MULT_KEY: Record<PlayerDamageType, StatKey> = {
  physical: 'dmgPhysical',
  fire: 'dmgFire',
  poison: 'dmgPoison',
  frost: 'dmgFrost',
  lightning: 'dmgLightning',
  unholy: 'dmgUnholy',
};

const RESIST_KEY: Partial<Record<DamageType, StatKey>> = {
  physical: 'resPhysical',
  fire: 'resFire',
  poison: 'resPoison',
  frost: 'resFrost',
  lightning: 'resLightning',
  unholy: 'resUnholy',
  holy: 'resHoly',
};

/**
 * The monster's live stat sheet.
 *
 * Values are recomputed lazily from the modifier list rather than mutated in place.
 * That means a skill can be removed cleanly (for future "curse" mechanics) and the
 * stats screen can always show exactly which source contributed what.
 */
export class StatSheet {
  private readonly base: Record<StatKey, number>;
  private readonly modifiers: StatModifier[] = [];
  private readonly cache = { ...BASE_STATS };
  private dirty = true;

  /** Behaviour switches with a stack count. Zero means "off". */
  private readonly behaviors = new Map<BehaviorFlag, number>();

  constructor(base: Partial<Record<StatKey, number>> = {}) {
    this.base = { ...BASE_STATS, ...base };
  }

  addModifier(mod: StatModifier): void {
    this.modifiers.push(mod);
    this.dirty = true;
  }

  addModifiers(mods: readonly StatModifier[]): void {
    for (const m of mods) this.modifiers.push(m);
    this.dirty = true;
  }

  removeBySource(source: string): void {
    for (let i = this.modifiers.length - 1; i >= 0; i--) {
      if (this.modifiers[i]!.source === source) this.modifiers.splice(i, 1);
    }
    this.dirty = true;
  }

  /** Permanently shift a base value (meta upgrades use this). */
  setBase(key: StatKey, value: number): void {
    this.base[key] = value;
    this.dirty = true;
  }

  getBase(key: StatKey): number {
    return this.base[key];
  }

  get(key: StatKey): number {
    if (this.dirty) this.recompute();
    return this.cache[key];
  }

  /** Rounded integer read, for counts like projectiles and pierce. */
  getInt(key: StatKey): number {
    return Math.round(this.get(key));
  }

  private recompute(): void {
    const flat: Partial<Record<StatKey, number>> = {};
    const mult: Partial<Record<StatKey, number>> = {};

    for (const mod of this.modifiers) {
      if (mod.flat) flat[mod.key] = (flat[mod.key] ?? 0) + mod.flat;
      if (mod.mult) mult[mod.key] = (mult[mod.key] ?? 0) + mod.mult;
    }

    for (const key of STAT_KEYS) {
      let value = (this.base[key] + (flat[key] ?? 0)) * (1 + (mult[key] ?? 0));

      const floor = STAT_FLOORS[key];
      if (floor !== undefined && value < floor) value = floor;
      const ceiling = STAT_CEILINGS[key];
      if (ceiling !== undefined && value > ceiling) value = ceiling;

      this.cache[key] = value;
    }

    this.dirty = false;
  }

  // ---- behaviours ----------------------------------------------------------

  addBehavior(flag: BehaviorFlag, stacks = 1): void {
    this.behaviors.set(flag, (this.behaviors.get(flag) ?? 0) + stacks);
  }

  /** Counterpart to `addBehavior`, used when a temporary form expires. */
  removeBehavior(flag: BehaviorFlag, stacks = 1): void {
    const next = (this.behaviors.get(flag) ?? 0) - stacks;
    if (next > 0) this.behaviors.set(flag, next);
    else this.behaviors.delete(flag);
  }

  has(flag: BehaviorFlag): boolean {
    return (this.behaviors.get(flag) ?? 0) > 0;
  }

  count(flag: BehaviorFlag): number {
    return this.behaviors.get(flag) ?? 0;
  }

  behaviorList(): BehaviorFlag[] {
    return [...this.behaviors.entries()].filter(([, n]) => n > 0).map(([f]) => f);
  }

  // ---- derived combat values ----------------------------------------------

  /** Total multiplier applied to a packet of the given element. */
  damageMultiplierFor(type: DamageType): number {
    const key = DAMAGE_MULT_KEY[type as PlayerDamageType];
    if (!key) return 1;
    return 1 + this.get(key);
  }

  /** Conversion fractions for every non-physical element that has any. */
  conversions(): Array<{ type: PlayerDamageType; fraction: number }> {
    const out: Array<{ type: PlayerDamageType; fraction: number }> = [];
    for (const [type, key] of Object.entries(CONVERSION_KEY) as Array<
      [Exclude<PlayerDamageType, 'physical'>, StatKey]
    >) {
      const fraction = this.get(key);
      if (fraction > 0) out.push({ type, fraction });
    }
    return out;
  }

  resistances(): Partial<Record<DamageType, number>> {
    const out: Partial<Record<DamageType, number>> = {};
    for (const [type, key] of Object.entries(RESIST_KEY) as Array<[DamageType, StatKey]>) {
      const value = this.get(key);
      if (value !== 0) out[type] = value;
    }
    return out;
  }

  /** Seconds between auto-attacks. */
  attackInterval(): number {
    return 1 / this.get('attackSpeed');
  }

  /** Every modifier grouped by source, for the run summary screen. */
  modifiersBySource(): Map<string, StatModifier[]> {
    const grouped = new Map<string, StatModifier[]>();
    for (const mod of this.modifiers) {
      const list = grouped.get(mod.source);
      if (list) list.push(mod);
      else grouped.set(mod.source, [mod]);
    }
    return grouped;
  }

  /** Snapshot of every stat, for the end-of-run report. */
  snapshot(): Record<StatKey, number> {
    if (this.dirty) this.recompute();
    return { ...this.cache };
  }
}

/** Format a stat for display, respecting percent/integer conventions. */
export function formatStat(key: StatKey, value: number): string {
  if (PERCENT_STATS.has(key)) return `${(value * 100).toFixed(0)}%`;
  if (key === 'projectiles' || key === 'pierce' || key === 'bounce' || key === 'dashCharges') {
    return value.toFixed(0);
  }
  if (key === 'attackSpeed') return `${value.toFixed(2)}/с`;
  if (key === 'dashCooldown') return `${value.toFixed(1)}с`;
  if (Math.abs(value) >= 100) return value.toFixed(0);
  return value.toFixed(1);
}
