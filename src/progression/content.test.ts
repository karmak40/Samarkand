import { describe, expect, it } from 'vitest';
import { HUMAN_ARCHETYPES, BOSS_IDS, type HumanId } from '../entities/human';
import { ABILITIES } from './abilities';
import { ACHIEVEMENTS, type LifetimeSnapshot } from './achievements';
import { BOONS } from './boons';
import { CURSES } from './curses';
import { createBaseBody, MUTATIONS } from './evolution';
import { SKILL_CARDS } from './skills';
import { DEFAULT_SPECIES_ID, getSpecies, resolveSpecies, SPECIES, speciesBody } from './species';
import { BASE_STATS } from './stats';

/**
 * Table integrity.
 *
 * The whole design leans on "adding content is a row in a table". That only holds if
 * nothing in the table can be quietly malformed — a duplicate id silently shadows an
 * entry, and a body referencing a stat key that no longer exists fails at no point
 * anyone would notice.
 */
function expectUniqueIds(items: readonly { id: string }[]): void {
  const ids = items.map((i) => i.id);
  expect(new Set(ids).size).toBe(ids.length);
}

describe('ids are unique', () => {
  it('cards', () => expectUniqueIds(SKILL_CARDS));
  it('gifts', () => expectUniqueIds(ABILITIES));
  it('mutations', () => expectUniqueIds(MUTATIONS));
  it('boons', () => expectUniqueIds(BOONS));
  it('curses', () => expectUniqueIds(CURSES));
  it('trials', () => expectUniqueIds(ACHIEVEMENTS));
  it('species', () => expectUniqueIds(SPECIES));
});

describe('enemy archetypes', () => {
  it('are keyed by their own id', () => {
    for (const [key, archetype] of Object.entries(HUMAN_ARCHETYPES)) {
      expect(archetype.id).toBe(key);
    }
  });

  it('every boss id names a real archetype with the boss role', () => {
    for (const id of BOSS_IDS) {
      const archetype = HUMAN_ARCHETYPES[id as HumanId];
      expect(archetype).toBeDefined();
      expect(archetype.role).toBe('boss');
    }
  });

  it('bosses are never rolled into an ordinary settlement', () => {
    for (const archetype of Object.values(HUMAN_ARCHETYPES)) {
      if (archetype.role === 'boss') expect(archetype.spawnWeight).toBe(0);
    }
  });

  it('every archetype can actually act — damage, and reach to deliver it', () => {
    for (const archetype of Object.values(HUMAN_ARCHETYPES)) {
      expect(archetype.hp).toBeGreaterThan(0);
      expect(archetype.attackRange).toBeGreaterThan(0);
      expect(archetype.damage.length).toBeGreaterThan(0);
      for (const packet of archetype.damage) expect(packet.amount).toBeGreaterThan(0);
    }
  });

  it('only the turret is immobile', () => {
    for (const archetype of Object.values(HUMAN_ARCHETYPES)) {
      if (archetype.role !== 'turret') expect(archetype.speed).toBeGreaterThan(0);
    }
  });
});

describe('species', () => {
  it('has a starter, and it is free', () => {
    const starter = getSpecies(DEFAULT_SPECIES_ID);
    expect(starter).toBeDefined();
    expect(starter!.price).toBe(0);
  });

  it('offers a real choice on a fresh profile', () => {
    expect(SPECIES.filter((s) => s.price === 0).length).toBeGreaterThanOrEqual(2);
  });

  it('only overrides stat keys that exist', () => {
    for (const species of SPECIES) {
      for (const key of Object.keys(species.stats)) {
        expect(BASE_STATS).toHaveProperty(key);
      }
    }
  });

  it('only overrides body fields that exist', () => {
    const fields = Object.keys(createBaseBody());
    for (const species of SPECIES) {
      for (const key of Object.keys(species.body)) expect(fields).toContain(key);
    }
  });

  it('builds a complete body from a partial override', () => {
    for (const species of SPECIES) {
      const body = speciesBody(species);
      expect(Object.keys(body).sort()).toEqual(Object.keys(createBaseBody()).sort());
      expect(body.coreRadius).toBeGreaterThan(0);
      expect(body.bulk).toBeGreaterThan(0);
    }
  });

  it('falls back to the starter for an unknown id', () => {
    expect(resolveSpecies('not-a-species').id).toBe(DEFAULT_SPECIES_ID);
  });

  it('keeps every body within shouting distance of the others', () => {
    // Not balance, just a sanity rail: a body twice as durable *and* twice as strong
    // as the starter is not a choice, it is the answer.
    for (const species of SPECIES) {
      const hp = species.stats.maxHp ?? BASE_STATS.maxHp;
      const damage = species.stats.damage ?? BASE_STATS.damage;

      expect(hp / BASE_STATS.maxHp).toBeLessThan(2);
      expect(damage / BASE_STATS.damage).toBeLessThan(2);
      expect(hp / BASE_STATS.maxHp).toBeGreaterThan(0.5);
      expect(damage / BASE_STATS.damage).toBeGreaterThan(0.5);
    }
  });
});

