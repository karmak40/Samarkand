/**
 * The tutorial.
 *
 * Two kinds of lesson, both taught by doing rather than by reading:
 *
 *  - **Steps** run in a fixed order from the first room. Each one stays on screen
 *    until the player has actually done the thing — walked, killed, dashed, broken
 *    a wall — so nobody is moved on before it landed and nobody who already knows
 *    is held back by a timer.
 *  - **Tips** wait for the situation they explain (a relic in sight, low health,
 *    the first boss) and appear once, the first time it happens. A tip explains
 *    something that may not happen for several rooms; teaching it in the first
 *    room would only be forgotten by then.
 *
 * Everything here is pure: the game hands in a snapshot of the run and the set of
 * lessons already finished, and gets back what to show. Persistence and drawing
 * live with the profile and the HUD.
 */

/** What the game knows about the run that any lesson might care about. */
export interface TutorialContext {
  /** Seconds the current lesson has been on screen. */
  shownFor: number;
  distanceTravelled: number;
  totalKills: number;
  dashesUsed: number;
  buildingsDestroyed: number;
  /** Buildings still standing in this arena — no point teaching walls without any. */
  buildingsStanding: number;
  soulsCollected: number;
  healthFraction: number;
  /** A relic lies on the ground within sight of the monster. */
  relicInSight: boolean;
  /** Relics picked up this run. */
  relicsTaken: number;
  bossAlive: boolean;
  /** Living defenders in the arena; a step about fighting needs someone to fight. */
  humansAlive: number;
}

export interface Lesson {
  readonly id: string;
  /** Steps are taught in order; tips whenever their moment comes. */
  readonly kind: 'step' | 'tip';
  /** Whether this lesson may start now. Steps also wait for every earlier step. */
  readonly when: (ctx: TutorialContext) => boolean;
  /** Whether the player has shown they got it. */
  readonly done: (ctx: TutorialContext) => boolean;
}

/** Seconds a tip stays up when the player never acts on it — it's advice, not a gate. */
export const TIP_MAX_SECONDS = 7;
/** Seconds any lesson stays up at minimum, so a lucky first frame doesn't flash it away. */
export const LESSON_MIN_SECONDS = 1.6;
/** Seconds the "done" confirmation lingers before the next lesson comes up. */
export const LESSON_DONE_SECONDS = 0.9;

// Thresholds are read at the moment the lesson appears, not from the start of the
// run: `start` holds the snapshot taken then, so "walk a bit" means walk *now*,
// not "had walked at some point before this line was ever on screen".
export interface LessonBaseline {
  distanceTravelled: number;
  totalKills: number;
  dashesUsed: number;
  buildingsDestroyed: number;
  soulsCollected: number;
  relicsTaken: number;
}

export function baselineOf(ctx: TutorialContext): LessonBaseline {
  return {
    distanceTravelled: ctx.distanceTravelled,
    totalKills: ctx.totalKills,
    dashesUsed: ctx.dashesUsed,
    buildingsDestroyed: ctx.buildingsDestroyed,
    soulsCollected: ctx.soulsCollected,
    relicsTaken: ctx.relicsTaken,
  };
}

/**
 * Lessons in teaching order.
 *
 * `done` receives the context with every counter already made relative to the
 * moment the lesson appeared (see `relativeTo`), so each check reads as "since
 * you were told".
 */
export const LESSONS: readonly Lesson[] = [
  {
    id: 'move',
    kind: 'step',
    when: () => true,
    done: (c) => c.distanceTravelled >= 160,
  },
  {
    // The single most misunderstood thing in the game: there is no attack button.
    id: 'attack',
    kind: 'step',
    when: (c) => c.humansAlive > 0,
    done: (c) => c.totalKills >= 2,
  },
  {
    id: 'dash',
    kind: 'step',
    when: (c) => c.humansAlive > 0,
    done: (c) => c.dashesUsed >= 1,
  },
  {
    id: 'raze',
    kind: 'step',
    when: (c) => c.buildingsStanding > 0,
    done: (c) => c.buildingsDestroyed >= 1,
  },
  {
    id: 'souls',
    kind: 'tip',
    when: (c) => c.soulsCollected > 0,
    done: () => false,
  },
  {
    id: 'relic',
    kind: 'tip',
    when: (c) => c.relicInSight,
    done: (c) => c.relicsTaken >= 1,
  },
  {
    id: 'blood',
    kind: 'tip',
    when: (c) => c.healthFraction < 0.5,
    done: (c) => c.healthFraction >= 0.7,
  },
  {
    id: 'boss',
    kind: 'tip',
    when: (c) => c.bossAlive,
    done: () => false,
  },
];

const BY_ID = new Map(LESSONS.map((l) => [l.id, l]));

export function getLesson(id: string): Lesson | undefined {
  return BY_ID.get(id);
}

/** Every step, for "step 2 of 4" in the coach card. */
export const STEPS: readonly Lesson[] = LESSONS.filter((l) => l.kind === 'step');

/** The context with run-long counters turned into "since the lesson appeared". */
export function relativeTo(ctx: TutorialContext, base: LessonBaseline): TutorialContext {
  return {
    ...ctx,
    distanceTravelled: ctx.distanceTravelled - base.distanceTravelled,
    totalKills: ctx.totalKills - base.totalKills,
    dashesUsed: ctx.dashesUsed - base.dashesUsed,
    buildingsDestroyed: ctx.buildingsDestroyed - base.buildingsDestroyed,
    soulsCollected: ctx.soulsCollected - base.soulsCollected,
    relicsTaken: ctx.relicsTaken - base.relicsTaken,
  };
}

/**
 * The lesson to start now, or null.
 *
 * Steps come first and strictly in order — the next unfinished step is the only
 * one eligible, so "dash" can never jump ahead of "move". A tip may interrupt
 * between steps only once every step is done or the next step is waiting on
 * something that isn't there (no buildings left to teach walls with), so the core
 * sequence isn't buried under advice.
 */
export function nextLesson(ctx: TutorialContext, finished: ReadonlySet<string>): Lesson | null {
  const step = STEPS.find((s) => !finished.has(s.id));
  if (step && step.when(ctx)) return step;

  for (const lesson of LESSONS) {
    if (lesson.kind !== 'tip' || finished.has(lesson.id)) continue;
    if (lesson.when(ctx)) return lesson;
  }
  return null;
}

/**
 * Whether the lesson on screen is finished: either the player did it, or — for a
 * tip — it has simply been up long enough. Never before the minimum read time.
 */
export function lessonComplete(lesson: Lesson, relative: TutorialContext): boolean {
  if (relative.shownFor < LESSON_MIN_SECONDS) return false;
  if (lesson.done(relative)) return true;
  return lesson.kind === 'tip' && relative.shownFor >= TIP_MAX_SECONDS;
}
