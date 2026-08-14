import { DAMAGE_TYPES, type DamageType } from '../combat/damage';
import { type RunStats } from '../stats/tracker';
import {
  ACHIEVEMENT_COUNT,
  type AchievementContext,
  type AchievementDef,
  evaluateAchievements,
  getAchievement,
} from './achievements';
import { dailyKey } from './daily';
import { type ContentGate, type UnlockCategory } from './gate';
import { defaultSettings, sanitizeSettings, type Settings } from './settings';
import { DEFAULT_SPECIES_ID, getSpecies, resolveSpecies, type Species } from './species';
import { getUnlock, isContentAvailable, UNLOCKS } from './unlocks';

const SAVE_KEY = 'samarkand.save.v1';
const SAVE_VERSION = 5;


/** Aggregated numbers across every run ever played. */
export interface LifetimeStats {
  runs: number;
  victories: number;
  deaths: number;
  totalKills: number;
  totalSouls: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalBuildings: number;
  totalPlaytime: number;
  deepestRoom: number;
  bestKills: number;
  bestDps: number;
  bestSoulsInRun: number;
  largestHit: number;
  damageByType: Record<DamageType, number>;
  killsByEnemy: Record<string, number>;
  skillPicks: Record<string, number>;
  mutationPicks: Record<string, number>;
  /** How each run ended, keyed by the thing that killed you. */
  deathsBySource: Record<string, number>;
  /** Runs played on a daily seed, ever. */
  dailyRuns: number;
}

/**
 * Today's showing on the shared seed.
 *
 * Only one day is kept. A daily is a thing you compare with other people *today*;
 * a personal archive of past dailies would be a different feature, and storing it
 * would grow the save forever for no one's benefit.
 */
export interface DailyRecord {
  /** `YYYY-MM-DD` in UTC. A mismatch with today means the record is stale. */
  key: string;
  runs: number;
  bestRooms: number;
  bestKills: number;
  bestSouls: number;
  victory: boolean;
}

function emptyDaily(key: string): DailyRecord {
  return { key, runs: 0, bestRooms: 0, bestKills: 0, bestSouls: 0, victory: false };
}

function emptyLifetime(): LifetimeStats {
  const damageByType = {} as Record<DamageType, number>;
  for (const type of DAMAGE_TYPES) damageByType[type] = 0;

  return {
    runs: 0,
    victories: 0,
    deaths: 0,
    totalKills: 0,
    totalSouls: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalBuildings: 0,
    totalPlaytime: 0,
    deepestRoom: 0,
    bestKills: 0,
    bestDps: 0,
    bestSoulsInRun: 0,
    largestHit: 0,
    damageByType,
    killsByEnemy: {},
    skillPicks: {},
    mutationPicks: {},
    deathsBySource: {},
    dailyRuns: 0,
  };
}

export interface SaveData {
  version: number;
  souls: number;
  /** Namespaced unlock keys the player owns. */
  unlocked: string[];
  lifetime: LifetimeStats;
  /** Ids of trials already earned; rewards are paid once. */
  achievements: string[];
  daily: DailyRecord;
  /** Id of the body the next run starts in. */
  speciesId: string;
  /** Presentation and controls. Never anything that changes difficulty. */
  settings: Settings;
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
  /** Wall-clock of the last save, for display only. */
  updatedAt: number;
}

/**
 * Persistent player profile.
 *
 * Everything is kept in one localStorage blob and written on meaningful events
 * (run end, upgrade purchase) rather than every frame.
 */
export class MetaProgress implements ContentGate {
  souls = 0;

  /**
   * Content bought with souls, as namespaced unlock keys.
   *
   * Souls buy *variety*, never raw numbers. An earlier version sold stat upgrades;
   * "+6% damage per level" gives a player nothing to look forward to, whereas a new
   * legendary changes what a run can become.
   */
  readonly unlocked = new Set<string>();

  /**
   * The body the next run starts in.
   *
   * Stored rather than asked for each run: the choice is a standing preference, and
   * making the player re-pick it before every hunt would be friction, not a decision.
   */
  speciesId: string = DEFAULT_SPECIES_ID;

