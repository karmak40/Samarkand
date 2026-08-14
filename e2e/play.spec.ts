import { expect, type Page, test } from '@playwright/test';

/**
 * A real run, in every engine.
 *
 * The boot suite proves the bundle loads. This proves the game is playable: a
 * settlement is generated, fought through and cleared, in Blink, Gecko and WebKit
 * alike. It runs against the dev server because hand-stepping frames needs the
 * dev-only debug handle — stepping rather than waiting on `requestAnimationFrame`
 * makes the result the same on a fast machine and a slow one.
 */

const DEV = 'http://127.0.0.1:5174/';

interface Snapshot {
  state: string;
  room: number;
  kills: number;
  damage: number;
  hp: number;
  humansAlive: number;
  humansTotal: number;
  frameErrors: number;
  lastFrameError: string;
}

/**
 * The dev harness, loaded by URL at run time.
 *
 * The specifier is passed into the page rather than written inline: it is a path the
 * dev server serves, not a module in this project, so a literal import would be a
 * compile error for a file that resolves perfectly well in the browser. It has to be
 * an argument, not a closure variable — `page.evaluate` ships the function source to
 * the browser and leaves everything around it behind.
 */
const AUTOPLAY_URL = '/dev/autoplay.js';

interface Autoplay {
  autoplay(options?: { ticks?: number }): { final: Snapshot; errors: string[] };
}

declare global {
  interface Window {
    samarkand: {
      debugFrame(ms: number): void;
      debugSnapshot(): Snapshot;
      debugBeginRun(seed?: number, daily?: boolean): number;
      debugEnterKind(kind: string): boolean;
      debugLoadRoom(depth: number): void;
      debugBuff(): void;
    };
  }
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
  await page.waitForFunction(() => typeof window.samarkand !== 'undefined', null, {
    timeout: 20_000,
  });
  await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 15_000 });
}

test('fights a settlement without a single error', async ({ page }) => {
  const errors = watchForErrors(page);
  await openGame(page);

  const final = await page.evaluate(async (url) => {
    const game = window.samarkand;
    // The same bot the project is balanced against, so this exercises the real input
    // path — held keys, released keys, clicks on canvas-drawn buttons.
    const bot = (await import(url)) as Autoplay;
    game.debugBeginRun(4242);
    return bot.autoplay({ ticks: 400 }).final;
  }, AUTOPLAY_URL);

  expect(final.kills).toBeGreaterThan(0);
  expect(final.damage).toBeGreaterThan(0);
  expect(final.frameErrors).toBe(0);
  expect(errors).toEqual([]);
});

test('clears a settlement end to end', async ({ page }, testInfo) => {
  // Playwright's WebKit rasterises canvas in software on Windows and Linux, at roughly
  // seventy milliseconds a frame. A whole settlement is thousands of frames, so this
  // one would spend minutes measuring the test rig. WebKit's coverage is the rest of
  // the file; that a cleared room is the same code in every engine is not in doubt.
  test.skip(testInfo.project.name === 'webkit', 'too slow under a software rasteriser');

  const errors = watchForErrors(page);
  await openGame(page);

  const final = await page.evaluate(async (url) => {
    const game = window.samarkand;
    const bot = (await import(url)) as Autoplay;
    game.debugBeginRun(4242);
    return bot.autoplay({ ticks: 4000 }).final;
  }, AUTOPLAY_URL);

  // The bot walks to the portal once a settlement falls, so reaching a second stop is
  // proof the whole loop closed: clear, portal, map, next arena.
  expect(final.room).toBeGreaterThan(0);
  expect(final.kills).toBeGreaterThan(5);
  expect(final.frameErrors).toBe(0);
  expect(errors).toEqual([]);
});

test('produces an identical run from the same seed', async ({ page }) => {
  const errors = watchForErrors(page);
  await openGame(page);

  // The daily seed and every reproducible bug report depend on this holding, and it
  // has to hold in each engine — a floating-point difference between them would be
  // invisible until two players compared their maps.
  const fingerprints = await page.evaluate(() => {
    const game = window.samarkand;
    const run = (): string => {
      game.debugBeginRun(20260813);
      game.debugEnterKind('battle');
      for (let i = 0; i < 120; i++) game.debugFrame(1000 / 60);
      const s = game.debugSnapshot();
      return [s.room, s.humansTotal, s.humansAlive, Math.round(s.hp)].join('|');
    };
    return [run(), run()];
  });

  expect(fingerprints[0]).toBe(fingerprints[1]);
  expect(errors).toEqual([]);
});

test('draws the monster, not just the ground', async ({ page }) => {
  const errors = watchForErrors(page);
  await openGame(page);

  // The creature is drawn entirely from arithmetic — blobs, gradients, glow. If an
  // engine disagrees about any of it the silhouette is the first thing to vanish, and
  // no exception is thrown when it does.
  const filled = await page.evaluate(() => {
    const game = window.samarkand;
    game.debugBeginRun(4242);
    game.debugEnterKind('battle');
    for (let i = 0; i < 30; i++) game.debugFrame(1000 / 60);

    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    // The camera keeps the monster centred, so the middle of the screen is it.
    const half = 60;
    const { data } = ctx.getImageData(
      Math.round(canvas.width / 2) - half,
      Math.round(canvas.height / 2) - half,
      half * 2,
      half * 2,
    );

    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  });

  expect(filled).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

/**
 * Frame cost, measured rather than assumed.
 *
 * A busy settlement has 16.7 ms to draw itself at 60 Hz. This measures the deepest
 * arena in the run — the most defenders, buildings and projectiles the game ever puts
 * on screen at once — so the number is the worst case rather than the opening room.
 */
test('keeps the deepest settlement inside the frame budget', async ({ page }, testInfo) => {
  const errors = watchForErrors(page);
  await openGame(page);

  const timing = await page.evaluate(() => {
    const game = window.samarkand;
    game.debugBeginRun(4242);
    game.debugLoadRoom(10);
    game.debugBuff();
    // Let the room wake up: defenders alerted, projectiles in the air, blood on the
    // ground. A frame measured before any of that is not the frame that matters.
    for (let i = 0; i < 180; i++) game.debugFrame(1000 / 60);

    const before = game.debugSnapshot();
    const samples: number[] = [];
    for (let i = 0; i < 150; i++) {
      const start = performance.now();
      game.debugFrame(1000 / 60);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);

    return {
      defenders: before.humansAlive,
      median: samples[Math.floor(samples.length / 2)]!,
      p95: samples[Math.floor(samples.length * 0.95)]!,
      worst: samples[samples.length - 1]!,
    };
  });

  console.log(
    `[${testInfo.project.name}] ${timing.defenders} defenders: ` +
      `median ${timing.median.toFixed(2)}ms, p95 ${timing.p95.toFixed(2)}ms, ` +
      `worst ${timing.worst.toFixed(2)}ms`,
  );

  expect(timing.defenders).toBeGreaterThan(10);

  // Only the engines whose numbers mean something on this platform. Playwright's
  // WebKit build rasterises canvas in software off macOS and runs an order of
  // magnitude slower than Safari does on Apple hardware — asserting on it would be
  // measuring the test rig. It is still logged, so a change is visible.
  if (testInfo.project.name !== 'webkit') {
    // Generous on purpose: a shared CI runner is not a benchmark rig, and a threshold
    // that flakes gets deleted. Anything near this is a real regression, not noise.
    expect(timing.median).toBeLessThan(16.7);
    expect(timing.p95).toBeLessThan(33);
  }
  expect(errors).toEqual([]);
});
