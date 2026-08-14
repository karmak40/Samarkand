import { defineConfig, devices } from '@playwright/test';

/**
 * Cross-browser smoke tests.
 *
 * These run against the *built* bundle, not the dev server: what a player downloads
 * is transpiled and minified, and a syntax level the build target allows but a browser
 * does not is exactly the failure this is here to catch.
 *
 * Three engines because the game is a single canvas driven by hand-written code —
 * there is no framework absorbing the differences. Text metrics, audio construction
 * and device pixel ratio all behave differently across Blink, Gecko and WebKit, and
 * none of it shows up in a unit test.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Stepping thousands of frames of canvas work is slow in a software rasteriser;
  // WebKit here needs well past the 30s default.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Stands in for Safari. Not the same binary Apple ships, but the same engine, and
    // it is the only way to test WebKit at all from a machine that is not a Mac.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // Two servers on purpose. The boot suite hits the built bundle, because that is
  // what a player downloads. The gameplay suite needs the dev-only debug handle to
  // hand-step frames and read the simulation, so it hits the dev server.
  webServer: [
    {
      // Host pinned to the same IPv4 address the url above checks: left to Vite's
      // default ('localhost'), Node's DNS resolution decides which stack it binds —
      // IPv4 on the machines this was developed on, but IPv6-first on GitHub Actions'
      // ubuntu-latest runners, which leaves this check connecting to a port nothing
      // is listening on and timing out identically across every browser.
      command: 'npx vite build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npx vite dev --port 5174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
