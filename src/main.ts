import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AdMobAdService, type AdService, CrazyGamesAdService, NoAdsService, PokiAdService, SimulatedAdService } from './core/ads';
import {
  type AnalyticsService,
  gameAnalyticsKeys,
  GameAnalyticsService,
  NoAnalytics,
  RecordingAnalytics,
} from './core/analytics';
import { Game } from './game';
import { MetaProgress } from './progression/meta';

/**
 * Route the Android hardware/gesture back button through the same door as ESC.
 *
 * Left to Capacitor's own default, a back press with no web history behind it exits
 * the app outright — mid-run, that is losing a fight to a swipe with no confirmation.
 * Every screen in this game already treats ESC as "back" (pause, close a dropdown,
 * leave a submenu); dispatching a synthetic one reuses that instead of teaching each
 * screen a second way to be told to back out. The title screen is the one place that
 * has nowhere further back to go, and the one place the button should actually quit.
 */
function watchAndroidBackButton(game: Game): void {
  if (!Capacitor.isNativePlatform()) return;

  // The returned handle would only matter for unsubscribing, and this listener is
  // meant to outlive the app.
  void App.addListener('backButton', () => {
    if (game.atMainMenu) {
      void App.exitApp();
      return;
    }
    const opts = { code: 'Escape', bubbles: true };
    window.dispatchEvent(new KeyboardEvent('keydown', opts));
    window.dispatchEvent(new KeyboardEvent('keyup', opts));
  });
}

/**
 * Which ad service to hand `Game`, chosen once at boot: AdMob on a native Android
 * build, otherwise whichever portal `VITE_AD_PLATFORM` names.
 *
 * Never left to throw past this point: a portal's script can fail to load, or the
 * AdMob SDK can fail to init, for reasons that have nothing to do with this game — an
 * ad blocker, a network hiccup, missing consent, or simply running the build outside
 * the context it was meant for while testing. None of that should stop the game from
 * booting; it only means no rewarded revive this session.
 */
async function resolveAdService(): Promise<AdService> {
  try {
    if (Capacitor.getPlatform() === 'android') {
      const service = new AdMobAdService();
      await service.init();
      return service;
    }
    if (import.meta.env.VITE_AD_PLATFORM === 'crazygames') {
      const service = new CrazyGamesAdService();
      await service.init();
      return service;
    }
    if (import.meta.env.VITE_AD_PLATFORM === 'poki') {
      const service = new PokiAdService();
      await service.init();
      return service;
    }
  } catch (error) {
    console.warn('[samarkand] ad SDK failed to initialise:', error);
  }
  // Simulated in dev so the revive flow stays exercisable by hand; a plain build with
  // no portal behind it gets the service that honestly has nothing to offer.
  return import.meta.env.DEV ? new SimulatedAdService() : new NoAdsService();
}

/**
 * Which analytics backend `Game` reports to, chosen once at boot.
 *
 * GameAnalytics when the build was given keys; otherwise a dev build records events
 * in memory (`window.samarkand.debugAnalytics()`) and a release build sends nothing.
 * Same rule as the ads: a failure here — blocked by an extension, offline — costs
 * the statistics, never the game.
 */
async function resolveAnalytics(): Promise<AnalyticsService> {
  const platform = Capacitor.getPlatform();
  const keys = gameAnalyticsKeys(platform, import.meta.env);
  if (keys) {
    try {
      const service = new GameAnalyticsService();
      // Consent has to be known before the SDK starts, and `Game` (which owns the
      // profile) doesn't exist yet — so read it from a profile of its own. Loading
      // one is just a localStorage read. A player who hasn't answered yet is a no.
      const enabled = new MetaProgress().settings.analytics;
      await service.init({ ...keys, build: `${platform} ${__APP_VERSION__}`, verbose: import.meta.env.DEV }, enabled);
      return service;
    } catch (error) {
      console.warn('[samarkand] analytics failed to initialise:', error);
    }
  }
  return import.meta.env.DEV ? new RecordingAnalytics() : new NoAnalytics();
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas #stage not found');
  }

  const [ads, analytics] = await Promise.all([resolveAdService(), resolveAnalytics()]);
  const game = new Game(canvas, ads, analytics);
  game.start();
  ads.notifyLoadingFinished();
  watchAndroidBackButton(game);

  // Reels mode — a recording studio for promo clips, see `src/reels/reels.ts`. Web
  // only, and loaded on demand so a player's bundle never carries it.
  if (!Capacitor.isNativePlatform() && new URLSearchParams(window.location.search).has('reels')) {
    const { startReels } = await import('./reels/reels');
    startReels(game);
  }

  // Dev-only handle so the game can be inspected and hand-stepped from the console
  // (requestAnimationFrame is paused whenever the document is hidden).
  if (import.meta.env.DEV) {
    (window as unknown as { samarkand: Game }).samarkand = game;
  }

  // Fade out the boot splash once the first frame is on screen.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('boot')?.classList.add('gone');
    });
  });
}

void boot();
