import { RNG } from '../core/rng';
import { t } from '../i18n';
import { type RawModifier } from './skills';
import { type StatSheet } from './stats';

/**
 * A permanent debuff taken on purpose.
 *
 * Cursed altars offer a strong card at the price of one of these for the rest of the
 * run. Each is deliberately survivable on its own but hurts a specific playstyle, so
 * the interesting question is never "is this bad" but "is this bad *for my build*".
 */
export interface Curse {
  readonly id: string;
  readonly modifiers: readonly RawModifier[];
  /** Relative chance of being offered. */
  readonly weight: number;
}

export const CURSES: readonly Curse[] = [
  {
    id: 'brittleBones',
    modifiers: [{ key: 'maxHp', mult: -0.22 }],
    weight: 12,
  },
  {
    id: 'leadLimbs',
    modifiers: [{ key: 'moveSpeed', mult: -0.16 }],
    weight: 12,
  },
  {
    id: 'torpor',
    modifiers: [{ key: 'attackSpeed', mult: -0.16 }],
    weight: 12,
  },
  {
    id: 'cloudedEyes',
    modifiers: [
      { key: 'critChance', flat: -0.08 },
      { key: 'range', mult: -0.15 },
    ],
    weight: 11,
  },
  {
    id: 'rottingFlesh',
    modifiers: [
      { key: 'healingReceived', mult: -0.45 },
      { key: 'hpRegen', flat: -1.5 },
    ],
    weight: 10,
  },
  {
    id: 'peeledScales',
    modifiers: [{ key: 'armor', flat: -30 }],
    weight: 11,
  },
  {
    id: 'palsy',
    modifiers: [{ key: 'spread', mult: 0.8 }],
    weight: 10,
  },
  {
    id: 'starvedDark',
    modifiers: [{ key: 'soulGain', mult: -0.28 }],
    weight: 10,
  },
  {
    id: 'stiffHeart',
    modifiers: [{ key: 'dashCooldown', mult: 0.6 }],
    weight: 10,
  },
  {
    id: 'dullSenses',
    modifiers: [{ key: 'pickupRadius', mult: -0.4 }],
    weight: 9,
  },
];

const CURSES_BY_ID = new Map(CURSES.map((c) => [c.id, c]));

export function getCurse(id: string): Curse | undefined {
  return CURSES_BY_ID.get(id);
}

export function curseName(curse: Curse): string {
  return t(`curse.${curse.id}.name`);
}

export function curseDescription(curse: Curse): string {
  return t(`curse.${curse.id}.desc`);
}

/** Draw curses the player is not already carrying, so every offer bites. */
export function rollCurses(rng: RNG, taken: ReadonlySet<string>, count: number): Curse[] {
  const pool = CURSES.filter((c) => !taken.has(c.id));
  const source = pool.length >= count ? pool : CURSES;
  const picked: Curse[] = [];
  const remaining = source.slice();

  while (picked.length < count && remaining.length > 0) {
    const chosen = rng.pickWeighted(remaining, (c) => c.weight);
    picked.push(chosen);
    remaining.splice(remaining.indexOf(chosen), 1);
  }
  return picked;
}

/** Apply a curse for the rest of the run. Sourced by name so it is auditable. */
export function applyCurse(curse: Curse, stats: StatSheet): void {
  stats.addModifiers(
    curse.modifiers.map((m) => ({
      key: m.key,
      flat: m.flat,
      mult: m.mult,
      source: curseName(curse),
    })),
  );
}