describe('mutations', () => {
  it('change the body they are given, and only that copy', () => {
    for (const mutation of MUTATIONS) {
      const body = createBaseBody();
      const untouched = createBaseBody();
      mutation.mutate(body);

      expect(body).not.toEqual(untouched);
    }
  });

  it('never produce a body that cannot be drawn', () => {
    for (const mutation of MUTATIONS) {
      const body = createBaseBody();
      mutation.mutate(body);

      expect(body.coreRadius).toBeGreaterThan(0);
      expect(body.bulk).toBeGreaterThan(0);
      expect(body.alpha).toBeGreaterThan(0);
      expect(body.lobes).toBeGreaterThanOrEqual(3);
      for (const count of [body.eyes, body.horns, body.spikes, body.tails, body.wings, body.limbs]) {
        expect(count).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/**
 * Gifts are the one thing the player aims by hand, and every number on them is
 * promised on the choice screen before it is picked. A gift whose windup outlasts its
 * cooldown, or whose reach is shorter than its own blast, would read as broken rather
 * than as a trade-off.
 */
describe('gifts of the abyss', () => {
  it('all last long enough to be cast at least twice', () => {
    for (const gift of ABILITIES) {
      expect(gift.cooldown).toBeGreaterThan(0);
      expect(gift.duration).toBeGreaterThanOrEqual(gift.cooldown * 2);
    }
  });

  it('never take longer to land than to recharge', () => {
    for (const gift of ABILITIES) expect(gift.windup).toBeLessThan(gift.cooldown);
  });

  it('reach further than they splash', () => {
    for (const gift of ABILITIES) expect(gift.range).toBeGreaterThan(gift.radius);
  });
});

describe('trials', () => {
  it('all pay something', () => {
    for (const trial of ACHIEVEMENTS) expect(trial.reward).toBeGreaterThan(0);
  });

  it('all have a reachable target', () => {
    for (const trial of ACHIEVEMENTS) expect(trial.target).toBeGreaterThan(0);
  });

  /**
   * The boss trial has to track the roster.
   *
   * It used to ask for ten kills of one named boss. Once a run started drawing its
   * finale from three, that quietly became three times the work it advertised, and
   * nothing failed — the trial simply took forever. A fourth boss would do the same
   * again, so the target is pinned to the roster rather than to a number.
   */
  describe('bringing down every boss', () => {
    const trial = ACHIEVEMENTS.find((a) => a.id === 'three-crowns')!;

    const lifetimeWith = (kills: Record<string, number>): LifetimeSnapshot => ({
      runs: 0,
      victories: 0,
      totalKills: 0,
      totalBuildings: 0,
      dailyRuns: 0,
      killsByEnemy: kills,
    });

    const measure = (kills: Record<string, number>): number =>
      trial.measure({
        run: null,
        lifetime: lifetimeWith(kills),
        unlockedContent: 0,
        unlockableContent: 0,
      });

    it('exists and asks for the whole roster', () => {
      expect(trial).toBeDefined();
      expect(trial.target).toBe(BOSS_IDS.length);
    });

    it('counts each boss once, however many times it died', () => {
      expect(measure({})).toBe(0);
      expect(measure({ [BOSS_IDS[0]]: 40 })).toBe(1);
      expect(measure(Object.fromEntries(BOSS_IDS.map((id) => [id, 1])))).toBe(BOSS_IDS.length);
    });

    it('is not moved by killing anything else', () => {
      expect(measure({ knight: 900, peasant: 4000 })).toBe(0);
    });
  });
});
