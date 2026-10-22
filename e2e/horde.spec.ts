import { expect, type Page, test } from '@playwright/test';

/**
 * The Horde, in every engine: an arena fought, survived, and scored into the
 * profile — records, the ladder, trials — then the two screens that show it.
 *
 * Like the gameplay suite this hits the dev server for the debug handle. The
 * twelve-minute clock is wound forward rather than played out; the end is still
 * reached the real way, on a stepped frame, by the same code a player hits.
 */

const DEV = 'http://127.0.0.1:5174/';
const SAVE_KEY = 'samarkand.save.v1';
/** See `play.spec.ts` for why the harness URL is passed in rather than imported. */
const AUTOPLAY_URL = '/dev/autoplay.js';

interface Snapshot {
  state: string;
  kills: number;
  hordeLevel: number | null;
  hordeWaveNumber: number;
  frameErrors: number;
}

interface HordeReport {
  earned: string[];
  horde: {
    unlocked: number;
    records: Record<string, { attempts: number; bestSeconds: number; bestWave: number; bestKills: number }>;
    runs: number;
    victories: number;
    campaignVictories: number;
  };
}

/**
 * The debug handle, typed for this file only. Declared as a cast rather than on
 * `Window`: `play.spec.ts` already declares `window.samarkand` with the subset it
 * uses, and a second, different global declaration would not compile.
 */
interface Harness {
  debugFrame(ms: number): void;
  debugSnapshot(): Snapshot;
  debugStartHorde(level?: number): void;
  debugSkipHordeClock(secondsLeft?: number): void;
  debugOpenScreen(screen: 'lifetime' | 'hordeMenu' | 'trials' | 'menu'): void;
  debugTrialReport(): HordeReport;
  debugBuff(): void;
}

interface Autoplay {
  autoplay(options?: { ticks?: number }): { final: Snapshot; errors: string[] };
}

function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function openGame(page: Page): Promise<void> {
  await page.goto(DEV);
  await page.waitForFunction(() => 'samarkand' in window, null, { timeout: 20_000 });
  await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 15_000 });
}

test('survives an arena and scores it into the profile', async ({ page }) => {
  const errors = watchForErrors(page);
  await openGame(page);

  const { fighting, final, report, saved } = await page.evaluate(
    async ({ url, saveKey }) => {
      const game = (window as unknown as { samarkand: Harness }).samarkand;
      const bot = (await import(url)) as Autoplay;

      game.debugStartHorde(1);
      game.debugBuff();
      // Long enough for the first waves to land and be fought.
      const fighting = bot.autoplay({ ticks: 400 }).final;

      game.debugSkipHordeClock(1);
      const final = bot.autoplay({ ticks: 400 }).final;

      return {
        fighting,
        final,
        report: game.debugTrialReport(),
        saved: JSON.parse(localStorage.getItem(saveKey) ?? '{}') as {
          version?: number;
          hordeRecords?: Record<string, { attempts: number }>;
        },
      };
    },
    { url: AUTOPLAY_URL, saveKey: SAVE_KEY },
  );

  expect(fighting.hordeLevel).toBe(1);
  expect(fighting.hordeWaveNumber).toBeGreaterThan(0);
  expect(fighting.kills).toBeGreaterThan(0);

  expect(final.state).toBe('results');
  expect(final.frameErrors).toBe(0);

  // The ladder moved, the arena has a record, and it counted as a Horde survival —
  // not as a campaign victory that would hand out the campaign's trials.
  expect(report.horde.unlocked).toBe(2);
  expect(report.horde.records['1']).toMatchObject({ attempts: 1, bestSeconds: 720 });
  expect(report.horde.records['1']!.bestKills).toBe(final.kills);
  expect(report.horde.runs).toBe(1);
  expect(report.horde.victories).toBe(1);
  expect(report.horde.campaignVictories).toBe(0);
  expect(report.earned).toContain('horde-survivor');
  expect(report.earned).not.toContain('first-victory');
  expect(report.earned).not.toContain('swift-end');

  // And it is on disk, not just in memory.
  expect(saved.version).toBe(6);
  expect(saved.hordeRecords?.['1']?.attempts).toBe(1);

  expect(errors).toEqual([]);
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'phone', width: 375, height: 812 },
]) {
  test(`draws the chronicle and the Horde ladder on a ${viewport.name}`, async ({ page }) => {
    const errors = watchForErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openGame(page);

    const frameErrors = await page.evaluate(async (url) => {
      const game = (window as unknown as { samarkand: Harness }).samarkand;
      const bot = (await import(url)) as Autoplay;

      // One scored attempt, so both screens have a record to lay out.
      game.debugStartHorde(1);
      game.debugBuff();
      game.debugSkipHordeClock(0.5);
      bot.autoplay({ ticks: 200 });

      for (const screen of ['lifetime', 'hordeMenu', 'trials'] as const) {
        game.debugOpenScreen(screen);
        for (let i = 0; i < 10; i++) game.debugFrame(1000 / 60);
      }
      return game.debugSnapshot().frameErrors;
    }, AUTOPLAY_URL);

    expect(frameErrors).toBe(0);
    expect(errors).toEqual([]);
  });
}