  /** Trials earned. Their soul reward is paid on the frame they land, once. */
  readonly achievements = new Set<string>();

  /** Today's daily result, or a stale day's until the next daily run is played. */
  daily: DailyRecord = emptyDaily(dailyKey());

  /**
   * Presentation and controls.
   *
   * In the profile rather than in the run: someone who turned the camera shake off
   * did not mean 'for this hunt'.
   */
  settings: Settings = defaultSettings();

  /** Audio settings live in the profile so they survive a reload. */
  volume = 0.7;
  muted = false;
  lifetime: LifetimeStats = emptyLifetime();

  /** Set when loading found no save — the game shows the intro in that case. */
  isNewProfile = true;

  constructor() {
    this.load();
  }

  // ---- unlocks -------------------------------------------------------------

  /** ContentGate: is this card / mutation / boon allowed to appear in a run? */
  has(category: UnlockCategory, refId: string): boolean {
    return isContentAvailable(this.unlocked, category, refId);
  }

  isUnlocked(unlockId: string): boolean {
    return this.unlocked.has(unlockId);
  }

  canAfford(unlockId: string): boolean {
    const unlock = getUnlock(unlockId);
    return unlock !== undefined && !this.unlocked.has(unlockId) && this.souls >= unlock.price;
  }

  buy(unlockId: string): boolean {
    const unlock = getUnlock(unlockId);
    if (!unlock || this.unlocked.has(unlockId) || this.souls < unlock.price) return false;

    this.souls -= unlock.price;
    this.unlocked.add(unlockId);
    // Buying the last locked thing completes a trial; claim it here rather than
    // making the player finish another run before the shelf reads as full.
    this.claimAchievements(null);
    this.save();
    return true;
  }

  // ---- starting body -------------------------------------------------------

  /** Whether this body is owned, i.e. free from the start or already bought. */
  canUseSpecies(id: string): boolean {
    return getSpecies(id) !== undefined && this.has('species', id);
  }

  /** The body the next run will use, resolved and guaranteed to be a real one. */
  get species(): Species {
    return this.canUseSpecies(this.speciesId)
      ? resolveSpecies(this.speciesId)
      : resolveSpecies(DEFAULT_SPECIES_ID);
  }

  chooseSpecies(id: string): boolean {
    if (!this.canUseSpecies(id) || this.speciesId === id) return false;
    this.speciesId = id;
    this.save();
    return true;
  }

  /** Total souls spent on unlocks, for the profile screen. */
  soulsInvested(): number {
    let total = 0;
    for (const id of this.unlocked) total += getUnlock(id)?.price ?? 0;
    return total;
  }

  get unlockedCount(): number {
    return this.unlocked.size;
  }

  get unlockableCount(): number {
    return UNLOCKS.length;
  }

  get achievementCount(): number {
    return this.achievements.size;
  }

  get achievementTotal(): number {
    return ACHIEVEMENT_COUNT;
  }

  // ---- trials --------------------------------------------------------------

  /** What the trials are judged against. `run` is null outside a finished run. */
  achievementContext(run: RunStats | null): AchievementContext {
    return {
      run,
      lifetime: this.lifetime,
      unlockedContent: this.unlockedCount,
      unlockableContent: this.unlockableCount,
    };
  }

  hasAchievement(id: string): boolean {
    return this.achievements.has(id);
  }

  get achievementSouls(): number {
    let total = 0;
    for (const id of this.achievements) total += getAchievement(id)?.reward ?? 0;
    return total;
  }

  /**
   * Award everything the context now satisfies.
   *
   * Called after the lifetime record is updated, so a trial can be earned by the
   * very run that finished it. Rewards are banked immediately — a trial that pays
   * out only on the next launch would feel broken.
   */
  private claimAchievements(run: RunStats | null): AchievementDef[] {
    const fresh = evaluateAchievements(this.achievementContext(run), this.achievements);
    for (const def of fresh) {
      this.achievements.add(def.id);
      this.souls += def.reward;
    }
    return fresh;
  }

  /** Today's record, or a fresh one when the stored day has rolled over. */
  todaysDaily(now: number = Date.now()): DailyRecord {
    const key = dailyKey(now);
    return this.daily.key === key ? this.daily : emptyDaily(key);
  }

