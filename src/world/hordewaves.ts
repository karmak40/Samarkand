import {
  CIVILIAN_FALLOFF_FLOOR,
  CIVILIAN_FALLOFF_PER_DEPTH,
  HORDE_LEVELS,
  HORDE_WAVE_CONFIG,
} from '../balance';
import type { Vec2 } from '../core/math';
import { RNG } from '../core/rng';
import { HUMAN_ARCHETYPES, type HumanId } from '../entities/human';
import { biomeEligible, type PlannedSpawn } from './roomgen';

/**
 * Maps elapsed survival time to the synthetic `tier` fed into `new Human(id, x, y,
 * tier)`. Raw elapsed seconds can't be used directly — `ENEMY_TIER_SCALING`
 * compounds per tier, so feeding it 600-900 (a 10-15 minute survival) would blow
 * past any campaign difficulty almost immediately. Instead this climbs at
 * `HORDE_WAVE_CONFIG.tierPerMinute` from the level's own starting point
 * (`HORDE_LEVELS.startTier`), so a level's difficulty stays in the same range the
 * campaign's own tier scaling was tuned for.
 */
export function hordeDifficultyTier(elapsedSeconds: number, level: number): number {
  const startTier = HORDE_LEVELS.find((l) => l.level === level)?.startTier ?? 0;
  return startTier + (elapsedSeconds / 60) * HORDE_WAVE_CONFIG.tierPerMinute;
}

/**
 * Rolls one live wave: a growing handful of defenders drawn from the same
 * biome-2 roster/weights `planSpawns` uses for the campaign war-camp, but sized by
 * `waveNumber` instead of a one-time point budget, and placed at the arena's
 * corridor-mouth `spawnPoints` instead of near a building — so a wave visibly
 * marches in from a lane rather than materializing in open ground.
 */
export function rollHordeWave(
  elapsedSeconds: number,
  waveNumber: number,
  level: number,
  spawnPoints: readonly Vec2[],
  rng: RNG,
): PlannedSpawn[] {
  const cfg = HORDE_WAVE_CONFIG;
  const tier = hordeDifficultyTier(elapsedSeconds, level);
  const size = Math.min(cfg.maxWaveSize, Math.round(cfg.baseWaveSize + waveNumber * cfg.sizeGrowthPerWave));

  const available = (Object.keys(HUMAN_ARCHETYPES) as HumanId[]).filter((id) => {
    const a = HUMAN_ARCHETYPES[id];
    return a.enabled && a.spawnWeight > 0 && a.minDepth <= tier && biomeEligible(a, 2);
  });
  if (available.length === 0 || spawnPoints.length === 0) return [];

  const isSupport = (id: HumanId): boolean => HUMAN_ARCHETYPES[id].role === 'support';
  let supportCount = 0;

  const spawns: PlannedSpawn[] = [];
  for (let i = 0; i < size; i++) {
    const id = rng.pickWeighted(available, (candidate) => {
      if (isSupport(candidate) && supportCount >= cfg.maxSupportPerWave) return 0;
      const a = HUMAN_ARCHETYPES[candidate];
      // Same shift away from civilians toward real soldiers the campaign uses,
      // driven by tier instead of room index.
      const civilianFalloff =
        a.role === 'civilian' ? Math.max(CIVILIAN_FALLOFF_FLOOR, 1 - tier * CIVILIAN_FALLOFF_PER_DEPTH) : 1;
      return a.spawnWeight * civilianFalloff;
    });
    if (isSupport(id)) supportCount++;

    const gate = spawnPoints[i % spawnPoints.length]!;
    spawns.push({ id, x: gate.x + rng.range(-40, 40), y: gate.y + rng.range(-40, 40) });
  }

  return spawns;
}
