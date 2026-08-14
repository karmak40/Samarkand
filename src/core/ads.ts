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
