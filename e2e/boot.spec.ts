import { expect, type Page, test } from '@playwright/test';

/**
 * Does the shipped bundle actually run in this engine?
 *
 * Everything here goes through the built files and the real animation loop — no
 * debug handle, no hand-stepped frames. The unit suite already covers the logic; what
 * this covers is the half of the game that only exists inside a browser: canvas text
 * metrics, device pixel ratio, audio construction, and whatever syntax the build
 * emitted actually parsing.
 */

/** Console errors and uncaught exceptions, collected for the whole test. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

/**
 * How many distinct colours the canvas is showing.
 *
 * A blank or single-colour canvas means the game booted but drew nothing — the exact
 * failure mode a leaked clip or a dead frame loop produces, and one that no exception
 * would report.
 */
async function distinctColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 600));
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 331) {
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    }
    return seen.size;
  });
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  // The splash only clears after two animation frames, so waiting for it proves the
  // loop is running rather than merely that the script parsed.
  await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 15_000 });
}

test('boots, paints, and logs nothing', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  const size = await page.evaluate(() => {
    const canvas = document.getElementById('stage') as HTMLCanvasElement;
    return { w: canvas.width, h: canvas.height, dpr: window.devicePixelRatio };
  });

  expect(size.w).toBeGreaterThan(100);
  expect(size.h).toBeGreaterThan(100);
  // The backing store is scaled by DPR; a mismatch means everything renders at the
  // wrong size or blurred on a retina display.
  expect(size.w).toBeCloseTo(page.viewportSize()!.width * size.dpr, -1);

  expect(await distinctColours(page)).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('keeps drawing over time rather than freezing on frame one', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  const sample = async (): Promise<string> =>
    page.evaluate(() => {
      const canvas = document.getElementById('stage') as HTMLCanvasElement;
      // A small strip is enough to notice the drifting embers on the title screen.
      return canvas.getContext('2d')!.getImageData(0, 0, 64, 64).data.join(',');
    });

  const first = await sample();
  await page.waitForTimeout(1200);
  const second = await sample();

  expect(second).not.toBe(first);
  expect(errors).toEqual([]);
});

/**
 * Layout at sizes nobody develops at.
 *
 * The game is one canvas that lays itself out from `width` and `height` every frame,
 * so an unusual viewport is not a CSS problem — it is arithmetic that can go negative.
 * A negative rounded-rect radius took the whole frame loop down once already.
 */
const viewports = [
  { name: 'laptop', width: 1280, height: 720 },
  { name: 'full hd', width: 1920, height: 1080 },
  { name: 'small laptop', width: 1024, height: 640 },
  { name: 'narrow and tall', width: 580, height: 910 },
  { name: 'very small', width: 400, height: 400 },
  { name: 'wide and short', width: 1600, height: 380 },
];

for (const viewport of viewports) {
  test(`survives ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
    const errors = watchForErrors(page);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await boot(page);
    await page.waitForTimeout(400);

    expect(await distinctColours(page)).toBeGreaterThan(3);
    expect(errors).toEqual([]);
  });
}

test('survives being resized while running', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  for (const size of [
    { width: 700, height: 500 },
    { width: 1600, height: 900 },
    { width: 420, height: 800 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(250);
  }

  expect(await distinctColours(page)).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});

test('starts audio on the first gesture without throwing', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  // Browsers refuse to build an AudioContext outside a user gesture, and each engine
  // refuses slightly differently. A real click is the only way to test the real path.
  await page.mouse.move(10, 10);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(600);

  expect(errors).toEqual([]);
});

/**
 * The document around the canvas.
 *
 * None of this is visible in the game, which is exactly why it rots: nobody notices a
 * missing description or a stale `lang` while playing. The tab strip, the share
 * preview and every screen reader read this and nothing else.
 */
test('ships a complete page shell', async ({ page }) => {
  await boot(page);

  const shell = await page.evaluate(() => {
    const meta = (selector: string): string | null =>
      document.querySelector(selector)?.getAttribute('content') ?? null;

    return {
      title: document.title,
      lang: document.documentElement.lang,
      description: meta('meta[name="description"]'),
      themeColor: meta('meta[name="theme-color"]'),
      colorScheme: meta('meta[name="color-scheme"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDescription: meta('meta[property="og:description"]'),
      twitterCard: meta('meta[name="twitter:card"]'),
      icon: document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? null,
    };
  });

  expect(shell.title.length).toBeGreaterThan(0);
  expect(['en', 'de', 'ru']).toContain(shell.lang);
  expect(shell.description?.length ?? 0).toBeGreaterThan(60);
  expect(shell.themeColor).toBe('#07070a');
  expect(shell.colorScheme).toBe('dark');
  expect(shell.ogTitle).toBe('Samarkand');
  expect(shell.ogDescription?.length ?? 0).toBeGreaterThan(30);
  expect(shell.twitterCard).toBe('summary');

  // Inline, so the promise that this project ships no asset files still holds.
  expect(shell.icon).toMatch(/^data:image\/svg\+xml,/);
});

test('the document language follows the chosen one', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  // Set through the same storage key the game reads on boot, because the switch now
  // lives inside a canvas-drawn settings screen that a DOM test cannot click.
  for (const locale of ['de', 'ru', 'en'] as const) {
    await page.evaluate((value) => localStorage.setItem('samarkand.locale', value), locale);
    await page.reload();
    await expect(page.locator('#boot')).toHaveClass(/gone/, { timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale);
  }

  expect(errors).toEqual([]);
});

test('reacts to a click on the canvas', async ({ page }) => {
  const errors = watchForErrors(page);
  await boot(page);

  const before = await distinctColours(page);
  // The hunt button sits under the title, centred. Exact placement is not the point —
  // the point is that a click anywhere is routed and handled without an exception.
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.36 + 26);
  await page.waitForTimeout(800);

  expect(await distinctColours(page)).toBeGreaterThan(3);
  expect(before).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
