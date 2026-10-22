import { beforeEach, describe, expect, it } from 'vitest';
import { HORDE_LEVELS } from '../balance';
import { RunStats } from '../stats/tracker';
import { MetaProgress } from './meta';
import { DEFAULT_SPECIES_ID, SPECIES } from './species';
import { UNLOCKS, unlockKey } from './unlocks';

const SAVE_KEY = 'samarkand.save.v1';

/** Whatever storage the environment ended up with — see `src/test-setup.ts`. */
const storage = globalThis.localStorage;

/** A save file written by hand, to stand in for one left by an older build. */
function writeSave(data: Record<string, unknown>): void {
  storage.setItem(SAVE_KEY, JSON.stringify(data));
}

beforeEach(() => {
  storage.clear();
});

describe('a fresh profile', () => {
  it('starts empty and says so', () => {
    const meta = new MetaProgress();

    expect(meta.souls).toBe(0);
    expect(meta.unlockedCount).toBe(0);
    expect(meta.isNewProfile).toBe(true);
    expect(meta.speciesId).toBe(DEFAULT_SPECIES_ID);
  });

  it('can already play the free bodies and nothing else', () => {
    const meta = new MetaProgress();

    for (const species of SPECIES) {
      expect(meta.canUseSpecies(species.id)).toBe(species.price === 0);
    }
  });

  it('gates locked content and permits everything without an unlock entry', () => {
    const meta = new MetaProgress();
    const locked = UNLOCKS[0]!;

    expect(meta.has(locked.category, locked.refId)).toBe(false);
    expect(meta.has('card', 'piercing')).toBe(true);
  });
});

describe('buying', () => {
  it('refuses what it cannot afford and takes the price when it can', () => {
    const meta = new MetaProgress();
    const unlock = UNLOCKS.find((u) => u.category === 'card')!;

    expect(meta.buy(unlock.id)).toBe(false);

    meta.souls = unlock.price;
    expect(meta.buy(unlock.id)).toBe(true);
    expect(meta.souls).toBe(0);
    expect(meta.isUnlocked(unlock.id)).toBe(true);
  });

  it('will not sell the same thing twice', () => {
    const meta = new MetaProgress();
    const unlock = UNLOCKS[0]!;
    meta.souls = unlock.price * 3;

    expect(meta.buy(unlock.id)).toBe(true);
    const left = meta.souls;
    expect(meta.buy(unlock.id)).toBe(false);
    expect(meta.souls).toBe(left);
  });

  it('ignores an unlock id it does not know', () => {
    const meta = new MetaProgress();
    meta.souls = 1000;

    expect(meta.buy('card:no-such-card')).toBe(false);
    expect(meta.souls).toBe(1000);
  });
});

describe('choosing a body', () => {
  it('refuses one that has not been bought', () => {
    const meta = new MetaProgress();
    const paid = SPECIES.find((s) => s.price > 0)!;

    expect(meta.chooseSpecies(paid.id)).toBe(false);
    expect(meta.speciesId).toBe(DEFAULT_SPECIES_ID);
  });

  it('accepts one that has', () => {
    const meta = new MetaProgress();
    const paid = SPECIES.find((s) => s.price > 0)!;
    meta.souls = paid.price;
    meta.buy(unlockKey('species', paid.id));

    expect(meta.chooseSpecies(paid.id)).toBe(true);
    expect(meta.species.id).toBe(paid.id);
  });

  it('falls back to the starter if the chosen body is somehow not owned', () => {
    const meta = new MetaProgress();
    meta.speciesId = 'behemoth';

    expect(meta.species.id).toBe(DEFAULT_SPECIES_ID);
  });
});

const SAMPLE_BUILD = {
  level: 12,
  xpIntoLevel: 40,
  souls: 210,
  skills: [{ id: 'bloodthirst', stacks: 2 }],
  mutationIds: ['abyssal-maw'],
  curseIds: [],
};

