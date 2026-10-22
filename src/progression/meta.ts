import { HORDE_LEVELS } from '../balance';
import { DAMAGE_TYPES, type DamageType } from '../combat/damage';
import { type RunStats } from '../stats/tracker';
import {
  ACHIEVEMENT_COUNT,
  type AchievementContext,
  type AchievementDef,
  evaluateAchievements,
  type HordeRunSnapshot,
  getAchievement,
} from './achievements';
import { dailyKey } from './daily';
import { type ContentGate, type UnlockCategory } from './gate';
import { defaultSettings, sanitizeSettings, type Settings } from './settings';
import { DEFAULT_SPECIES_ID, getSpecies, resolveSpecies, type Species } from './species';
import { getLesson, LESSONS } from './tutorial';
import { getUnlock, isContentAvailable, UNLOCKS } from './unlocks';

const SAVE_KEY = 'samarkand.save.v1';
const SAVE_VERSION = 6;


/** Aggregated numbers across every run ever played. */
export interface LifetimeStats {
  /** Every run, campaign and Horde alike. */
  runs: number;
  /** Campaign victories only — a survived Horde arena counts in `hordeVictories`. */
  victories: number;
  deaths: number;
  totalKills: number;
  totalSouls: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalBuildings: number;
  totalPlaytime: number;
  /**
   * The run-length bests are campaign-only: twelve minutes of waves out-kill any
   * hunt, so a single Horde run would bury the campaign's records for good. Horde
   * keeps its own, per arena, in `MetaProgress.hordeRecords`.
   */
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
  /** Horde attempts and arenas survived, ever. */
  hordeRuns: number;
  hordeVictories: number;
}

/** Personal bests on one Horde arena. */
export interface HordeLevelRecord {
  attempts: number;
  /** Longest stand, in seconds — tops out at the arena's target on a survival. */
  bestSeconds: number;
  bestWave: number;
  bestKills: number;
}

/** How one Horde attempt went, as `recordHordeResult` is told it. */
export interface HordeAttempt {
  survived: boolean;
  seconds: number;
  wave: number;
  kills: number;
}

/** A save is editable text — keep only well-formed records for arenas that exist. */
function sanitizeHordeRecords(raw: unknown): Record<number, HordeLevelRecord> {
  const out: Record<number, HordeLevelRecord> = {};
  if (!raw || typeof raw !== 'object') return out;
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const level = Number(key);
    if (!HORDE_LEVELS.some((l) => l.level === level) || !value || typeof value !== 'object') continue;
    const r = value as Partial<HordeLevelRecord>;
    out[level] = {
      attempts: Math.floor(count(r.attempts)),
      bestSeconds: count(r.bestSeconds),
      bestWave: Math.floor(count(r.bestWave)),
      bestKills: Math.floor(count(r.bestKills)),
    };
  }
  return out;
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

/** The character a checkpoint resumes with — see `MetaProgress.checkpointBuild`. */
export interface CheckpointBuild {
  level: number;
  xpIntoLevel: number;
  souls: number;
  /** Skill card ids with how many stacks of each were taken. */
  skills: Array<{ id: string; stacks: number }>;
  mutationIds: string[];
  curseIds: string[];
}

