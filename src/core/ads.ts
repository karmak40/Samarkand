import type { PluginListenerHandle } from '@capacitor/core';
import type { AdMobPlugin } from '@capacitor-community/admob';

/**
 * Rewarded video, kept behind an interface for one reason: the game does not yet know
 * where it ships. A portal (CrazyGames, Poki) hands you its own SDK and its own ad
 * inventory; a standalone site needs a network of its own (AdSense or similar). Wiring
 * either one in later means writing a class here — nothing in `Game` or the UI ever
 * touches an ad SDK directly, the same way `Input` is the only thing that knows whether
 * a press came from a key or a finger.
 */

/** What came back from trying to show one. */
export type AdResult = 'completed' | 'declined' | 'unavailable';

export interface AdService {
  /** Checked before the offer is even shown — no point asking for something that can't be delivered. */
  isRewardedAdAvailable(): boolean;
  /** Resolves once the ad finishes, fails, or the player backs out of it. */
  showRewardedAd(): Promise<AdResult>;

  /**
   * Lifecycle hooks a portal SDK uses to know what the game is doing, independent of
   * the rewarded ad above. Skipping these doesn't break the rewarded ad, but most
   * portals use them to gate *every other* ad placement (interstitials between runs,
   * banners) — a game that never calls them can end up muted for everything but the
   * one ad type it explicitly asks for.
   */
  notifyLoadingFinished(): void;
  notifyGameplayStart(): void;
  notifyGameplayStop(): void;
}

/**
 * Stands in until a real network is wired up.
 *
 * Resolves "completed" after a short delay — long enough that the loading state is
 * visibly exercised, short enough not to make manual testing painful. Never claim this
 * is a real ad in a build that ships: swap it for the SDK's own class the day one is
 * chosen, in one place.
 */
export class SimulatedAdService implements AdService {
  constructor(private readonly delayMs = 1500) {}

  isRewardedAdAvailable(): boolean {
    return true;
  }

  showRewardedAd(): Promise<AdResult> {
    return new Promise((resolve) => setTimeout(() => resolve('completed'), this.delayMs));
  }

  notifyLoadingFinished(): void {}
  notifyGameplayStart(): void {}
  notifyGameplayStop(): void {}
}

/** Never has anything to offer. The safe default for a build with no ad network at all. */
export class NoAdsService implements AdService {
  isRewardedAdAvailable(): boolean {
    return false;
  }

  showRewardedAd(): Promise<AdResult> {
    return Promise.resolve('unavailable');
  }

  notifyLoadingFinished(): void {}
  notifyGameplayStart(): void {}
  notifyGameplayStop(): void {}
}

/** Appends a `<script>` tag and resolves once it loads, once per session. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

// ---- CrazyGames ---------------------------------------------------------------

/** The slice of `window.CrazyGames.SDK` this game actually calls. */
interface CrazyGamesSdk {
  init(): Promise<void>;
  game: {
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
  };
  ad: {
    requestAd(
      type: 'rewarded' | 'midgame',
      callbacks: {
        adStarted?: () => void;
        adFinished?: () => void;
        adError?: (error: unknown) => void;
      },
    ): void;
  };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazyGamesSdk };
  }
}

/**
 * CrazyGames' SDK v3.
 *
 * `init()` must be awaited before `Game` is constructed — that is why it is a
 * separate method rather than done in the constructor, where a caller could not wait
 * for it. Outside CrazyGames' own iframe the SDK still loads and initialises fine (it
 * is how their own docs say to test locally); ads simply never fire.
 */
export class CrazyGamesAdService implements AdService {
  private sdk: CrazyGamesSdk | null = null;

