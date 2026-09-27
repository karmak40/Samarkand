/**
 * Play analytics, kept behind an interface for the same reason ads are (see `ads.ts`):
 * `Game` says *what happened* in the game's own words — a run started, a room fell, a
 * card was picked — and never touches an SDK. Which backend hears about it, if any, is
 * decided once at boot in `main.ts`.
 *
 * The vocabulary is GameAnalytics' four event kinds, because they map onto a roguelite
 * almost one to one:
 *
 * - **progression** — runs and rooms: start, complete, fail. This is the funnel that
 *   answers "where do players die, and where do they quit".
 * - **resource** — the meta currency (souls): earned per run, spent in the lair.
 * - **design** — everything else, as a `a:b:c` path: picks, rerolls, frame cost.
 * - **ad** — rewarded video shown / rewarded / failed, per placement.
 *
 * Nothing here identifies a person. GameAnalytics assigns a random install id; the
 * game adds no name, no account, no free text.
 */

export type ProgressionStatus = 'start' | 'complete' | 'fail';
export type ResourceFlow = 'source' | 'sink';
export type AdEventAction = 'show' | 'rewarded' | 'failed';
/** Where a rewarded video was offered. */
export type AdPlacement = 'revive' | 'reroll';

export interface AnalyticsService {
  /**
   * Whether this build has anywhere to send events at all. False means the consent
   * question is pointless and is never asked.
   */
  readonly configured: boolean;
  /** Honours the player's setting: false stops anything more from being sent. */
  setEnabled(enabled: boolean): void;
  progression(status: ProgressionStatus, parts: readonly string[], score?: number): void;
  resource(flow: ResourceFlow, currency: string, amount: number, itemType: string, itemId: string): void;
  design(path: readonly string[], value?: number): void;
  ad(action: AdEventAction, placement: AdPlacement, sdkName: string): void;
  error(message: string): void;
}

/** A build with no analytics configured. Every call is a no-op. */
export class NoAnalytics implements AnalyticsService {
  readonly configured = false;
  setEnabled(): void {}
  progression(): void {}
  resource(): void {}
  design(): void {}
  ad(): void {}
  error(): void {}
}

/**
 * Keeps every event in memory instead of sending it — the dev build's backend, so
 * `window.samarkand.debugAnalytics()` shows exactly what a real build would send,
 * and the tests' way of checking the vocabulary without a network.
 */
export class RecordingAnalytics implements AnalyticsService {
  /** True so a dev build walks through the consent question like a release would. */
  readonly configured = true;
  readonly events: string[] = [];
  enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  progression(status: ProgressionStatus, parts: readonly string[], score?: number): void {
    this.push(`progression ${status} ${progressionParts(parts).join(':')}${score !== undefined ? ` =${score}` : ''}`);
  }
  resource(flow: ResourceFlow, currency: string, amount: number, itemType: string, itemId: string): void {
    this.push(`resource ${flow} ${currency} ${amount} ${eventPart(itemType)}:${eventPart(itemId)}`);
  }
  design(path: readonly string[], value?: number): void {
    this.push(`design ${designEventId(path)}${value !== undefined ? ` =${value}` : ''}`);
  }
  ad(action: AdEventAction, placement: AdPlacement, sdkName: string): void {
    this.push(`ad ${action} ${placement} ${sdkName}`);
  }
  error(message: string): void {
    this.push(`error ${message.slice(0, 80)}`);
  }

  private push(event: string): void {
    if (!this.enabled) return;
    this.events.push(event);
    // A dev session can run for hours; the recent tail is all anyone reads.
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }
}

// ---- naming ----------------------------------------------------------------------

/**
 * One segment of an event id, cleaned to what GameAnalytics accepts.
 *
 * Its validator allows `[A-Za-z0-9 \-_.()!?]` up to 64 characters and silently drops
 * any event that breaks the rule — so a card id with an unexpected character would
 * not fail loudly, it would just never show up in a dashboard. Everything else
 * becomes `_` rather than vanishing, so two ids can't collapse into one.
 */
export function eventPart(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9 \-_.()!?]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'none';
}

/** Design event ids are `a:b:c`, at most five segments. */
export function designEventId(path: readonly string[]): string {
  return path.slice(0, 5).map(eventPart).join(':');
}

/** Progression takes at most three levels (`campaign` › `biome2` › `room07`). */
export function progressionParts(parts: readonly string[]): string[] {
  return parts.slice(0, 3).map(eventPart);
}

export function biomeTag(biome: number): string {
  return `biome${biome}`;
}

/**
 * Rooms are zero-padded so they sort in order in every dashboard — `room10` would
 * otherwise land between `room1` and `room2`. One-based, like the HUD shows them.
 */
export function roomTag(depth: number): string {
  return `room${String(depth + 1).padStart(2, '0')}`;
}

// ---- GameAnalytics ---------------------------------------------------------------

/**
 * The SDK's command-style entry point: `GameAnalytics('addDesignEvent', id, value)`.
 *
 * Used instead of its class API because the package's ESM build and its type
 * declarations disagree about what the module exports; the command function is the
 * one both agree on, and is the SDK's own documented way in.
 */
type GaCommand = (command: string, ...args: unknown[]) => void;