  private recordDaily(run: RunStats, soulsEarned: number): void {
    const key = dailyKey();
    // A new day wipes yesterday's line rather than merging into it.
    if (this.daily.key !== key) this.daily = emptyDaily(key);

    const d = this.daily;
    d.runs++;
    if (run.roomsCleared > d.bestRooms) d.bestRooms = run.roomsCleared;
    if (run.totalKills > d.bestKills) d.bestKills = run.totalKills;
    if (soulsEarned > d.bestSouls) d.bestSouls = soulsEarned;
    if (run.outcome === 'victory') d.victory = true;
  }

  /**
   * Fold a finished run into the lifetime record and bank its souls.
   *
   * Returns the trials the run just earned, so the results screen can show them.
   */
  recordRun(run: RunStats, soulsEarned: number, options: { daily?: boolean } = {}): AchievementDef[] {
    const l = this.lifetime;

    l.runs++;
    if (run.outcome === 'victory') l.victories++;
    else l.deaths++;

    l.totalKills += run.totalKills;
    l.totalSouls += soulsEarned;
    l.totalDamageDealt += run.totalDamageDealt;
    l.totalDamageTaken += run.totalDamageTaken;
    l.totalBuildings += run.buildingsDestroyed;
    l.totalPlaytime += run.elapsed;

    if (run.roomsCleared > l.deepestRoom) l.deepestRoom = run.roomsCleared;
    if (run.totalKills > l.bestKills) l.bestKills = run.totalKills;
    if (run.averageDps > l.bestDps) l.bestDps = run.averageDps;
    if (soulsEarned > l.bestSoulsInRun) l.bestSoulsInRun = soulsEarned;
    if (run.largestHit > l.largestHit) l.largestHit = run.largestHit;

    for (const type of DAMAGE_TYPES) l.damageByType[type] += run.damageDealtByType[type];
    for (const kill of run.killList) {
      l.killsByEnemy[kill.id] = (l.killsByEnemy[kill.id] ?? 0) + kill.count;
    }
    for (const skill of run.skillsTaken) {
      l.skillPicks[skill.id] = (l.skillPicks[skill.id] ?? 0) + 1;
    }
    for (const mutation of run.mutationsTaken) {
      l.mutationPicks[mutation.id] = (l.mutationPicks[mutation.id] ?? 0) + 1;
    }
    if (run.outcome === 'death' && run.killedBy) {
      l.deathsBySource[run.killedBy] = (l.deathsBySource[run.killedBy] ?? 0) + 1;
    }

    this.souls += soulsEarned;

    if (options.daily) {
      l.dailyRuns++;
      this.recordDaily(run, soulsEarned);
    }

    const earned = this.claimAchievements(run);
    this.save();
    return earned;
  }

  /** The enemy that has killed you the most, for the profile screen. */
  nemesis(): { name: string; count: number } | null {
    let best: { name: string; count: number } | null = null;
    for (const [name, count] of Object.entries(this.lifetime.deathsBySource)) {
      if (!best || count > best.count) best = { name, count };
    }
    return best;
  }

  favouriteElement(): { type: DamageType; damage: number } | null {
    let best: { type: DamageType; damage: number } | null = null;
    for (const type of DAMAGE_TYPES) {
      const damage = this.lifetime.damageByType[type];
      if (damage > 0 && (!best || damage > best.damage)) best = { type, damage };
    }
    return best;
  }

  // ---- persistence ---------------------------------------------------------

  save(): void {
    const data: SaveData = {
      version: SAVE_VERSION,
      souls: this.souls,
      unlocked: [...this.unlocked],
      speciesId: this.speciesId,
      settings: this.settings,
      lifetime: this.lifetime,
      achievements: [...this.achievements],
      daily: this.daily,
      volume: this.volume,
      muted: this.muted,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Private browsing or a full quota — the run still works, it just won't persist.
    }
  }

