import type { BuildingKind } from './entities/building';

// ---------------------------------------------------------------------------
// Horde mode balance — split out of `balance.ts` so the numbers that make one
// survival attempt feel too easy or too hard can be found and edited in one small
// file instead of hunting through the ~2800-line campaign balance sheet.
//
// Progress is a permanent ladder in `MetaProgress.hordeLevelUnlocked` — surviving
// level N unlocks N+1 forever, independent of any single run. Nothing here affects
// the campaign; see `src/world/hordegen.ts` and `src/world/hordewaves.ts` for how
// these numbers get used.
// ---------------------------------------------------------------------------

/**
 * One tier of the campaign's `ENEMY_TIER_SCALING` (in `balance.ts`) compounds HP by
 * 1.13x and damage by 1.08x, so a whole level's difficulty is expressed as a tier
 * *range* (`startTier` here, climbing at `HORDE_WAVE_CONFIG.tierPerMinute` per
 * elapsed minute) rather than a flat number.
 *
 * Levels chain: each one starts where the previous finished
 * (`startTier(n+1) = startTier(n) + tierPerMinute * targetSeconds/60`), and level 1
 * itself starts above zero (tier 5, not the campaign's room-1 tier 0) — Horde is
 * meant to read as a real fight from the first wave, not ease in the way an early
 * campaign room does.
 */
export const HORDE_LEVELS: readonly { level: number; targetSeconds: number; startTier: number }[] = [
  { level: 1, targetSeconds: 720, startTier: 5 },
  { level: 2, targetSeconds: 720, startTier: 22 },
  { level: 3, targetSeconds: 720, startTier: 39 },
  { level: 4, targetSeconds: 720, startTier: 56 },
  { level: 5, targetSeconds: 720, startTier: 73 },
];

/**
 * Layout for the Horde arena — wide and shallow instead of the campaign's
 * near-square rooms, so buildings read as lanes to march down rather than a
 * village ring. Built entirely from existing `BuildingKind`s (see `hordegen.ts`);
 * no new building types for v1.
 */
export const HORDE_ARENA_CONFIG = {
  width: 2400,
  height: 1100,
  /** Rows of buildings running the arena's long axis. */
  lanes: 3,
  buildingsPerLane: [3, 5] as readonly [number, number],
  palette: ['stronghold', 'watchtower', 'longhouse', 'wall', 'cart'] as readonly BuildingKind[],
  /**
   * Wave-spawn gates per edge of the arena (top/bottom/left/right all get this
   * many, evenly spaced) — waves march in from all four sides, not just the far
   * end, so standing still is never safe for long. Gates that would land on top of
   * the monster's own entry point are dropped, not moved.
   */
  spawnGatesPerEdge: 4,
};

/**
 * Live wave spawner tuning. A wave lands every `spawnIntervalSeconds`; its size
 * grows with `waveNumber` up to `maxWaveSize`. Difficulty comes from
 * `tierPerMinute`: campaign tiers of `ENEMY_TIER_SCALING` per minute survived —
 * `HORDE_LEVELS.startTier` steps between levels by exactly
 * `tierPerMinute * targetSeconds / 60`, so the two stay in sync.
 */
export const HORDE_WAVE_CONFIG = {
  spawnIntervalSeconds: 11,
  baseWaveSize: 6,
  sizeGrowthPerWave: 0.2,
  maxWaveSize: 18,
  tierPerMinute: 1.4,
  /** Same reasoning as `MAX_SUPPORT_PER_ROOM`, scoped to one wave instead of a room. */
  maxSupportPerWave: 2,
  /**
   * How long the wave counter pulses before a wave actually lands. Waves now spawn
   * from gates on every edge of the arena (see `spawnGatesPerEdge`), so a beat of
   * warning before they appear is what keeps that feeling like pressure rather than
   * an unfair ambush — the horn/shake on arrival then tells you it's real.
   */
  warningLeadSeconds: 1.2,
  /**
   * Every Nth wave (5th, 10th, 15th, ...) also brings the campaign's own elite-room
   * champions (`ELITE_CHAMPIONS_EARLY`/`LATE` in balance.ts) alongside a lighter
   * normal wave, instead of only the usual weighted roster — a mini-boss beat
   * without inventing new units or risking a full campaign boss's own mechanics.
   */
  eliteWaveInterval: 5,
  /** The normal-roster portion of an elite wave shrinks to this fraction of its usual size. */
  eliteWaveNormalShare: 0.6,
};
