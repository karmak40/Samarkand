import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { type AdService, CrazyGamesAdService, NoAdsService, PokiAdService, SimulatedAdService } from './core/ads';
import { Game } from './game';

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
 * Which ad service to hand `Game`, chosen once at boot by `VITE_AD_PLATFORM`.
 *
 * Never left to throw past this point: a portal's script can fail to load for
 * reasons that have nothing to do with this game — an ad blocker, a network hiccup,
 * or simply running the build outside the portal it was meant for while testing. None
 * of that should stop the game from booting; it only means no rewarded revive this
 * session.
 */
async function resolveAdService(): Promise<AdService> {
  try {
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

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas #stage not found');
  }

  const ads = await resolveAdService();
  const game = new Game(canvas, ads);
  game.start();
  ads.notifyLoadingFinished();
  watchAndroidBackButton(game);

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
