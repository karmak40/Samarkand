/**
 * Deterministic PRNG (mulberry32). Every run gets a seed so a village layout
 * can be reproduced exactly from its seed — useful for debugging and for
 * "replay this seed" later.
 */
export class RNG {
  private state: number;
  readonly seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.state = this.seed >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  /** Random element. Throws on empty input rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('RNG.pick called with an empty array');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Weighted pick. Items with weight <= 0 are never selected. */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) {
      const w = weightOf(item);
      if (w > 0) total += w;
    }
    if (total <= 0) return this.pick(items);

    let roll = this.next() * total;
    for (const item of items) {
      const w = weightOf(item);
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return item;
    }
    return items[items.length - 1]!;
  }

  /** Fisher-Yates, returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Pick `count` distinct items (or fewer if the pool is smaller). */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle(items).slice(0, count);
  }

  /** Random point on the unit circle. */
  direction(): { x: number; y: number } {
    const a = this.next() * Math.PI * 2;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  /** Roughly-normal distribution via the mean of 3 uniforms. Handy for scatter. */
  gaussian(mean = 0, spread = 1): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    return mean + (u - 0.5) * 2 * spread;
  }

  /** Fork a child generator — lets subsystems draw numbers without disturbing each other. */
  fork(): RNG {
    return new RNG((this.next() * 0xffffffff) >>> 0);
  }
}

/** Shared generator for cosmetic-only randomness (particles, screen shake jitter). */
export const cosmeticRng = new RNG();
