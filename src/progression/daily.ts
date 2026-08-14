/**
 * The daily seed.
 *
 * Every generator in a run is forked from one number, so a shared seed means a
 * shared run: the same map, the same settlements, the same cards on offer. That is
 * the whole feature — one number derived from the UTC date, identical for everyone
 * on the planet for the same 24 hours.
 *
 * UTC on purpose: a local-midnight rollover would give players in different
 * timezones different "todays", and comparing results would stop meaning anything.
 */

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` in UTC — the identity of a daily run. */
export function dailyKey(nowMs: number = Date.now()): string {
  const date = new Date(nowMs);
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Hash a date key into a run seed (FNV-1a, 32-bit).
 *
 * Any hash would do; what matters is that consecutive days look unrelated, so the
 * daily doesn't drift through a family of similar maps over a week.
 */
export function dailySeed(key: string = dailyKey()): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Short shareable form of a seed: base36, uppercase, fixed width. */
export function seedLabel(seed: number): string {
  return seed.toString(36).toUpperCase().padStart(7, '0');
}

/** Seconds until the next daily seed rolls over. */
export function secondsUntilNextDaily(nowMs: number = Date.now()): number {
  return Math.max(0, Math.round((DAY_MS - (nowMs % DAY_MS)) / 1000));
}

/** "14h 09m" — the countdown shown on the menu. */
export function formatCountdown(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${`${minutes}`.padStart(2, '0')}m`;
  return `${minutes}m`;
}
