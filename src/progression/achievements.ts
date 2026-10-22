import { HORDE_LEVELS } from '../balance';
import type { DamageType } from '../combat/damage';
import { BOSS_IDS } from '../entities/human';
import { t } from '../i18n';
import type { RunStats } from '../stats/tracker';

/**
 * Trials — long-term goals read straight off the tracker.
 *
 * Nothing here observes the game while it runs: every trial is a pure function of a
 * finished run plus the lifetime record, evaluated once when a run ends. That keeps
 * the simulation completely unaware that achievements exist, and means a new trial
 * can be added without touching a single system.
 *
 * Trials pay souls, once. They are a reason to play differently, so the payout has
 * to be worth a detour — a fire-only victory is a genuinely worse run than a greedy
 * one, and it should buy something.
 */

export type AchievementScope = 'run' | 'life';

/**
 * The lifetime fields trials read.
 *
 * Structural on purpose: `LifetimeStats` satisfies it, but this module never imports
 * the save format, so the two can't tangle into a cycle.
 */
export interface LifetimeSnapshot {
  runs: number;
  victories: number;
  totalKills: number;
  totalBuildings: number;
  dailyRuns: number;
  /** Horde attempts, ever — kept apart from `runs`' campaign meaning nowhere else. */
  hordeRuns: number;
  killsByEnemy: Record<string, number>;
}

/** What a finished Horde run adds on top of its `RunStats`. */
export interface HordeRunSnapshot {
  level: number;
  /** Waves that had landed when the run ended. */
  wave: number;
}

export interface AchievementContext {
  /** The run that just ended. Null when the trials screen asks about lifetime ones. */
  run: RunStats | null;
  /** Set when `run` was a Horde run; null for the campaign, a daily, or no run. */
  horde: HordeRunSnapshot | null;
  lifetime: LifetimeSnapshot;
  /** Horde arenas survived at least once, from the permanent ladder. */
  hordeLevelsBeaten: number;
  /** Content owned, for the completionist trial. */
  unlockedContent: number;
  unlockableContent: number;
}

export interface AchievementDef {
  readonly id: string;
  readonly scope: AchievementScope;
  /** Souls paid the first time it is earned. */
  readonly reward: number;
  /** Earned once this reaches `target`. */
  measure(ctx: AchievementContext): number;
  readonly target: number;
  /** Numbers interpolated into the description, e.g. `{n}` kills. */
  readonly vars?: Record<string, number>;
  /** Overrides the bar shown on the trials screen when progress isn't `measure`. */
  progress?(ctx: AchievementContext): { current: number; total: number };
}

/** Share of a run's damage carried by one element. */
function share(run: RunStats, type: DamageType): number {
  return run.totalDamageDealt > 0 ? run.damageDealtByType[type] / run.totalDamageDealt : 0;
}

/**
 * How dominant an element has to be to count as "only".
 *
 * Not 100%: monsters bite, thorns reflect, and a single stray physical tick would
 * void an otherwise perfect elemental run. 70% is unmistakably a themed build.
 */
const PURITY = 0.7;

/**
 * A run-scoped trial: pass or fail on the campaign run that just ended.
 *
 * Horde runs are never judged here. The tracker calls surviving an arena a
 * 'victory', but twelve minutes against a clock is not the hunt "win in fifteen
 * minutes" or "win on fire alone" describes — counted, it handed out the
 * campaign's hardest trials for an arena-1 survival. Horde has its own below.
 */
function runTrial(
  id: string,
  reward: number,
  test: (run: RunStats) => boolean,
  vars?: Record<string, number>,
): AchievementDef {
  return {
    id,
    scope: 'run',
    reward,
    target: 1,
    measure: (ctx) => (ctx.run && !ctx.horde && test(ctx.run) ? 1 : 0),
    vars,
  };
}

/** The Horde counterpart of `runTrial`: judges only a Horde run that just ended. */
function hordeTrial(
  id: string,
  reward: number,
  test: (run: RunStats, horde: HordeRunSnapshot) => boolean,
  vars?: Record<string, number>,
): AchievementDef {
  return {
    id,
    scope: 'run',
    reward,
    target: 1,
    measure: (ctx) => (ctx.run && ctx.horde && test(ctx.run, ctx.horde) ? 1 : 0),
    vars,
  };
}

/** Climbing the Horde ladder: arenas survived at least once, from the meta ladder. */
function hordeLadderTrial(id: string, reward: number, target: number): AchievementDef {
  return {
    id,
    scope: 'life',
    reward,
    target,
    measure: (ctx) => ctx.hordeLevelsBeaten,
    vars: { n: target },
  };
}

/** A lifetime trial: a counter climbing toward a target across every run. */
function lifeTrial(
  id: string,
  reward: number,
  target: number,
  count: (lifetime: LifetimeSnapshot) => number,
): AchievementDef {
  return {
    id,
    scope: 'life',
    reward,
    target,
    measure: (ctx) => count(ctx.lifetime),
    vars: { n: target },
  };
}

/** A victory carried almost entirely by one element. */
function purityTrial(id: string, type: DamageType): AchievementDef {
  return runTrial(
    id,
    80,
    (run) => run.outcome === 'victory' && share(run, type) >= PURITY,
    { n: Math.round(PURITY * 100) },
  );
}