  load(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as Partial<LegacySaveData>;
      if (!data || typeof data.version !== 'number') return;
      // A save from the future belongs to a newer build; leave it untouched rather
      // than overwrite it with a downgrade.
      if (data.version > SAVE_VERSION) return;

      this.souls = typeof data.souls === 'number' ? data.souls : 0;
      if (typeof data.volume === 'number') this.volume = Math.min(1, Math.max(0, data.volume));
      if (typeof data.muted === 'boolean') this.muted = data.muted;

      this.unlocked.clear();
      for (const id of data.unlocked ?? []) {
        if (typeof id === 'string' && getUnlock(id)) this.unlocked.add(id);
      }

      // Rebuilt rather than assigned: a save is editable text, and a settings block
      // with a broken binding map would leave the player unable to walk.
      this.settings = sanitizeSettings(data.settings);

      // A body the profile no longer owns (or that this build removed) falls back to
      // the starter rather than leaving the player with an invalid creature.
      this.speciesId = this.canUseSpecies(data.speciesId ?? '') ? data.speciesId! : DEFAULT_SPECIES_ID;

      // Merge rather than replace, so a save written by an older build that lacks
      // newer counters still loads with sane defaults.
      this.lifetime = { ...emptyLifetime(), ...(data.lifetime ?? {}) };

      this.achievements.clear();
      for (const id of data.achievements ?? []) {
        // Drop ids for trials this build no longer has, so a removed trial can't
        // keep occupying a slot in the count forever.
        if (typeof id === 'string' && getAchievement(id)) this.achievements.add(id);
      }

      const daily = data.daily;
      if (daily && typeof daily.key === 'string') {
        this.daily = { ...emptyDaily(daily.key), ...daily };
      }

      this.isNewProfile = false;

      if (data.version < SAVE_VERSION) this.migrate(data);
    } catch {
      // Corrupt save: fall back to a fresh profile rather than refusing to start.
    }
  }

  /**
   * Bring an older save forward.
   *
   * v1 sold permanent stat upgrades. Those no longer exist, so rather than silently
   * deleting what the player paid for, every soul they had invested is refunded to
   * spend on unlocks instead. Losing progress on an update is worse than any balance
   * concern about a one-off windfall.
   *
   * v2 knew nothing of trials. Rather than ask a veteran to re-earn what their
   * record already proves, every lifetime trial they satisfy is granted on load.
   */
  private migrate(data: Partial<LegacySaveData>): void {
    this.claimAchievements(null);

    if (data.upgrades) {
      let refund = 0;
      for (const [id, level] of Object.entries(data.upgrades)) {
        const upgrade = LEGACY_UPGRADE_COSTS[id];
        if (!upgrade || typeof level !== 'number') continue;
        for (let i = 0; i < level; i++) {
          refund += Math.round(upgrade.base * Math.pow(upgrade.growth, i));
        }
      }
      this.souls += refund;
    }
    this.save();
  }

  reset(): void {
    this.souls = 0;
    this.speciesId = DEFAULT_SPECIES_ID;
    this.settings = defaultSettings();
    this.unlocked.clear();
    this.achievements.clear();
    this.daily = emptyDaily(dailyKey());
    this.lifetime = emptyLifetime();
    this.isNewProfile = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing we can do; the in-memory reset already happened.
    }
  }
}

/** Shape of any save we might read, including fields only older versions wrote. */
interface LegacySaveData extends SaveData {
  /** v1 only: permanent stat upgrades, since replaced by content unlocks. */
  upgrades?: Record<string, number>;
}

/**
 * Prices the v1 shop charged, kept only so a migration can refund them.
 *
 * Frozen on purpose — this is a historical record, not live balance, and it must not
 * change when the current economy does.
 */
const LEGACY_UPGRADE_COSTS: Record<string, { base: number; growth: number }> = {
  vitality: { base: 25, growth: 1.35 },
  claws: { base: 30, growth: 1.4 },
  ferocity: { base: 40, growth: 1.45 },
  swiftness: { base: 35, growth: 1.4 },
  carapace: { base: 35, growth: 1.38 },
  fortune: { base: 45, growth: 1.5 },
  hunger: { base: 60, growth: 1.6 },
  greed: { base: 30, growth: 1.4 },
  aegis: { base: 55, growth: 1.5 },
  sprint: { base: 50, growth: 1.45 },
};