  async init(): Promise<void> {
    await loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js');
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) throw new Error('CrazyGames SDK script loaded but window.CrazyGames.SDK is missing');
    await sdk.init();
    this.sdk = sdk;
  }

  isRewardedAdAvailable(): boolean {
    return this.sdk !== null;
  }

  showRewardedAd(): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve('unavailable');

    return new Promise((resolve) => {
      sdk.ad.requestAd('rewarded', {
        adFinished: () => resolve('completed'),
        adError: () => resolve('unavailable'),
      });
    });
  }

  notifyLoadingFinished(): void {
    this.sdk?.game.loadingStop();
  }

  notifyGameplayStart(): void {
    this.sdk?.game.gameplayStart();
  }

  notifyGameplayStop(): void {
    this.sdk?.game.gameplayStop();
  }
}

// ---- Poki -----------------------------------------------------------------------

/** The slice of `window.PokiSDK` this game actually calls. */
interface PokiSdk {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Resolves `true` once the break actually played, `false` if it was skipped or unavailable. */
  rewardedBreak(beforeAd?: () => void): Promise<boolean>;
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

/** Poki's SDK. Same shape as the CrazyGames adapter, translated to Poki's own calls. */
export class PokiAdService implements AdService {
  private sdk: PokiSdk | null = null;

  async init(): Promise<void> {
    await loadScript('https://game-cdn.poki.com/scripts/v2/poki-sdk.js');
    const sdk = window.PokiSDK;
    if (!sdk) throw new Error('Poki SDK script loaded but window.PokiSDK is missing');
    await sdk.init();
    this.sdk = sdk;
  }

  isRewardedAdAvailable(): boolean {
    return this.sdk !== null;
  }

  async showRewardedAd(): Promise<AdResult> {
    const sdk = this.sdk;
    if (!sdk) return 'unavailable';

    try {
      const watched = await sdk.rewardedBreak();
      return watched ? 'completed' : 'declined';
    } catch {
      return 'unavailable';
    }
  }

  notifyLoadingFinished(): void {
    this.sdk?.gameLoadingFinished();
  }

  notifyGameplayStart(): void {
    this.sdk?.gameplayStart();
  }

  notifyGameplayStop(): void {
    this.sdk?.gameplayStop();
  }
}

// ---- AdMob (Android, via Capacitor) ---------------------------------------------

/**
 * Google's published test ad unit — always fills, and requests against it can never
 * turn into disallowed clicks on a real account. Real placements exist in the AdMob
 * console per app; there is no "default" one to fall back to like a portal's shared
 * inventory, so shipping without an override here means shipping test creatives.
 */
const TEST_REWARDED_AD_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

/**
 * Real rewarded ads for the Android build. The Google Mobile Ads SDK glue is behind a
 * dynamic `import()` rather than a static one — a plain web or portal build never
 * constructs this class, and shouldn't pay bundle size for code it will never call,
 * the same reasoning `loadScript` keeps the CrazyGames/Poki SDKs out until their own
 * build actually wants them.
 *
 * Consent is requested through Google's UMP flow before any ad loads. Play policy
 * requires this for EEA/UK players; the call is one line either way, so it is not
 * worth special-casing by region.
 *
 * The ad unit ID defaults to Google's test ID above; override with
 * `VITE_ADMOB_REWARDED_UNIT_ID` once a real AdMob ad unit exists. The AdMob *app* ID
 * is a separate, build-time native setting — the `<meta-data>` in
 * `android/app/src/main/AndroidManifest.xml` — and needs to be swapped there too.
 *
 * Once a real ad unit is in play, this stops serving test creatives to everyone —
 * including whoever is holding the phone to check the revive flow still works.
 * `VITE_ADMOB_TEST_DEVICE_IDS` (comma-separated) opts specific devices back into test
 * ads on an otherwise-real build, so testing a release build never means watching, or
 * risking an accidental tap on, a real ad. Personal to whoever's device it is, so it
 * belongs in a git-ignored `.env.local`, not the committed `.env.production` — see
 * the "Реклама" section in README.md for how to find a device's ID.
 */
export class AdMobAdService implements AdService {
  private plugin: AdMobPlugin | null = null;
  private events: typeof import('@capacitor-community/admob') | null = null;
  private loaded = false;

