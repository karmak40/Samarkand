import { t } from '../i18n';

/**
 * Damage model.
 *
 * An attack produces a list of packets (one per element). Each packet is mitigated
 * independently — armour only ever touches physical, resistances touch their own
 * element — then summed. This keeps "build a fire monster" and "build an armour
 * shredder" meaningfully different rather than both being "+damage".
 */

export const DAMAGE_TYPES = [
  'physical',
  'fire',
  'poison',
  'frost',
  'lightning',
  'unholy',
  'holy',
  'true',
] as const;

export type DamageType = (typeof DAMAGE_TYPES)[number];

/** Types the monster can actually build around (holy is enemy-only, true is unmitigated). */
export const PLAYER_DAMAGE_TYPES = [
  'physical',
  'fire',
  'poison',
  'frost',
  'lightning',
  'unholy',
] as const satisfies readonly DamageType[];

export type PlayerDamageType = (typeof PLAYER_DAMAGE_TYPES)[number];

export interface DamageTypeInfo {
  readonly id: DamageType;
  readonly name: string;
  /** Core colour used for projectiles, floating text and stat bars. */
  readonly color: string;
  /** Lighter tint for glow and particles. */
  readonly glow: string;
  readonly description: string;
}

export const DAMAGE_INFO: Record<DamageType, DamageTypeInfo> = {
  physical: {
    id: 'physical',
    get name() { return t('damageType.physical.name'); },
    color: '#d9cfbc',
    glow: '#fffaf0',
    get description() { return t('damageType.physical.description'); },
  },
  fire: {
    id: 'fire',
    get name() { return t('damageType.fire.name'); },
    color: '#ff7b31',
    glow: '#ffd27a',
    get description() { return t('damageType.fire.description'); },
  },
  poison: {
    id: 'poison',
    get name() { return t('damageType.poison.name'); },
    color: '#8ed44f',
    glow: '#d4ff9a',
    get description() { return t('damageType.poison.description'); },
  },
  frost: {
    id: 'frost',
    get name() { return t('damageType.frost.name'); },
    color: '#6fd0ff',
    glow: '#cdf1ff',
    get description() { return t('damageType.frost.description'); },
  },
  lightning: {
    id: 'lightning',
    get name() { return t('damageType.lightning.name'); },
    color: '#ffe45c',
    glow: '#fffbd0',
    get description() { return t('damageType.lightning.description'); },
  },
  unholy: {
    id: 'unholy',
    get name() { return t('damageType.unholy.name'); },
    color: '#b06cff',
    glow: '#e6ccff',
    get description() { return t('damageType.unholy.description'); },
  },
  holy: {
    id: 'holy',
    get name() { return t('damageType.holy.name'); },
    color: '#fff2b8',
    glow: '#ffffff',
    get description() { return t('damageType.holy.description'); },
  },
  true: {
    id: 'true',
    get name() { return t('damageType.true.name'); },
    color: '#ffffff',
    glow: '#ffffff',
    get description() { return t('damageType.true.description'); },
  },
};

export interface DamagePacket {
  type: DamageType;
  amount: number;
}

export type DamageSourceKind =
  | 'attack'
  | 'dot'
  | 'explosion'
  | 'contact'
  | 'chain'
  | 'thorns'
  | 'execute';

export interface DamageOptions {
  packets: DamagePacket[];
  /** Human-readable origin, recorded verbatim in the stats tracker. */
  sourceLabel: string;
  kind: DamageSourceKind;
  crit?: boolean;
  /** Fraction of dealt damage returned to the attacker as health. */
  lifesteal?: number;
  /** Ignores a fraction of armour, 0..1. */
  armorPen?: number;
  /** Attacks (not DoTs) can be dodged. */
  dodgeable?: boolean;
  knockback?: number;
  /** Direction of the hit, for knockback and blood spray. */
  dirX?: number;
  dirY?: number;
}

/** What a target exposes to the resolver. */
export interface Defenses {
  armor: number;
  /** Fraction reduced per type, 0..1. Missing entries mean no resistance. */
  resist: Partial<Record<DamageType, number>>;
  dodge: number;
  /** Multiplier on all incoming damage, driven by curse/vulnerability statuses. */
  vulnerability: number;
}

export interface DamageResult {
  total: number;
  byType: Partial<Record<DamageType, number>>;
  crit: boolean;
  dodged: boolean;
  /** Health actually removed, after clamping to the target's remaining HP. */
  applied: number;
  overkill: number;
  lethal: boolean;
}

/**
 * Armour uses diminishing returns rather than flat subtraction, so stacking armour
 * never reaches immunity and small hits are never fully nullified.
 * 100 armour = 50% reduction, 300 = 75%.
 */
export function armorReduction(armor: number): number {
  if (armor <= 0) return 0;
  return armor / (armor + 100);
}

/** Sum of every packet before any mitigation — used for "raw damage" telemetry. */
export function rawTotal(packets: readonly DamagePacket[]): number {
  let sum = 0;
  for (const p of packets) sum += p.amount;
  return sum;
}

/**
 * Mitigate an incoming hit. Pure — it does not touch the target's HP; the caller
 * decides what to do with the result (that keeps shields, revives and stats hooks
 * in one place at the call site).
 */
export function mitigate(
  options: DamageOptions,
  defenses: Defenses,
  roll: () => number,
): DamageResult {
  const result: DamageResult = {
    total: 0,
    byType: {},
    crit: options.crit ?? false,
    dodged: false,
    applied: 0,
    overkill: 0,
    lethal: false,
  };

  if (options.dodgeable !== false && defenses.dodge > 0 && roll() < defenses.dodge) {
    result.dodged = true;
    return result;
  }

  const armorPen = options.armorPen ?? 0;
  const effectiveArmor = Math.max(0, defenses.armor * (1 - armorPen));
  const armorCut = armorReduction(effectiveArmor);

  for (const packet of options.packets) {
    if (packet.amount <= 0) continue;

    let amount = packet.amount;

    if (packet.type === 'physical') {
      amount *= 1 - armorCut;
    } else if (packet.type !== 'true') {
      const resist = defenses.resist[packet.type] ?? 0;
      // Resistance is clamped so a "immune" enemy still takes a trickle; nothing
      // is more frustrating than an unkillable target with the wrong build.
      amount *= 1 - Math.min(0.85, resist);
    }

    amount *= defenses.vulnerability;

    if (amount <= 0) continue;
    result.byType[packet.type] = (result.byType[packet.type] ?? 0) + amount;
    result.total += amount;
  }

  return result;
}

/** Scale every packet in place-free fashion. */
export function scalePackets(packets: readonly DamagePacket[], factor: number): DamagePacket[] {
  return packets.map((p) => ({ type: p.type, amount: p.amount * factor }));
}

/** Merge packets of the same type so floating text stays readable. */
export function mergePackets(packets: readonly DamagePacket[]): DamagePacket[] {
  const acc = new Map<DamageType, number>();
  for (const p of packets) {
    if (p.amount <= 0) continue;
    acc.set(p.type, (acc.get(p.type) ?? 0) + p.amount);
  }
  return [...acc].map(([type, amount]) => ({ type, amount }));
}

/** The type that contributed the most damage — drives hit-flash colour. */
export function dominantType(byType: Partial<Record<DamageType, number>>): DamageType {
  let best: DamageType = 'physical';
  let bestAmount = -1;
  for (const key of DAMAGE_TYPES) {
    const amount = byType[key];
    if (amount !== undefined && amount > bestAmount) {
      bestAmount = amount;
      best = key;
    }
  }
  return best;
}
