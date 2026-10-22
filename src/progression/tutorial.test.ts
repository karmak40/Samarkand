import { beforeEach, describe, expect, it } from 'vitest';
import { MetaProgress } from './meta';
import {
  baselineOf,
  getLesson,
  LESSON_MIN_SECONDS,
  lessonComplete,
  LESSONS,
  nextLesson,
  relativeTo,
  STEPS,
  TIP_MAX_SECONDS,
  type TutorialContext,
} from './tutorial';

function ctx(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return {
    shownFor: 0,
    distanceTravelled: 0,
    totalKills: 0,
    dashesUsed: 0,
    buildingsDestroyed: 0,
    buildingsStanding: 3,
    soulsCollected: 0,
    healthFraction: 1,
    relicInSight: false,
    relicsTaken: 0,
    bossAlive: false,
    humansAlive: 5,
    ...overrides,
  };
}

describe('lesson order', () => {
  it('opens on movement for a fresh profile', () => {
    expect(nextLesson(ctx(), new Set())?.id).toBe('move');
  });

  it('teaches steps strictly in order', () => {
    const finished = new Set<string>();
    const seen: string[] = [];
    for (let i = 0; i < STEPS.length; i++) {
      const lesson = nextLesson(ctx(), finished)!;
      seen.push(lesson.id);
      finished.add(lesson.id);
    }
    expect(seen).toEqual(STEPS.map((s) => s.id));
  });

  it('never buries a pending step under a tip', () => {
    const lesson = nextLesson(ctx({ healthFraction: 0.2, bossAlive: true }), new Set());
    expect(lesson?.id).toBe('move');
  });

  it('lets a tip through when the next step has nothing to work with', () => {
    // "Break a wall" with no walls left — the step waits, the tip doesn't have to.
    const finished = new Set(['move', 'attack', 'dash']);
    const lesson = nextLesson(ctx({ buildingsStanding: 0, healthFraction: 0.3 }), finished);
    expect(lesson?.id).toBe('blood');
  });

  it('has nothing left to say once every lesson is finished', () => {
    const everything = new Set(LESSONS.map((l) => l.id));
    expect(nextLesson(ctx({ healthFraction: 0.1, bossAlive: true, relicInSight: true }), everything)).toBeNull();
  });
});

describe('finishing a lesson', () => {
  it('counts only what happened after the lesson appeared', () => {
    const move = getLesson('move')!;
    const base = baselineOf(ctx({ distanceTravelled: 5000 }));
    const now = ctx({ distanceTravelled: 5050, shownFor: 5 });
    expect(lessonComplete(move, relativeTo(now, base))).toBe(false);
  });

  it('is done once the player has done it', () => {
    const dash = getLesson('dash')!;
    const base = baselineOf(ctx());
    expect(lessonComplete(dash, relativeTo(ctx({ dashesUsed: 1, shownFor: 3 }), base))).toBe(true);
  });

  it('stays readable for a moment even when done instantly', () => {
    const dash = getLesson('dash')!;
    const base = baselineOf(ctx());
    const early = ctx({ dashesUsed: 1, shownFor: LESSON_MIN_SECONDS / 2 });
    expect(lessonComplete(dash, relativeTo(early, base))).toBe(false);
  });

  it('a step waits for the player however long it takes', () => {
    const raze = getLesson('raze')!;
    expect(lessonComplete(raze, relativeTo(ctx({ shownFor: 120 }), baselineOf(ctx())))).toBe(false);
  });

  it('a tip gives up on its own — it is advice, not a gate', () => {
    const boss = getLesson('boss')!;
    const base = baselineOf(ctx());
    expect(lessonComplete(boss, relativeTo(ctx({ shownFor: TIP_MAX_SECONDS - 1 }), base))).toBe(false);
    expect(lessonComplete(boss, relativeTo(ctx({ shownFor: TIP_MAX_SECONDS }), base))).toBe(true);
  });
});

describe('tutorial progress in the profile', () => {
  const SAVE_KEY = 'samarkand.save.v1';
  beforeEach(() => globalThis.localStorage.clear());

  it('survives a save and a reload', () => {
    const meta = new MetaProgress();
    meta.tutorial.add('move');
    meta.tutorial.add('dash');
    meta.save();

    const reloaded = new MetaProgress();
    expect([...reloaded.tutorial].sort()).toEqual(['dash', 'move']);
  });

  it('spares a veteran from before the tutorial existed', () => {
    const meta = new MetaProgress();
    meta.lifetime.runs = 4;
    meta.save();
    // Strip the field, as a save written by an older build would lack it.
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.tutorial;
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));

    const reloaded = new MetaProgress();
    expect(reloaded.tutorial.size).toBe(LESSONS.length);
  });

  it('still teaches an old profile that never actually played', () => {
    const meta = new MetaProgress();
    meta.save();
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY)!) as Record<string, unknown>;
    delete raw.tutorial;
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));

    expect(new MetaProgress().tutorial.size).toBe(0);
  });

  it('drops lesson ids this build no longer has', () => {
    const meta = new MetaProgress();
    meta.save();
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY)!) as Record<string, unknown>;
    raw.tutorial = ['move', 'no-such-lesson'];
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));

    expect([...new MetaProgress().tutorial]).toEqual(['move']);
  });
});
