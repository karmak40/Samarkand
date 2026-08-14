import { describe, expect, it } from 'vitest';
import { BASE_STATS, StatSheet } from './stats';

describe('StatSheet stacking', () => {
  it('adds flats before applying multipliers', () => {
    const stats = new StatSheet();
    stats.addModifier({ key: 'damage', flat: 10, source: 'a' });
    stats.addModifier({ key: 'damage', mult: 1, source: 'b' });

    expect(stats.get('damage')).toBeCloseTo((BASE_STATS.damage + 10) * 2);
  });

  it('adds multipliers together rather than compounding them', () => {
    // Two +20% give x1.4, not x1.44. Compounding makes late stacking explode and
    // the numbers stop being readable on the build sheet.
    const stats = new StatSheet();
    stats.addModifier({ key: 'damage', mult: 0.2, source: 'a' });
    stats.addModifier({ key: 'damage', mult: 0.2, source: 'b' });

    expect(stats.get('damage')).toBeCloseTo(BASE_STATS.damage * 1.4);
  });

  it('removes every modifier from one source and nothing else', () => {
    const stats = new StatSheet();
    stats.addModifier({ key: 'damage', flat: 100, source: 'boon' });
    stats.addModifier({ key: 'damage', flat: 5, source: 'card' });
    stats.removeBySource('boon');

    expect(stats.get('damage')).toBeCloseTo(BASE_STATS.damage + 5);
  });

  it('takes base overrides at construction, which is how species work', () => {
    const stats = new StatSheet({ maxHp: 180 });
    expect(stats.get('maxHp')).toBe(180);
    expect(stats.get('damage')).toBe(BASE_STATS.damage);
  });
});

describe('StatSheet guard rails', () => {
  it('floors stats that would break the game at zero', () => {
    const stats = new StatSheet();
    stats.addModifier({ key: 'maxHp', flat: -100000, source: 'curse' });
    stats.addModifier({ key: 'moveSpeed', flat: -100000, source: 'curse' });

    expect(stats.get('maxHp')).toBeGreaterThan(0);
    expect(stats.get('moveSpeed')).toBeGreaterThan(0);
  });

  it('caps stats that would break the game when stacked', () => {
    const stats = new StatSheet();
    stats.addModifier({ key: 'dodge', flat: 5, source: 'stack' });
    stats.addModifier({ key: 'lifesteal', flat: 5, source: 'stack' });

    expect(stats.get('dodge')).toBeLessThanOrEqual(0.6);
    expect(stats.get('lifesteal')).toBeLessThanOrEqual(0.6);
  });

  it('never lets spread go negative', () => {
    const stats = new StatSheet();
    stats.addModifier({ key: 'spread', flat: -10, source: 'focus' });

    expect(stats.get('spread')).toBeGreaterThanOrEqual(0);
  });
});

describe('StatSheet behaviours', () => {
  it('counts stacks and switches off at zero', () => {
    const stats = new StatSheet();
    stats.addBehavior('ricochet', 2);
    expect(stats.has('ricochet')).toBe(true);
    expect(stats.count('ricochet')).toBe(2);

    stats.removeBehavior('ricochet', 2);
    expect(stats.has('ricochet')).toBe(false);
  });

  it('does not report a behaviour that was never added', () => {
    expect(new StatSheet().has('homing')).toBe(false);
  });
});

describe('derived values', () => {
  it('turns attack speed into an interval', () => {
    const stats = new StatSheet({ attackSpeed: 2 });
    expect(stats.attackInterval()).toBeCloseTo(0.5);
  });

  it('reports conversions as fractions of the whole hit', () => {
    const stats = new StatSheet({ convFire: 0.5 });
    const fire = stats.conversions().find((c) => c.type === 'fire');

    expect(fire?.fraction).toBeCloseTo(0.5);
  });

  it('recomputes after a modifier changes, rather than serving a stale cache', () => {
    const stats = new StatSheet();
    const before = stats.get('damage');
    stats.addModifier({ key: 'damage', flat: 7, source: 'x' });

    expect(stats.get('damage')).toBeCloseTo(before + 7);
  });
});