describe('checkpoint', () => {
  it('starts unset', () => {
    const meta = new MetaProgress();
    expect(meta.hasCheckpoint).toBe(false);
    expect(meta.checkpointBiome).toBe(1);
    expect(meta.checkpointDepth).toBe(0);
    expect(meta.checkpointBuild).toBeNull();
  });

  it('records a deeper room and ignores a shallower one', () => {
    const meta = new MetaProgress();
    meta.recordCheckpoint(1, 6, SAMPLE_BUILD);
    expect(meta.checkpointDepth).toBe(6);

    meta.recordCheckpoint(1, 3, SAMPLE_BUILD);
    expect(meta.checkpointDepth).toBe(6);

    meta.recordCheckpoint(1, 9, SAMPLE_BUILD);
    expect(meta.checkpointDepth).toBe(9);
  });

  it('a later biome always beats an earlier one, regardless of depth', () => {
    const meta = new MetaProgress();
    meta.recordCheckpoint(2, 3, SAMPLE_BUILD);
    expect(meta.checkpointBiome).toBe(2);
    expect(meta.checkpointDepth).toBe(3);

    meta.recordCheckpoint(1, 9, SAMPLE_BUILD);
    expect(meta.checkpointBiome).toBe(2);
    expect(meta.checkpointDepth).toBe(3);
  });

  it('clears back to the top', () => {
    const meta = new MetaProgress();
    meta.recordCheckpoint(2, 6, SAMPLE_BUILD);
    meta.clearCheckpoint();

    expect(meta.hasCheckpoint).toBe(false);
    expect(meta.checkpointBiome).toBe(1);
    expect(meta.checkpointDepth).toBe(0);
    expect(meta.checkpointBuild).toBeNull();
  });

  it('round-trips through localStorage, build included', () => {
    const first = new MetaProgress();
    first.recordCheckpoint(2, 6, SAMPLE_BUILD);

    const second = new MetaProgress();
    expect(second.checkpointBiome).toBe(2);
    expect(second.checkpointDepth).toBe(6);
    expect(second.checkpointBuild).toEqual(SAMPLE_BUILD);
  });

  it('defaults to unset on a save from before this feature existed', () => {
    writeSave({ version: 4, souls: 0, unlocked: [], lifetime: {} });
    const meta = new MetaProgress();
    expect(meta.hasCheckpoint).toBe(false);
    expect(meta.checkpointBuild).toBeNull();
  });

  it('drops a malformed build rather than trusting it', () => {
    writeSave({
      version: 5, souls: 0, unlocked: [], lifetime: {},
      checkpointBiome: 2, checkpointDepth: 6, checkpointBuild: { level: 'twelve' },
    });
    const meta = new MetaProgress();
    expect(meta.checkpointBuild).toBeNull();
  });
});

/** A full-length stand on an arena, and an early death on one. */
const survived = { survived: true, seconds: 720, wave: 65, kills: 600 };
const fell = { survived: false, seconds: 200, wave: 18, kills: 140 };

/** A finished run with just the fields the lifetime record and trials read. */
function finishedRun(outcome: 'victory' | 'death', fields: Partial<RunStats> = {}): RunStats {
  const run = new RunStats(1);
  run.outcome = outcome;
  return Object.assign(run, fields);
}

describe('horde progress', () => {
  it('starts with only level 1 unlocked', () => {
    const meta = new MetaProgress();
    expect(meta.hordeLevelUnlocked).toBe(1);
  });

  it('ratchets forward on survival', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    expect(meta.hordeLevelUnlocked).toBe(2);

    meta.recordHordeResult(2, survived);
    expect(meta.hordeLevelUnlocked).toBe(3);
  });

  it('does not move on death', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, fell);
    expect(meta.hordeLevelUnlocked).toBe(1);
  });

  it('ignores a replay of an already-beaten level', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    meta.recordHordeResult(1, survived);
    expect(meta.hordeLevelUnlocked).toBe(2);
  });

  it('round-trips through localStorage', () => {
    const first = new MetaProgress();
    first.recordHordeResult(1, survived);

    const second = new MetaProgress();
    expect(second.hordeLevelUnlocked).toBe(2);
  });

  it('defaults to level 1 on a save from before this feature existed', () => {
    writeSave({ version: 5, souls: 0, unlocked: [], lifetime: {} });
    const meta = new MetaProgress();
    expect(meta.hordeLevelUnlocked).toBe(1);
  });
});

