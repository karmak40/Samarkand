import { describe, expect, it } from 'vitest';
import { dailyKey, dailySeed, formatCountdown, secondsUntilNextDaily, seedLabel } from './daily';

const NOON_UTC = Date.UTC(2026, 7, 13, 12, 0, 0);

describe('dailyKey', () => {
  it('is the UTC date, zero-padded', () => {
    expect(dailyKey(NOON_UTC)).toBe('2026-08-13');
    expect(dailyKey(Date.UTC(2026, 0, 5))).toBe('2026-01-05');
  });

  it('rolls over at UTC midnight, not local midnight', () => {
    // Two instants either side of UTC midnight must land on different days no matter
    // what timezone the machine running this is in — otherwise "today's seed" means
    // something different in Sydney and the daily stops being shared.
    const before = Date.UTC(2026, 7, 13, 23, 59, 59);
    const after = Date.UTC(2026, 7, 14, 0, 0, 1);

    expect(dailyKey(before)).toBe('2026-08-13');
    expect(dailyKey(after)).toBe('2026-08-14');
  });
});

describe('dailySeed', () => {
  it('is stable for a given day', () => {
    expect(dailySeed('2026-08-13')).toBe(dailySeed('2026-08-13'));
  });

  it('looks unrelated from one day to the next', () => {
    const week = ['13', '14', '15', '16', '17', '18', '19'].map((d) => dailySeed(`2026-08-${d}`));
    expect(new Set(week).size).toBe(7);
  });

  it('stays inside the unsigned 32-bit range the RNG expects', () => {
    for (let day = 1; day <= 28; day++) {
      const seed = dailySeed(`2026-02-${`${day}`.padStart(2, '0')}`);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('seedLabel', () => {
  it('is a fixed-width uppercase base36 string', () => {
    expect(seedLabel(0)).toBe('0000000');
    expect(seedLabel(0xffffffff)).toMatch(/^[0-9A-Z]{7}$/);
  });
});

describe('the countdown', () => {
  it('counts down to the next UTC midnight', () => {
    expect(secondsUntilNextDaily(NOON_UTC)).toBe(12 * 3600);
  });

  it('never goes negative', () => {
    expect(secondsUntilNextDaily(Date.UTC(2026, 7, 13, 23, 59, 59))).toBeGreaterThanOrEqual(0);
  });

  it('formats hours and minutes, dropping the hours near the end', () => {
    expect(formatCountdown(14 * 3600 + 9 * 60)).toBe('14h 09m');
    expect(formatCountdown(45 * 60)).toBe('45m');
  });
});
