import { describe, expect, it } from 'vitest';
import { RNG } from './rng';

/**
 * Determinism is the load-bearing property here: the daily seed, "replay this run"
 * and every reproducible bug report rest on the same seed producing the same numbers
 * forever. A change to the generator that quietly shifts the sequence would break all
 * three at once and show up as nothing worse than "the map feels different today".
 */
describe('RNG determinism', () => {
  it('gives the same sequence for the same seed', () => {
    const a = new RNG(12345);
    const b = new RNG(12345);
    const left = Array.from({ length: 32 }, () => a.next());
    const right = Array.from({ length: 32 }, () => b.next());

    expect(left).toEqual(right);
  });

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 8 }, ((r) => () => r.next())(new RNG(1)));
    const b = Array.from({ length: 8 }, ((r) => () => r.next())(new RNG(2)));

    expect(a).not.toEqual(b);
  });

  it('pins the first values of a known seed', () => {
    // A canary. If the generator is ever swapped these change, and every stored seed
    // in the wild stops meaning what it meant.
    const rng = new RNG(42);
    const first = [rng.next(), rng.next(), rng.next()].map((n) => Number(n.toFixed(10)));

    expect(first).toEqual([0.6011037519, 0.448290559, 0.8524657935]);
  });
});

describe('RNG ranges', () => {
  it('stays inside [0, 1)', () => {
    const rng = new RNG(7);
    for (let i = 0; i < 5000; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('int is inclusive at both ends and never steps outside', () => {
    const rng = new RNG(9);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(rng.int(1, 4));

    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('int handles a single-value range', () => {
    const rng = new RNG(3);
    for (let i = 0; i < 50; i++) expect(rng.int(5, 5)).toBe(5);
  });
});

describe('RNG.pick', () => {
  it('throws rather than returning undefined on an empty array', () => {
    expect(() => new RNG(1).pick([])).toThrow();
  });

  it('can return every element', () => {
    const rng = new RNG(11);
    const items = ['a', 'b', 'c'];
    const seen = new Set(Array.from({ length: 400 }, () => rng.pick(items)));

    expect(seen.size).toBe(3);
  });
});

describe('RNG.pickWeighted', () => {
  it('never returns a zero-weight item while a positive one exists', () => {
    const rng = new RNG(5);
    const items = [
      { id: 'never', w: 0 },
      { id: 'always', w: 10 },
    ];

    for (let i = 0; i < 500; i++) expect(rng.pickWeighted(items, (x) => x.w).id).toBe('always');
  });

  it('falls back to a plain pick when everything weighs nothing', () => {
    const rng = new RNG(5);
    const items = [{ w: 0 }, { w: 0 }];

    expect(items).toContain(rng.pickWeighted(items, (x) => x.w));
  });

  it('respects the weights roughly', () => {
    const rng = new RNG(4242);
    const items = [
      { id: 'rare', w: 1 },
      { id: 'common', w: 9 },
    ];
    let common = 0;
    for (let i = 0; i < 4000; i++) {
      if (rng.pickWeighted(items, (x) => x.w).id === 'common') common++;
    }

    expect(common / 4000).toBeGreaterThan(0.85);
    expect(common / 4000).toBeLessThan(0.95);
  });
});

describe('RNG.fork', () => {
  it('gives each subsystem its own stream, so one drawing extra numbers cannot shift another', () => {
    const parent = new RNG(1000);
    const a = parent.fork();
    const b = parent.fork();

    expect(a.seed).not.toBe(b.seed);

    // Draining one fork leaves the other untouched.
    const bFresh = new RNG(b.seed);
    for (let i = 0; i < 100; i++) a.next();
    expect(b.next()).toBe(bFresh.next());
  });

  it('forks reproducibly from the same parent seed', () => {
    const left = new RNG(2024).fork();
    const right = new RNG(2024).fork();

    expect(left.seed).toBe(right.seed);
  });
});