/** Display order is the order here: cheap and obvious first, absurd last. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  lifeTrial('first-hunt', 15, 1, (l) => l.runs),
  runTrial('flawless-room', 20, (run) => run.perfectRooms >= 1),
  runTrial('deep-dive', 25, (run) => run.roomsCleared >= 6, { n: 6 }),
  runTrial('unbroken', 30, (run) => run.bestKillStreak >= 25, { n: 25 }),
  runTrial('butcher', 40, (run) => run.totalKills >= 250, { n: 250 }),
  runTrial('arsonist', 40, (run) => run.buildingsDestroyed >= 50, { n: 50 }),
  runTrial('cataclysm', 45, (run) => run.largestHit >= 800, { n: 800 }),
  runTrial('untouchable', 70, (run) => run.perfectRooms >= 5, { n: 5 }),

  lifeTrial('first-victory', 60, 1, (l) => l.victories),
  runTrial('swift-end', 100, (run) => run.outcome === 'victory' && run.elapsed <= 900, { n: 15 }),
  runTrial('ascetic', 80, (run) => run.outcome === 'victory' && run.mutationsTaken.length === 0),
  runTrial('martyr', 90, (run) => run.outcome === 'victory' && run.cursesTaken.length >= 3, { n: 3 }),
  runTrial(
    'unscathed',
    250,
    (run) => run.outcome === 'victory' && run.totalDamageTaken <= 0,
  ),

  purityTrial('pyre-only', 'fire'),
  purityTrial('venom-only', 'poison'),
  purityTrial('rime-only', 'frost'),
  purityTrial('storm-only', 'lightning'),
  purityTrial('void-only', 'unholy'),
  runTrial('bare-claws', 60, (run) => run.outcome === 'victory' && share(run, 'physical') >= 0.9, {
    n: 90,
  }),

  lifeTrial('knight-slayer', 50, 50, (l) => l.killsByEnemy['knight'] ?? 0),
  // Not "kill ten inquisitors": a run draws one boss of three from its seed, so a
  // count of one kind would silently be three times the work it reads as. Killing
  // each of them once is the goal that actually matches the content.
  {
    id: 'three-crowns',
    scope: 'life',
    reward: 90,
    target: BOSS_IDS.length,
    measure: (ctx) => BOSS_IDS.filter((id) => (ctx.lifetime.killsByEnemy[id] ?? 0) > 0).length,
    vars: { n: BOSS_IDS.length },
  },
  lifeTrial('ruin', 60, 1000, (l) => l.totalBuildings),
  lifeTrial('veteran', 60, 25, (l) => l.runs),
  lifeTrial('depopulation', 120, 5000, (l) => l.totalKills),
  lifeTrial('warlord', 150, 5, (l) => l.victories),

  lifeTrial('daily-hunt', 20, 1, (l) => l.dailyRuns),
  lifeTrial('daily-devotion', 90, 7, (l) => l.dailyRuns),

  hordeTrial('horde-survivor', 40, (run) => run.outcome === 'victory'),
  hordeTrial('horde-massacre', 60, (run) => run.totalKills >= 500, { n: 500 }),
  // Never below half health for a whole arena: the Horde's version of "unscathed",
  // softened because waves from four edges make a zero-damage arena luck, not skill.
  hordeTrial(
    'horde-steadfast',
    120,
    (run) => run.outcome === 'victory' && run.lowestHealthFraction >= 0.5,
    { n: 50 },
  ),
  lifeTrial('horde-regular', 40, 10, (l) => l.hordeRuns),
  hordeLadderTrial('horde-halfway', 90, Math.ceil(HORDE_LEVELS.length / 2)),
  hordeLadderTrial('horde-ladder', 200, HORDE_LEVELS.length),

  {
    id: 'curator',
    scope: 'life',
    reward: 200,
    target: 1,
    measure: (ctx) =>
      ctx.unlockableContent > 0 && ctx.unlockedContent >= ctx.unlockableContent ? 1 : 0,
    progress: (ctx) => ({ current: ctx.unlockedContent, total: ctx.unlockableContent }),
  },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export function getAchievement(id: string): AchievementDef | undefined {
  return BY_ID.get(id);
}

export function achievementName(def: AchievementDef): string {
  return t(`achv.${def.id}.name`);
}

export function achievementDescription(def: AchievementDef): string {
  return t(`achv.${def.id}.desc`, def.vars);
}

/** Progress toward a trial, for the bar on the trials screen. */
export function achievementProgress(
  def: AchievementDef,
  ctx: AchievementContext,
): { current: number; total: number } {
  if (def.progress) return def.progress(ctx);
  return { current: Math.min(def.measure(ctx), def.target), total: def.target };
}

/** Everything newly earned by this context, in table order. */
export function evaluateAchievements(
  ctx: AchievementContext,
  alreadyEarned: ReadonlySet<string>,
): AchievementDef[] {
  const fresh: AchievementDef[] = [];
  for (const def of ACHIEVEMENTS) {
    if (alreadyEarned.has(def.id)) continue;
    if (def.measure(ctx) >= def.target) fresh.push(def);
  }
  return fresh;
}

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;