/** A save is editable text — rebuilt field by field rather than trusted wholesale. */
function sanitizeCheckpointBuild(raw: unknown): CheckpointBuild | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<CheckpointBuild>;
  if (typeof data.level !== 'number' || data.level < 1) return null;

  const skills = Array.isArray(data.skills)
    ? data.skills
        .filter((s): s is { id: string; stacks: number } => {
          return !!s && typeof s.id === 'string' && typeof s.stacks === 'number' && s.stacks > 0;
        })
        .map((s) => ({ id: s.id, stacks: Math.floor(s.stacks) }))
    : [];

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  return {
    level: Math.floor(data.level),
    xpIntoLevel: typeof data.xpIntoLevel === 'number' && data.xpIntoLevel >= 0 ? data.xpIntoLevel : 0,
    souls: typeof data.souls === 'number' && data.souls >= 0 ? data.souls : 0,
    skills,
    mutationIds: strings(data.mutationIds),
    curseIds: strings(data.curseIds),
  };
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
    hordeRuns: 0,
    hordeVictories: 0,
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
  /** Tutorial lessons already taught (see `progression/tutorial.ts`). */
  tutorial?: string[];
  daily: DailyRecord;
  /** Id of the body the next run starts in. */
  speciesId: string;
  /** Highest biome ever reached. Ratchets up only. */
  deepestBiomeReached: number;
  /** Which biome the next run starts in, capped at `deepestBiomeReached`. */
  selectedStartBiome: number;
  /** Highest Horde arena level unlocked. Ratchets up only. */
  hordeLevelUnlocked: number;
  /** Personal bests per Horde arena, keyed by level. */
  hordeRecords?: Record<number, HordeLevelRecord>;
  /** Where the next run starts if the last one didn't end in victory. */
  checkpointBiome: number;
  checkpointDepth: number;
  checkpointBuild: CheckpointBuild | null;
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

  /**
   * Highest biome ever reached, permanently. Ratchets up only — reaching the
   * war-camp once is enough to unlock starting there directly forever after.
   */
  deepestBiomeReached = 1;

  /**
   * Which biome the next run starts in.
   *
   * A standing preference, same reasoning as `speciesId`: asking before every
   * hunt would be friction, not a decision. Always within `[1, deepestBiomeReached]`.
   */
  selectedStartBiome = 1;

  /**
   * Highest Horde arena level unlocked, permanently. Ratchets up only — surviving
   * level N unlocks N+1 forever after; dying doesn't take an unlock away.
   */
  hordeLevelUnlocked = 1;

  /** Personal bests per Horde arena, keyed by level. Absent until first attempted. */
  hordeRecords: Record<number, HordeLevelRecord> = {};

  /** Trials earned. Their soul reward is paid on the frame they land, once. */
  readonly achievements = new Set<string>();
  /** Tutorial lessons already taught — each is shown once per profile. */
  readonly tutorial = new Set<string>();

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

  /**
   * Told about every lair purchase — the analytics' souls sink. A hook rather than
   * a call from the lair screen, because two different rows there can buy (a body
   * buys and equips), and this is the one place both end up.
   */
  onPurchase: ((unlockId: string, price: number) => void) | null = null;

  buy(unlockId: string): boolean {
    const unlock = getUnlock(unlockId);
    if (!unlock || this.unlocked.has(unlockId) || this.souls < unlock.price) return false;

    this.souls -= unlock.price;
    this.unlocked.add(unlockId);
    this.onPurchase?.(unlockId, unlock.price);
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

  // ---- biome select ----------------------------------------------------------

  /**
   * Permanently unlock a biome as a run starting point.
   *
   * Called the instant its predecessor's boss falls, not on run end — dying
   * partway through the war-camp must not cost the player the unlock they just
   * earned by reaching it.
   */
  recordBiomeReached(biome: number): void {
    if (biome <= this.deepestBiomeReached) return;
    this.deepestBiomeReached = biome;
    this.save();
  }

  /** Change which biome the next run starts in. Silently capped at what's unlocked. */
  chooseStartBiome(biome: number): void {
    const clamped = Math.min(Math.max(1, Math.round(biome)), this.deepestBiomeReached);
    if (clamped === this.selectedStartBiome) return;
    this.selectedStartBiome = clamped;
    this.save();
  }

  // ---- horde mode ------------------------------------------------------------

  /**
   * Score a finished Horde attempt: fold it into the arena's bests and, on
   * survival, permanently unlock the next level. Dying on a later attempt never
   * takes an unlock back.
   *
   * Returns whether the attempt beat an earlier one — a longer stand or more kills.
   * A first attempt is the baseline, not a record: "new record" on the very first
   * try would be noise the player learns to ignore.
   */
  recordHordeResult(level: number, attempt: HordeAttempt): boolean {
    if (attempt.survived && level >= this.hordeLevelUnlocked) this.hordeLevelUnlocked = level + 1;

    const prev = this.hordeRecords[level];
    const improved =
      prev !== undefined &&
      prev.attempts > 0 &&
      (attempt.seconds > prev.bestSeconds || attempt.kills > prev.bestKills);

    this.hordeRecords[level] = {
      attempts: (prev?.attempts ?? 0) + 1,
      bestSeconds: Math.max(prev?.bestSeconds ?? 0, attempt.seconds),
      bestWave: Math.max(prev?.bestWave ?? 0, attempt.wave),
      bestKills: Math.max(prev?.bestKills ?? 0, attempt.kills),
    };

    this.save();
    return improved;
  }

  /** Arenas survived at least once — what the ladder trials count. */
  get hordeLevelsBeaten(): number {
    return Math.min(this.hordeLevelUnlocked - 1, HORDE_LEVELS.length);
  }

  /** The best showing across every arena, for the chronicle. Zeros before any attempt. */
  hordeBest(): { seconds: number; wave: number; kills: number } {
    const best = { seconds: 0, wave: 0, kills: 0 };
    for (const record of Object.values(this.hordeRecords)) {
      best.seconds = Math.max(best.seconds, record.bestSeconds);
      best.wave = Math.max(best.wave, record.bestWave);
      best.kills = Math.max(best.kills, record.bestKills);
    }
    return best;
  }

  // ---- checkpoint ------------------------------------------------------------

  /**
   * The next run's starting point, if the last one didn't end in victory.
   *
   * Rooms deep into a run are steep to re-grind after a death, so every third
   * one cleared becomes the new resume point — overwritten as the player goes
   * further, cleared entirely on a win. `checkpointBuild` travels with it: a
   * fresh level-1 body thrown at whatever the run had scaled up to by that
   * depth was never a fair fight, especially once a later biome's roster
   * assumes a body that's already been built up. The room itself (its layout,
   * the exact fight in progress) is still not saved — only the character.
   */
  checkpointBiome: 1 | 2 | 3 = 1;
  /** Depth within `checkpointBiome`, always a multiple of 3. Zero means none set. */
  checkpointDepth = 0;
  checkpointBuild: CheckpointBuild | null = null;

  get hasCheckpoint(): boolean {
    return this.checkpointDepth > 0;
  }

  /** Called every third room cleared. Ignores anything that isn't further in. */
  recordCheckpoint(biome: 1 | 2 | 3, depth: number, build: CheckpointBuild): void {
    if (biome < this.checkpointBiome) return;
    if (biome === this.checkpointBiome && depth <= this.checkpointDepth) return;
    this.checkpointBiome = biome;
    this.checkpointDepth = depth;
    this.checkpointBuild = build;
    this.save();
  }

  /** Called on a victorious run — the next hunt starts from the top again. */
  clearCheckpoint(): void {
    if (this.checkpointDepth === 0 && this.checkpointBiome === 1) return;
    this.checkpointBiome = 1;
    this.checkpointDepth = 0;
    this.checkpointBuild = null;
    this.save();
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
  achievementContext(run: RunStats | null, horde: HordeRunSnapshot | null = null): AchievementContext {
    return {
      run,
      horde,
      lifetime: this.lifetime,
      hordeLevelsBeaten: this.hordeLevelsBeaten,
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
  private claimAchievements(run: RunStats | null, horde: HordeRunSnapshot | null = null): AchievementDef[] {
    const fresh = evaluateAchievements(this.achievementContext(run, horde), this.achievements);
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
   * A Horde run passes `horde`; call `recordHordeResult` first, so a ladder trial
   * can be earned by the very survival that climbed the rung.
   */
  recordRun(
    run: RunStats,
    soulsEarned: number,
    options: { daily?: boolean; horde?: HordeRunSnapshot } = {},
  ): AchievementDef[] {
    const l = this.lifetime;
    const horde = options.horde ?? null;

    l.runs++;
    if (horde) {
      l.hordeRuns++;
      if (run.outcome === 'victory') l.hordeVictories++;
      else l.deaths++;
    } else if (run.outcome === 'victory') l.victories++;
    else l.deaths++;

    l.totalKills += run.totalKills;
    l.totalSouls += soulsEarned;
    l.totalDamageDealt += run.totalDamageDealt;
    l.totalDamageTaken += run.totalDamageTaken;
    l.totalBuildings += run.buildingsDestroyed;
    l.totalPlaytime += run.elapsed;

    if (!horde) {
      if (run.roomsCleared > l.deepestRoom) l.deepestRoom = run.roomsCleared;
      if (run.totalKills > l.bestKills) l.bestKills = run.totalKills;
      if (soulsEarned > l.bestSoulsInRun) l.bestSoulsInRun = soulsEarned;
    }
    // A rate and a single hit don't grow with run length, so either mode can set them.
    if (run.averageDps > l.bestDps) l.bestDps = run.averageDps;
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

    const earned = this.claimAchievements(run, horde);
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
      deepestBiomeReached: this.deepestBiomeReached,
      selectedStartBiome: this.selectedStartBiome,
      hordeLevelUnlocked: this.hordeLevelUnlocked,
      hordeRecords: this.hordeRecords,
      checkpointBiome: this.checkpointBiome,
      checkpointDepth: this.checkpointDepth,
      checkpointBuild: this.checkpointBuild,
      settings: this.settings,
      lifetime: this.lifetime,
      achievements: [...this.achievements],
      tutorial: [...this.tutorial],
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

      // Missing on any save older than this feature — defaults both to biome 1,
      // same as if the player had never reached the war-camp.
      this.deepestBiomeReached =
        typeof data.deepestBiomeReached === 'number' && data.deepestBiomeReached >= 1
          ? Math.floor(data.deepestBiomeReached)
          : 1;
      this.selectedStartBiome =
        typeof data.selectedStartBiome === 'number'
          ? Math.min(Math.max(1, Math.floor(data.selectedStartBiome)), this.deepestBiomeReached)
          : 1;

      // Missing on any save older than this feature — defaults to level 1, same as
      // a profile that has never touched the Horde mode.
      this.hordeLevelUnlocked =
        typeof data.hordeLevelUnlocked === 'number' && data.hordeLevelUnlocked >= 1
          ? Math.floor(data.hordeLevelUnlocked)
          : 1;
      this.hordeRecords = sanitizeHordeRecords(data.hordeRecords);

      // Missing on any save older than this feature — defaults to no checkpoint,
      // same as a profile that has never died mid-run.
      this.checkpointBiome = data.checkpointBiome === 3 ? 3 : data.checkpointBiome === 2 ? 2 : 1;
      this.checkpointDepth =
        typeof data.checkpointDepth === 'number' && data.checkpointDepth > 0
          ? Math.floor(data.checkpointDepth)
          : 0;
      this.checkpointBuild = sanitizeCheckpointBuild(data.checkpointBuild);

      // Merge rather than replace, so a save written by an older build that lacks
      // newer counters still loads with sane defaults.
      this.lifetime = { ...emptyLifetime(), ...(data.lifetime ?? {}) };

      this.achievements.clear();
      for (const id of data.achievements ?? []) {
        // Drop ids for trials this build no longer has, so a removed trial can't
        // keep occupying a slot in the count forever.
        if (typeof id === 'string' && getAchievement(id)) this.achievements.add(id);
      }

      this.tutorial.clear();
      if (Array.isArray(data.tutorial)) {
        for (const id of data.tutorial) if (typeof id === 'string' && getLesson(id)) this.tutorial.add(id);
      } else if ((data.lifetime?.runs ?? 0) > 0) {
        // A save from before the tutorial existed, belonging to someone who has
        // already played: they learned all of this the hard way, and being walked
        // through "move with WASD" on their next run would be patronising.
        for (const lesson of LESSONS) this.tutorial.add(lesson.id);
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
   * The same pass grants v6's Horde ladder trials to anyone already up the ladder.
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
    this.deepestBiomeReached = 1;
    this.selectedStartBiome = 1;
    this.hordeLevelUnlocked = 1;
    this.hordeRecords = {};
    this.checkpointBiome = 1;
    this.checkpointDepth = 0;
    this.checkpointBuild = null;
    this.settings = defaultSettings();
    this.unlocked.clear();
    this.achievements.clear();
    this.tutorial.clear();
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
