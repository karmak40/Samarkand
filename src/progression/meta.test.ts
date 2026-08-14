import { beforeEach, describe, expect, it } from 'vitest';
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
