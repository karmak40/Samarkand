import { CURSES } from '../balance';
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
  /** Balance-file toggle: false removes this curse from the offer pool entirely. */
  readonly enabled: boolean;
  readonly modifiers: readonly RawModifier[];
  /** Relative chance of being offered. */
  readonly weight: number;
}

// The actual curse roster lives in `../balance` now — re-exporting keeps every
// existing `from './curses'` import working unchanged.
export { CURSES };

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
  const available = CURSES.filter((c) => c.enabled);
  const pool = available.filter((c) => !taken.has(c.id));
  const source = pool.length >= count ? pool : available;
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