  private readonly adUnitId = import.meta.env.VITE_ADMOB_REWARDED_UNIT_ID ?? TEST_REWARDED_AD_UNIT_ID;
  private readonly isTesting = !import.meta.env.VITE_ADMOB_REWARDED_UNIT_ID;
  private readonly testingDevices = (import.meta.env.VITE_ADMOB_TEST_DEVICE_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  async init(): Promise<void> {
    const mod = await import('@capacitor-community/admob');
    this.events = mod;
    this.plugin = mod.AdMob;

    // A consent step that fails outright (no GDPR/US message configured yet in the
    // AdMob console, a network hiccup) shouldn't take rewarded ads down with it — most
    // players aren't in a region that requires it anyway. Swallowed here rather than
    // left to the caller, since by the time `main.ts` sees an exception it can only
    // discard this whole service, not retry just the one step.
    try {
      const consent = await mod.AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === mod.AdmobConsentStatus.REQUIRED) {
        await mod.AdMob.showConsentForm();
      }
    } catch (error) {
      console.warn('[samarkand] AdMob consent step failed, continuing without it:', error);
    }

    // Not child-directed and not a general-audience ad slate: the game itself is a
    // violent horror roguelite, so requesting kid-safe creatives would be the wrong
    // default even before consent enters into it.
    await mod.AdMob.initialize({
      tagForChildDirectedTreatment: false,
      tagForUnderAgeOfConsent: false,
      maxAdContentRating: mod.MaxAdContentRating.Teen,
      ...(this.testingDevices.length > 0
        ? { initializeForTesting: true, testingDevices: this.testingDevices }
        : {}),
    });

    await mod.AdMob.addListener(mod.RewardAdPluginEvents.Loaded, () => {
      this.loaded = true;
    });
    await mod.AdMob.addListener(mod.RewardAdPluginEvents.FailedToLoad, () => {
      this.loaded = false;
    });

    await this.preload();
  }

  /** Fetches the next ad ahead of time so a dying player never waits on a network call. */
  private async preload(): Promise<void> {
    if (!this.plugin) return;
    try {
      await this.plugin.prepareRewardVideoAd({ adId: this.adUnitId, isTesting: this.isTesting });
    } catch (error) {
      console.warn('[samarkand] rewarded ad failed to preload:', error);
    }
  }

  isRewardedAdAvailable(): boolean {
    return this.loaded;
  }

  /**
   * `showRewardVideoAd()`'s own promise settles on the SDK's terms, which vary by
   * platform in exactly when they fire relative to dismissal. The three events below
   * are what every platform fires reliably, so `declined` vs `completed` is read off
   * `Dismissed` (gated on whether `Rewarded` already landed) rather than off the call's
   * return value.
   */
  showRewardedAd(): Promise<AdResult> {
    const plugin = this.plugin;
    const events = this.events;
    if (!plugin || !events || !this.loaded) return Promise.resolve('unavailable');

    return new Promise((resolve) => {
      let earned = false;
      let settled = false;
      const handles: Promise<PluginListenerHandle>[] = [];

      const settle = (result: AdResult): void => {
        if (settled) return;
        settled = true;
        void Promise.all(handles).then((list) => list.forEach((handle) => void handle.remove()));
        resolve(result);
        void this.preload();
      };

      handles.push(
        plugin.addListener(events.RewardAdPluginEvents.Rewarded, () => {
          earned = true;
        }),
      );
      handles.push(
        plugin.addListener(events.RewardAdPluginEvents.Dismissed, () => {
          settle(earned ? 'completed' : 'declined');
        }),
      );
      handles.push(
        plugin.addListener(events.RewardAdPluginEvents.FailedToShow, () => {
          settle('unavailable');
        }),
      );

      plugin.showRewardVideoAd().catch(() => settle('unavailable'));
    });
  }

  notifyLoadingFinished(): void {}
  notifyGameplayStart(): void {}
  notifyGameplayStop(): void {}
}