describe('horde records', () => {
  it('keeps the best of every attempt on an arena, each figure on its own', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, { survived: false, seconds: 300, wave: 20, kills: 90 });
    meta.recordHordeResult(1, { survived: false, seconds: 250, wave: 17, kills: 160 });

    expect(meta.hordeRecords[1]).toEqual({ attempts: 2, bestSeconds: 300, bestWave: 20, bestKills: 160 });
    expect(meta.hordeRecords[2]).toBeUndefined();
  });

  it('calls a beaten attempt a record, but never the first one', () => {
    const meta = new MetaProgress();
    expect(meta.recordHordeResult(1, fell)).toBe(false);
    expect(meta.recordHordeResult(1, { ...fell, seconds: 100, kills: 10 })).toBe(false);
    expect(meta.recordHordeResult(1, survived)).toBe(true);
    // Another full stand only counts if it out-kills the last one.
    expect(meta.recordHordeResult(1, survived)).toBe(false);
    expect(meta.recordHordeResult(1, { ...survived, kills: 700 })).toBe(true);
  });

  it('reports the best across arenas for the chronicle', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    meta.recordHordeResult(2, { survived: false, seconds: 400, wave: 70, kills: 300 });

    expect(meta.hordeBest()).toEqual({ seconds: 720, wave: 70, kills: 600 });
    expect(meta.hordeLevelsBeaten).toBe(1);
  });

  it('round-trips through localStorage and drops records for arenas that do not exist', () => {
    const first = new MetaProgress();
    first.recordHordeResult(2, fell);
    const raw = JSON.parse(storage.getItem(SAVE_KEY)!) as Record<string, unknown>;
    raw.hordeRecords = { ...(raw.hordeRecords as object), 99: { attempts: 3 }, 1: 'nonsense' };
    writeSave(raw);

    const second = new MetaProgress();
    expect(second.hordeRecords[2]).toEqual({ attempts: 1, bestSeconds: 200, bestWave: 18, bestKills: 140 });
    expect(Object.keys(second.hordeRecords)).toEqual(['2']);
  });

  it('is wiped along with the rest of the profile', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    meta.reset();

    expect(meta.hordeLevelUnlocked).toBe(1);
    expect(meta.hordeRecords).toEqual({});
  });
});

describe('a horde run in the lifetime record', () => {
  const horde = { level: 1, wave: 65 };

  it('counts as a run and a horde survival, not a campaign victory', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    meta.recordRun(finishedRun('victory', { totalKills: 600 }), 50, { horde });

    expect(meta.lifetime.runs).toBe(1);
    expect(meta.lifetime.hordeRuns).toBe(1);
    expect(meta.lifetime.hordeVictories).toBe(1);
    expect(meta.lifetime.victories).toBe(0);
    expect(meta.lifetime.totalKills).toBe(600);
  });

  it('leaves the campaign run-length records alone', () => {
    const meta = new MetaProgress();
    meta.recordRun(finishedRun('death', { totalKills: 900, roomsCleared: 0 }), 300, { horde });

    expect(meta.lifetime.deaths).toBe(1);
    expect(meta.lifetime.bestKills).toBe(0);
    expect(meta.lifetime.bestSoulsInRun).toBe(0);
  });

  it('never earns the campaign trials a horde "victory" used to hand out', () => {
    const meta = new MetaProgress();
    meta.recordHordeResult(1, survived);
    const earned = meta
      .recordRun(finishedRun('victory', { elapsed: 720, totalKills: 600 }), 50, { horde })
      .map((a) => a.id);

    for (const campaignOnly of ['first-victory', 'swift-end', 'ascetic', 'unscathed', 'butcher']) {
      expect(earned).not.toContain(campaignOnly);
    }
    expect(earned).toEqual(expect.arrayContaining(['first-hunt', 'horde-survivor', 'horde-massacre']));
  });

  it('earns the steadfast trial only on a survival that stayed above half health', () => {
    const shaky = new MetaProgress();
    const earnedShaky = shaky.recordRun(finishedRun('victory', { lowestHealthFraction: 0.3 }), 0, { horde });
    expect(earnedShaky.map((a) => a.id)).not.toContain('horde-steadfast');

    const steady = new MetaProgress();
    const earnedSteady = steady.recordRun(finishedRun('victory', { lowestHealthFraction: 0.6 }), 0, { horde });
    expect(earnedSteady.map((a) => a.id)).toContain('horde-steadfast');
  });

  it('pays the ladder trials on the survival that climbs the rung', () => {
    const meta = new MetaProgress();
    const halfway = Math.ceil(HORDE_LEVELS.length / 2);
    for (let level = 1; level <= HORDE_LEVELS.length; level++) {
      meta.recordHordeResult(level, survived);
      const earned = meta.recordRun(finishedRun('victory'), 0, { horde: { level, wave: 65 } }).map((a) => a.id);
      expect(earned.includes('horde-halfway')).toBe(level === halfway);
      expect(earned.includes('horde-ladder')).toBe(level === HORDE_LEVELS.length);
    }
  });

  it('grants ladder trials to a pre-v6 save already up the ladder', () => {
    writeSave({ version: 5, souls: 0, unlocked: [], lifetime: {}, hordeLevelUnlocked: 4 });
    const meta = new MetaProgress();

    expect(meta.hasAchievement('horde-halfway')).toBe(true);
    expect(meta.hasAchievement('horde-ladder')).toBe(false);
  });
});

