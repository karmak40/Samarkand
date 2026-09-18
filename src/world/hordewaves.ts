import {
  CIVILIAN_FALLOFF_FLOOR,
  CIVILIAN_FALLOFF_PER_DEPTH,
  ELITE_CHAMPIONS_EARLY,
  ELITE_CHAMPIONS_LATE,
  ELITE_CHAMPIONS_LATE_MIN_DEPTH,
  HORDE_LEVELS,
  HORDE_WAVE_CONFIG,
} from '../balance';
import type { Vec2 } from '../core/math';
import { RNG } from '../core/rng';
import { HUMAN_ARCHETYPES, type HumanId } from '../entities/human';
import { biomeEligible, type PlannedSpawn } from './roomgen';

/** Wave sizing alone — split out so `rollHordeWave` and `isEliteWave`'s callers agree on it. */
function waveSize(waveNumber: number): number {
  const cfg = HORDE_WAVE_CONFIG;
  return Math.min(cfg.maxWaveSize, Math.round(cfg.baseWaveSize + waveNumber * cfg.sizeGrowthPerWave));
}

/**
 * Whether `waveNumber` (0-based, matching `Game.hordeWaveNumber`) is a mini-boss
 * wave — the 5th, 10th, 15th, ... to land. Exported so the HUD can telegraph it
 * during the warning beat before `rollHordeWave` actually composes it.
 */
export function isEliteWave(waveNumber: number): boolean {
  return (waveNumber + 1) % HORDE_WAVE_CONFIG.eliteWaveInterval === 0;
}

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
 *
 * Every `isEliteWave` wave also brings the campaign's elite-room champions
 * (knights, a priest — see `ELITE_CHAMPIONS_EARLY`/`LATE`) alongside a lighter
 * normal portion, the same mini-boss beat an elite battle node gives the campaign.
 */
export function rollHordeWave(
  elapsedSeconds: number,
  waveNumber: number,
  level: number,
  spawnPoints: readonly Vec2[],
  rng: RNG,
): PlannedSpawn[] {
  if (spawnPoints.length === 0) return [];

  const cfg = HORDE_WAVE_CONFIG;
  const tier = hordeDifficultyTier(elapsedSeconds, level);
  const elite = isEliteWave(waveNumber);
  const size = elite ? Math.max(1, Math.round(waveSize(waveNumber) * cfg.eliteWaveNormalShare)) : waveSize(waveNumber);

  const available = (Object.keys(HUMAN_ARCHETYPES) as HumanId[]).filter((id) => {
    const a = HUMAN_ARCHETYPES[id];
    return a.enabled && a.spawnWeight > 0 && a.minDepth <= tier && biomeEligible(a, 2);
  });

  const isSupport = (id: HumanId): boolean => HUMAN_ARCHETYPES[id].role === 'support';
  let supportCount = 0;
  const spawns: PlannedSpawn[] = [];

  const place = (id: HumanId): void => {
    const gate = spawnPoints[spawns.length % spawnPoints.length]!;
    spawns.push({ id, x: gate.x + rng.range(-40, 40), y: gate.y + rng.range(-40, 40) });
  };

  if (available.length > 0) {
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
      place(id);
    }
  }

  if (elite) {
    const champions = tier >= ELITE_CHAMPIONS_LATE_MIN_DEPTH ? ELITE_CHAMPIONS_LATE : ELITE_CHAMPIONS_EARLY;
    for (const id of champions) {
      const a = HUMAN_ARCHETYPES[id];
      if (a.enabled && biomeEligible(a, 2)) place(id);
    }
  }

  return spawns;
}
