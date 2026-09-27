/// <reference types="vite/client" />

/** `package.json`'s version, injected by `vite.config.ts` — the analytics build dimension. */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /**
   * Which portal's ad SDK to load, if any.
   *
   * Left unset in local dev and in a build meant for a site with no portal behind it
   * — those fall back to a service that never claims to be a real ad network. Set per
   * build (e.g. in Netlify's own env vars, or a `.env.crazygames` fed to a separate
   * build script) for whichever portal that particular upload is going to.
   */
  readonly VITE_AD_PLATFORM?: 'crazygames' | 'poki';

  /**
   * Real AdMob rewarded ad unit ID for the Android build. Left unset in dev and in
   * any build that hasn't been given a real one yet — those fall back to Google's own
   * test ad unit, which always fills but never pays out.
   */
  readonly VITE_ADMOB_REWARDED_UNIT_ID?: string;

  /**
   * Comma-separated AdMob test device IDs (from logcat: "Use
   * RequestConfiguration.Builder... to get test ads on this device"). Any device
   * listed here gets test creatives even against the real ad unit ID above — put this
   * in a git-ignored `.env.local`, never in `.env.production`, since it names a
   * specific person's phone rather than describing the build.
   */
  readonly VITE_ADMOB_TEST_DEVICE_IDS?: string;

  /**
   * GameAnalytics game key and secret key, one pair per platform (GameAnalytics
   * keeps Web, Android and iOS as separate games). A platform whose pair is unset
   * sends nothing and never shows the consent question. Not secrets in the usual
   * sense: GameAnalytics' own web SDK is designed to ship them in the client, they
   * only let someone *send* events to the game.
   */
  readonly VITE_GA_WEB_GAME_KEY?: string;
  readonly VITE_GA_WEB_SECRET_KEY?: string;
  readonly VITE_GA_ANDROID_GAME_KEY?: string;
  readonly VITE_GA_ANDROID_SECRET_KEY?: string;
  readonly VITE_GA_IOS_GAME_KEY?: string;
  readonly VITE_GA_IOS_SECRET_KEY?: string;
}
