/// <reference types="vite/client" />

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
}