describe('persistence', () => {
  it('round-trips through localStorage', () => {
    const first = new MetaProgress();
    const unlock = UNLOCKS[0]!;
    first.souls = unlock.price + 40;
    first.buy(unlock.id);
    first.volume = 0.25;
    first.muted = true;
    first.save();

    const second = new MetaProgress();
    expect(second.souls).toBe(40);
    expect(second.isUnlocked(unlock.id)).toBe(true);
    expect(second.volume).toBe(0.25);
    expect(second.muted).toBe(true);
    expect(second.isNewProfile).toBe(false);
  });

  it('survives a corrupt save rather than refusing to start', () => {
    storage.setItem(SAVE_KEY, '{not json at all');
    expect(() => new MetaProgress()).not.toThrow();
    expect(new MetaProgress().souls).toBe(0);
  });

  it('leaves a save from a newer build alone instead of downgrading it', () => {
    writeSave({ version: 999, souls: 5000, unlocked: [] });
    const meta = new MetaProgress();

    expect(meta.souls).toBe(0);
    expect(meta.isNewProfile).toBe(true);
  });

  it('drops unlock ids this build no longer has', () => {
    writeSave({ version: 4, souls: 0, unlocked: ['card:removed-long-ago'], lifetime: {} });
    expect(new MetaProgress().unlockedCount).toBe(0);
  });

  it('replaces an unknown saved body with the starter', () => {
    writeSave({ version: 4, souls: 0, unlocked: [], speciesId: 'chimera', lifetime: {} });
    expect(new MetaProgress().speciesId).toBe(DEFAULT_SPECIES_ID);
  });
});

describe('migration', () => {
  it('refunds souls a v1 profile spent on stat upgrades that no longer exist', () => {
    // vitality cost 25 at level 1 and 25*1.35 at level 2.
    writeSave({ version: 1, souls: 10, unlocked: [], upgrades: { vitality: 2 } });
    const meta = new MetaProgress();

    expect(meta.souls).toBe(10 + 25 + Math.round(25 * 1.35));
  });

  it('gives an older profile the body field it never had', () => {
    writeSave({ version: 2, souls: 0, unlocked: [], lifetime: { runs: 3 } });
    const meta = new MetaProgress();

    expect(meta.speciesId).toBe(DEFAULT_SPECIES_ID);
    expect(meta.lifetime.runs).toBe(3);
  });

  it('writes the migrated profile back at the current version', () => {
    writeSave({ version: 1, souls: 0, unlocked: [], upgrades: {} });
    new MetaProgress();

    const stored = JSON.parse(storage.getItem(SAVE_KEY)!) as { version: number };
    expect(stored.version).toBeGreaterThan(1);
  });
});

describe('the unlock catalogue', () => {
  it('has no duplicate ids', () => {
    const ids = UNLOCKS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prices everything above zero — a free entry would never leave the shop', () => {
    for (const unlock of UNLOCKS) expect(unlock.price).toBeGreaterThan(0);
  });
});