// The SDK's enums are numeric and not exported in a usable form — see `GaCommand`.
const GA_PROGRESSION: Record<ProgressionStatus, number> = { start: 1, complete: 2, fail: 3 };
const GA_FLOW: Record<ResourceFlow, number> = { source: 1, sink: 2 };
const GA_AD_ACTION: Record<AdEventAction, number> = { show: 2, failed: 3, rewarded: 4 };
const GA_AD_REWARDED_VIDEO = 2;
const GA_SEVERITY_ERROR = 4;

/** Every value `resource()` may be called with must be declared before `initialize`. */
export const RESOURCE_CURRENCIES = ['souls'] as const;
export const RESOURCE_ITEM_TYPES = ['run', 'unlock'] as const;

/**
 * The key pair for the platform this build is running on.
 *
 * GameAnalytics keeps each platform as its own game with its own keys, while
 * `vite build` makes one bundle that ships both to the web and inside the Android
 * and iOS apps — so the choice has to happen at runtime, from Capacitor's platform.
 * Null when that platform has no keys: it then sends nothing and never asks.
 */
export function gameAnalyticsKeys(
  platform: string,
  env: Readonly<Record<string, string | boolean | undefined>>,
): { gameKey: string; secretKey: string } | null {
  const prefix = platform === 'android' ? 'ANDROID' : platform === 'ios' ? 'IOS' : 'WEB';
  const gameKey = env[`VITE_GA_${prefix}_GAME_KEY`];
  const secretKey = env[`VITE_GA_${prefix}_SECRET_KEY`];
  if (typeof gameKey !== 'string' || typeof secretKey !== 'string' || !gameKey || !secretKey) return null;
  return { gameKey, secretKey };
}

export interface GameAnalyticsConfig {
  gameKey: string;
  secretKey: string;
  /** Shows up as the build dimension: `android 0.1.0`, `web 0.1.0`. */
  build: string;
  /** SDK console logging — dev builds only. */
  verbose: boolean;
}

export class GameAnalyticsService implements AnalyticsService {
  readonly configured = true;
  /** Set once the SDK is initialized — every event method is a no-op until then. */
  private ga: GaCommand | null = null;
  private sdk: GaCommand | null = null;
  private config: GameAnalyticsConfig | null = null;
  private enabled = false;
  private initialized = false;

  /**
   * Load the SDK, and start it only if the player allows statistics.
   *
   * It is ~90 KB, so it arrives through a dynamic `import()` the same way the AdMob
   * plugin does — a build without keys never downloads it. Loading it sends nothing;
   * `initialize` does — an init request with the install id and device info goes out
   * even while event submission is switched off. So an opted-out player's SDK is
   * never initialized at all, and one who opts in later gets it initialized then.
   */
  async init(config: GameAnalyticsConfig, enabled: boolean): Promise<void> {
    const module = (await import('gameanalytics')) as unknown as { default: GaCommand };
    const sdk = module.default;

    sdk('setEnabledInfoLog', config.verbose);
    sdk('configureBuild', config.build);
    sdk('configureAvailableResourceCurrencies', [...RESOURCE_CURRENCIES]);
    sdk('configureAvailableResourceItemTypes', [...RESOURCE_ITEM_TYPES]);
    this.sdk = sdk;
    this.config = config;

    // The SDK ends a session on unload by itself, but a phone rarely unloads — it
    // backgrounds. Without this a mobile session would run for as long as the app
    // sat in the task switcher, and session length would mean nothing.
    document.addEventListener('visibilitychange', () => {
      this.ga?.(document.hidden ? 'onStop' : 'onResume');
    });

    this.setEnabled(enabled);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    const sdk = this.sdk;
    const config = this.config;
    if (!sdk || !config) return;

    if (enabled && !this.initialized) {
      sdk('initialize', config.gameKey, config.secretKey);
      this.initialized = true;
      this.ga = sdk;
      return;
    }
    if (!this.initialized) return;
    // Already initialized: the SDK can't be un-initialized, but with submission off
    // it drops every event (and the session end) instead of storing it for later.
    sdk('setEnabledEventSubmission', enabled);
    this.ga = enabled ? sdk : null;
  }

  progression(status: ProgressionStatus, parts: readonly string[], score?: number): void {
    const [p1 = '', p2 = '', p3 = ''] = progressionParts(parts);
    this.ga?.('addProgressionEvent', GA_PROGRESSION[status], p1, p2, p3, score);
  }

  resource(flow: ResourceFlow, currency: string, amount: number, itemType: string, itemId: string): void {
    // GameAnalytics rejects a zero or negative amount; there is nothing to record anyway.
    if (!(amount > 0)) return;
    this.ga?.('addResourceEvent', GA_FLOW[flow], currency, amount, itemType, eventPart(itemId));
  }

  design(path: readonly string[], value?: number): void {
    this.ga?.('addDesignEvent', designEventId(path), value);
  }

  ad(action: AdEventAction, placement: AdPlacement, sdkName: string): void {
    this.ga?.('addAdEvent', GA_AD_ACTION[action], GA_AD_REWARDED_VIDEO, sdkName, placement);
  }

  error(message: string): void {
    // First line only: stacks carry file paths that differ per build and would split
    // one bug into a thousand distinct errors.
    this.ga?.('addErrorEvent', GA_SEVERITY_ERROR, message.split('\n')[0]!.slice(0, 8000));
  }
}
