import { describe, expect, it } from 'vitest';
import { HORDE_LEVELS, HORDE_WAVE_CONFIG } from '../balance';
import { RNG } from '../core/rng';
import { HUMAN_ARCHETYPES } from '../entities/human';
import { biomeEligible } from './roomgen';
import { hordeDifficultyTier, rollHordeWave } from './hordewaves';

const SPAWN_POINTS = [
  { x: 2000, y: 100 },
  { x: 2000, y: 500 },
  { x: 2000, y: 900 },
];

describe('hordeDifficultyTier', () => {
  it('starts each level exactly at its configured startTier', () => {
    for (const { level, startTier } of HORDE_LEVELS) {
      expect(hordeDifficultyTier(0, level)).toBe(startTier);
    }
  });

  it('climbs monotonically with elapsed time', () => {
    const level = HORDE_LEVELS[0]!.level;
    let previous = hordeDifficultyTier(0, level);
    for (let s = 30; s <= 720; s += 30) {
      const tier = hordeDifficultyTier(s, level);
      expect(tier).toBeGreaterThan(previous);
      previous = tier;
    }
  });

  it('reaches roughly the next level\'s starting tier by the end of the target duration', () => {
    // Within a couple tiers, not exact — `startTier` is a hand-picked round number in
    // balance.horde.ts, not computed from `tierPerMinute`, so a deliberate tweak to
    // either shouldn't need the other recomputed to five decimal places.
    for (let i = 0; i < HORDE_LEVELS.length - 1; i++) {
      const level = HORDE_LEVELS[i]!;
      const next = HORDE_LEVELS[i + 1]!;
      const reached = hordeDifficultyTier(level.targetSeconds, level.level);
      expect(Math.abs(reached - next.startTier)).toBeLessThan(2);
    }
  });
});

describe('rollHordeWave', () => {
  it('grows wave size with wave number, capped at maxWaveSize', () => {
    const rng = new RNG(1);
    const early = rollHordeWave(0, 0, 1, SPAWN_POINTS, rng);
    const late = rollHordeWave(600, 40, 1, SPAWN_POINTS, rng);
    expect(late.length).toBeGreaterThan(early.length);
    expect(late.length).toBeLessThanOrEqual(HORDE_WAVE_CONFIG.maxWaveSize);
  });

  it('only draws enabled, positively-weighted, biome-2-eligible archetypes', () => {
    const rng = new RNG(7);
    for (let wave = 0; wave < 20; wave++) {
      const spawns = rollHordeWave(wave * 20, wave, 3, SPAWN_POINTS, rng);
      for (const spawn of spawns) {
        const a = HUMAN_ARCHETYPES[spawn.id];
        expect(a.enabled).toBe(true);
        expect(a.spawnWeight).toBeGreaterThan(0);
        expect(biomeEligible(a, 2)).toBe(true);
      }
    }
  });

  it('places every spawn near one of the given spawn points', () => {
    const rng = new RNG(3);
    const spawns = rollHordeWave(100, 5, 2, SPAWN_POINTS, rng);
    for (const spawn of spawns) {
      const nearest = Math.min(...SPAWN_POINTS.map((p) => Math.hypot(p.x - spawn.x, p.y - spawn.y)));
      expect(nearest).toBeLessThan(60);
    }
  });

  it('returns nothing when there is nowhere to spawn', () => {
    const rng = new RNG(1);
    expect(rollHordeWave(0, 0, 1, [], rng)).toHaveLength(0);
  });

  it('is deterministic for a given seed', () => {
    const a = rollHordeWave(200, 8, 2, SPAWN_POINTS, new RNG(99));
    const b = rollHordeWave(200, 8, 2, SPAWN_POINTS, new RNG(99));
    expect(a).toEqual(b);
  });
});
