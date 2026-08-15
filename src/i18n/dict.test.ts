import { describe, expect, it } from 'vitest';
import { BOONS } from '../progression/boons';
import { CURSES } from '../progression/curses';
import { ABILITIES } from '../progression/abilities';
import { ACHIEVEMENTS } from '../progression/achievements';
import { MUTATIONS } from '../progression/evolution';
import { SKILL_CARDS } from '../progression/skills';
import { SPECIES } from '../progression/species';
import { BASE_STATS } from '../progression/stats';
import { HUMAN_ARCHETYPES } from '../entities/human';
import { DE } from './dict.de';
import { EN } from './dict.en';
import { RU } from './dict.ru';
import { UK } from './dict.uk';
import { FR } from './dict.fr';
import { setLocale, t } from './index';

const dicts = { ru: RU, en: EN, de: DE, uk: UK, fr: FR } as const;

/**
 * Key parity across locales.
 *
 * This used to be a manual check after every feature, which is exactly the kind of
 * chore that gets skipped on the day it would have caught something. A missing key
 * does not crash — it falls back to English, or worse renders the raw key — so
 * nothing but a test notices.
 */
describe('dictionaries', () => {
  const reference = Object.keys(RU).sort();

  for (const [locale, dict] of Object.entries(dicts)) {
    it(`${locale} has exactly the same keys as ru`, () => {
      expect(Object.keys(dict).sort()).toEqual(reference);
    });

    it(`${locale} has no empty strings`, () => {
      const blank = Object.entries(dict)
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key);
      expect(blank).toEqual([]);
    });

    it(`${locale} uses the same interpolation slots as ru`, () => {
      const slots = (value: string): string[] => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      const mismatched = Object.keys(dict).filter(
        (key) => slots(dict[key]!).join() !== slots(RU[key] ?? '').join(),
      );
      expect(mismatched).toEqual([]);
    });
  }
});

/**
 * Content tables ask for their names through `t()` at read time, so a table entry
 * without a dictionary key renders as the raw key in the middle of the UI. These
 * walk the tables and demand the keys exist.
 */
describe('every content table is fully translated', () => {
  const cases: Array<[string, string[]]> = [
    ['cards', SKILL_CARDS.flatMap((c) => [`skill.${c.id}.name`, `skill.${c.id}.description`])],
    ['mutations', MUTATIONS.flatMap((m) => [`mutation.${m.id}.name`, `mutation.${m.id}.description`])],
    ['boons', BOONS.flatMap((b) => [`boon.${b.id}.name`, `boon.${b.id}.description`])],
    ['curses', CURSES.flatMap((c) => [`curse.${c.id}.name`, `curse.${c.id}.desc`])],
    ['trials', ACHIEVEMENTS.flatMap((a) => [`achv.${a.id}.name`, `achv.${a.id}.desc`])],
    ['gifts', ABILITIES.map((a) => a.id).flatMap((id) => [`ability.${id}.name`, `ability.${id}.desc`])],
    ['enemies', Object.keys(HUMAN_ARCHETYPES).map((id) => `enemy.${id}.name`)],
    [
      'species',
      SPECIES.flatMap((s) => [`species.${s.id}.name`, `species.${s.id}.tag`, `species.${s.id}.desc`]),
    ],
    ['stats', Object.keys(BASE_STATS).map((key) => `stat.${key}`)],
  ];

  for (const [label, keys] of cases) {
    it(`${label}`, () => {
      expect(keys.filter((key) => !(key in RU))).toEqual([]);
    });
  }
});

describe('t()', () => {
  it('interpolates variables', () => {
    setLocale('en');
    expect(t('unit.souls', { n: 7 })).toContain('7');
  });

  it('returns the key itself for something unknown, rather than throwing mid-frame', () => {
    expect(t('no.such.key.exists')).toBe('no.such.key.exists');
  });
});
