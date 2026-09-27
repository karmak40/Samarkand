import { Ambience } from './audio/ambience';
import { AudioEngine } from './audio/engine';
import { SoundBank } from './audio/sfx';
import { BUILDING_HP_SCALE_PER_ROOM_INDEX, HORDE_LEVELS, HORDE_WAVE_CONFIG, ON_KILL_EFFECTS } from './balance';
import { type AdResult, type AdService, SimulatedAdService } from './core/ads';
import { type AnalyticsService, biomeTag, NoAnalytics, RecordingAnalytics, roomTag } from './core/analytics';
import { Camera } from './core/camera';
import { Input } from './core/input';
import { clamp, TAU, type Vec2 } from './core/math';
import { RNG } from './core/rng';
import { Building } from './entities/building';
import { Human } from './entities/human';
import { Monster } from './entities/monster';
import { t } from './i18n';
import { type AchievementDef } from './progression/achievements';
import { getBoon } from './progression/boons';
import { dailySeed } from './progression/daily';
 import { applyCurse, curseName, getCurse, rollCurses } from './progression/curses';
import { drawMutations, getMutation, isEvolutionRoom, type Mutation } from './progression/evolution';
import { type CheckpointBuild, MetaProgress } from './progression/meta';
import { EFFECTS_SCALE, SHAKE_SCALE } from './progression/settings';
import { type UnlockCategory } from './progression/gate';
import { getCard, type SkillCard, SkillPool } from './progression/skills';
import { type FixedViewport, Renderer } from './render/renderer';
import { RunStats } from './stats/tracker';
import { drawHud } from './ui/hud';
import {
  drawBuildSheet,
  drawMenuBackdrop,
  drawCardSelect,
  drawLifetime,
  drawMainMenu,
  drawMutationSelect,
  drawPause,
  drawResults,
  newResultsView,
  type ResultsView,
  drawRoomIntro,
} from './ui/screens';
import {
  type CursedOffer,
  drawCursedAltar,
  drawMarket,
  drawRunMap,
  initMapViewState,
  type MapViewState,
  type MarketOffer,
} from './ui/run-screens';
import { drawAchievements } from './ui/achievements';
import { drawConsent } from './ui/consent';
import { drawHordeMenu } from './ui/horde';
import { drawLair } from './ui/lair';
import { drawReviveOffer, newReviveView, type ReviveView } from './ui/revive';
import { drawSettings, newSettingsView, type SettingsView } from './ui/settings';
import { drawTouchControls } from './ui/touch-hud';
import { PALETTE, Ui } from './ui/widgets';
import { generateHordeArena } from './world/hordegen';
import { hordeDifficultyTier, isEliteWave, rollHordeWave } from './world/hordewaves';
import { BIOME_ROOMS, generateRoom, type PlannedSpawn, type RoomPlan } from './world/roomgen';
 import { generateRunMap, isArenaNode, reachableFrom, type RunMap } from './world/runmap';
import { World } from './world/world';

/** Whole-run room count: three biomes, each `BIOME_ROOMS` deep, back to back. */
const TOTAL_DEPTHS = BIOME_ROOMS * 3;
const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/** Consecutive failed frames before the game gives up on the current screen. */
const BROKEN_FRAME_LIMIT = 60;
const ROOM_INTRO_DURATION = 2.4;
/** Seconds of total inactivity after which a room is force-cleared. */
const STALL_TIMEOUT = 45;

/**
 * Presentation knobs for reels mode (`?reels`, see `src/reels/`) — things a promo
 * video wants and a player never should. Inert at their defaults, and nothing in the
 * game itself ever changes them; only the reels controller does.
 */
export interface CinemaOptions {
  /** Reels mode is on at all: on-screen touch controls are never drawn. */
  active: boolean;
  /** No HUD, room titles or pause icon — just the arena. */
  hideHud: boolean;
  /** Multiplies real time before it reaches the simulation; below 1 is slow motion. */
  timeScale: number;
  /** The monster's health is topped up every tick, so a take is never cut short by death. */
  immortal: boolean;
}

type GameState =
  | 'menu'
  | 'lifetime'
  | 'lair'
  | 'trials'
  | 'settings'
  | 'map'
  | 'playing'
  | 'cards'
  | 'mutation'
  | 'market'
  | 'cursed'
  | 'pause'
  | 'revive'
  | 'results'
  | 'hordeMenu'
  | 'hordePlaying';

/**
 * Top-level game object: owns the loop, the state machine and the run lifecycle.
 *
 * The simulation is stepped at a fixed 60 Hz regardless of display refresh, and
 * rendering happens once per animation frame. Anything modal (cards, pause) simply
 * stops stepping the simulation while still drawing the frozen world behind it.
 */
export class Game {
  private readonly renderer: Renderer;
  private readonly input: Input;
  private readonly ui: Ui;
  private readonly camera = new Camera();
  private readonly meta = new MetaProgress();

  private readonly audio = new AudioEngine();
  private readonly sound = new SoundBank(this.audio);
  private readonly ambience = new Ambience(this.audio);
  /** Recent damage taken, decaying — one of the inputs to the ambience mix. */
  private heat = 0;
  /** Whether a boss is alive in the current room, refreshed once per `step()`. */
  private bossAlive = false;

  /**
   * Rewarded-video revive.
   *
   * `ads` is injected rather than constructed here: which SDK it wraps, if any, is
   * decided once at boot in `main.ts` by which portal the build is going to, and
   * `Game` has no business knowing that. `reviveAdUsed` caps the offer at once per
   * run — a comeback offered after every death would cost the roguelite its stakes,
   * so it exists only for the one death that would otherwise end the run outright.
   */
  private readonly ads: AdService;
  private reviveAdUsed = false;

  /**
   * Play statistics — injected for the same reason `ads` is. The progression path of
   * the room being fought (`campaign › biome1 › room04`) is kept while a room is live,
   * so the room that ends a run can be reported as the one that failed.
   */
  private readonly analytics: AnalyticsService;
  private roomProgress: string[] | null = null;
  /** Set when the player walks out (pause → menu), so the run is reported as quit, not lost. */
  private quitting = false;
  private readonly reviveView: ReviveView = newReviveView();
  /** Seconds spent in the revive offer, for the "ad playing" pulse. */
  private reviveElapsed = 0;

  private state: GameState = 'menu';
  readonly cinema: CinemaOptions = { active: false, hideHud: false, timeScale: 1, immortal: false };
  /** Toggled with Tab during play. */
  private showBuildSheet = false;

  // --- run state ------------------------------------------------------------
  private world!: World;
  private monster!: Monster;
  private tracker!: RunStats;
  private skillPool!: SkillPool;
  private runRng!: RNG;

  // --- run map --------------------------------------------------------------
  private runMap!: RunMap;
  /** Where the player stands. Null before the first stop is chosen. */
  private currentNodeId: number | null = null;
  private readonly visitedNodes = new Set<number>();
  /** Arena plans keyed by node id — only fighting stops need one. */
  private plansByNode = new Map<number, RoomPlan>();
  /**
   * The plan for whichever arena is actually live right now, set by `enterArena`.
   * The campaign looks its plan up from `plansByNode`/`currentNodeId`, but Horde
   * has neither — this field is what `currentPlan` actually reads, for both.
   */
  private activePlan: RoomPlan | null = null;
  private mapTime = 0;
  /** Which biome's content (roster, terrain, boss) the active map uses. */
  private biome: 1 | 2 | 3 = 1;
  /**
   * Depth offset added to `this.runMap`'s own node depths (which always start at 0
   * again for every biome) for every difficulty curve and for `roomIndex`.
   *
   * Continuing naturally into the war-camp after the first biome's boss keeps this
   * at `BIOME_ROOMS`, so the climb never resets — the player is already built up for
   * it. Starting the war-camp directly from the menu keeps it at 0 instead: nothing
   * has been earned yet, so the ramp has to be as gentle as the first biome's own.
   */
  private difficultyBase = 0;
  /** This run's total room count, for the HUD and for `generateRoom`'s pacing. */
  private totalRunRooms = TOTAL_DEPTHS;
  /**
   * How many of `biome`'s own layers were skipped generating a shortened map to
   * resume from a checkpoint. Zero on a normal run. Added to a node's own depth
   * to get its true depth within the biome, since the map itself only ever
   * counts from 0 — `difficultyBase` can't be reused for this, as it also
   * carries the war-camp's continuation offset for the *whole run's* numbering.
   */
  private biomeStartDepth = 0;

  // --- horde mode -------------------------------------------------------------
  /** Non-null exactly while a Horde run is active; also the level being attempted. */
  private hordeLevel: number | null = null;
  private hordeElapsed = 0;
  private hordeWaveNumber = 0;
  /** Counts down to the next wave; a fresh wave resets it, not zeroes it. */
  private hordeSpawnTimer = 0;
  /** True for the last `warningLeadSeconds` before a wave lands — pulses the HUD. */
  private hordeWarning = false;
  /** Whether the wave currently being warned about (or just spawned) is an elite one. */
  private hordeWarningElite = false;
  private hordeSpawnPoints: Vec2[] = [];
  private hordeTargetSeconds = 0;
  /** Which tab and scroll offset the Horde level-select screen is showing. */
  private readonly hordeMenuView = { scroll: 0 };

  private marketOffers: MarketOffer[] = [];
  private cursedOffers: CursedOffer[] = [];
  /** Where to return after a nested card draft (the market sells one). */
  private cardsReturnState: GameState | null = null;

  /** Depth of the current stop; drives every difficulty curve. */
  private roomIndex = 0;
  private humansAtRoomStart = 0;
  private roomIntroTimer = 0;
  /**
   * `tracker.elapsed` the moment the player first proved they'd read the
   * opening control hint — moved a real distance and landed a hit — or null
   * while that's still unproven. Drives the hint's fade-out in `drawHints`:
   * someone who gets it in three seconds shouldn't have it hanging around for
   * fourteen, and someone still fumbling at fourteen shouldn't lose it either.
   */
  private controlsHintClearedAt: number | null = null;
  private exitReady = false;
  /** Whether this room's reinforcement wave (if it rolled one) has already marched in. */
  private reinforcementsSpawned = false;
  /** Inactivity tracking for the anti-softlock guard. */
  private stallTimer = 0;
  private stallDamageMark = 0;
  private stallKillMark = 0;
  private soulsAtRunStart = 0;
  /** Whether this run is on the shared daily seed. */
  private isDailyRun = false;
  /** Trials the finished run just earned, shown on the results screen. */
  private earnedTrials: readonly AchievementDef[] = [];

  private pendingCards: SkillCard[] = [];
  private pendingMutations: Mutation[] = [];
  /** Whether the market's ad-gated reroll is currently waiting on `showRewardedAd()`. */
  private cardAdRerollPending = false;
  /**
   * Whether this market draft has already had its one ad reroll. Without a cap, a
   * free reroll that is always there turns the souls-priced one next to it into a
   * button nobody presses — watch ads until the right card comes up. Reset per draft,
   * not per run: every draft the market sells gets its own one.
   */
  private cardAdRerollUsed = false;

  private hurtFlash = 0;
  private lastHp = 0;
  private menuTime = 0;
  /** Which tab and scroll offset the lair screen is showing. */
  private readonly lairView: { category: UnlockCategory; scroll: number } = {
    category: 'card',
    scroll: 0,
  };
  private readonly trialsView = { scroll: 0 };
  /** Pan/drag state for the run map — persists across screen visits within a run. */
  private readonly mapView: MapViewState = initMapViewState();
  private readonly settingsView: SettingsView = newSettingsView();
  private readonly resultsView: ResultsView = newResultsView();
  /** Where 'back' returns to: the title screen, or the paused run it was opened from. */
  private settingsReturnState: GameState = 'menu';
  /**
   * Where resuming from pause goes back to.
   *
   * Pause used to be reachable only from 'playing', so resuming could just say so.
   * The map, the market and the cursed altar had no way back to the title screen at
   * all — picking a destination was the only button on the whole screen — so pause
   * opens from there too now, and needs to remember which of the four it interrupted.
   */
  private pauseReturnState: GameState = 'playing';

  // --- loop -----------------------------------------------------------------
  private accumulator = 0;
  private lastFrameMs = 0;
  private running = false;

  // ---- frame health --------------------------------------------------------
  /** Total frames lost to an exception this session. Surfaced in debugSnapshot. */
  private frameErrors = 0;
  private consecutiveFrameErrors = 0;
  /** Last failure text, so a fault repeating every frame is logged once. */
  private lastFrameError = '';

  /** Smoothed cost of a frame in milliseconds, for the optional readout. */
  private frameCostMs = 0;

  constructor(
    canvas: HTMLCanvasElement,
    ads: AdService = new SimulatedAdService(),
    analytics: AnalyticsService = new NoAnalytics(),
  ) {
    this.ads = ads;
    this.analytics = analytics;
    this.meta.onPurchase = (unlockId, price) => analytics.resource('sink', 'souls', price, 'unlock', unlockId);
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.ui = new Ui(this.renderer.ctx);
    this.ui.sound = this.sound;

    window.addEventListener('resize', () => this.renderer.resize());

    // Browsers only let audio start inside a user gesture. Listen for the first of
    // any kind, then restore the player's saved volume.
    const unlock = (): void => {
      this.audio.unlock();
      this.audio.setVolume(this.meta.volume);
      this.audio.setMuted(this.meta.muted);
      this.ambience.start();
    };
    for (const event of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(event, unlock, { passive: true });
    }

    this.watchFocus();
    this.input.setBindings(this.meta.settings.bindings);
  }

  /**
   * Push the player's settings into the systems that obey them.
   *
   * Once a frame rather than on change: the particle system and the floating text
   * belong to the world, and a new world is built for every run. Pushing on change
   * alone would silently drop the settings the moment a run started.
   */
  private applySettings(): void {
    const settings = this.meta.settings;
    this.camera.shakeScale = SHAKE_SCALE[settings.shake];
    // Takes shot for a promo video aren't play — reels mode never reports.
    this.analytics.setEnabled(settings.analytics && !this.cinema.active);

    if (this.world) {
      this.world.particles.densityScale = EFFECTS_SCALE[settings.effects];
      this.world.texts.showDamageNumbers = settings.damageNumbers;
    }
  }

  /**
   * Pause the run when the player stops looking at it.
   *
   * `blur` is the one that matters. A hidden tab is already safe — browsers throttle
   * `requestAnimationFrame` to a halt on it — but a window merely covered by another,
   * or sitting on a second monitor, keeps running at full speed with nobody at the
   * keyboard. Input drops its held keys on blur, so the monster stops moving and then
   * stands there being shot. `visibilitychange` is handled too, for the mobile
   * browsers that fire it without a blur.
   *
   * Resuming is left to the player. Dropping someone straight back into a fight they
   * were not watching is how you lose a run to a phone call.
   */
  private watchFocus(): void {
    const pause = (): void => {
      if (this.state === 'playing' || this.state === 'hordePlaying') {
        this.pauseReturnState = this.state;
        this.state = 'pause';
      }
    };

    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) pause();
    });

    // Coming back after minutes away, the first delta would be that whole gap. It is
    // clamped anyway, but restarting the clock keeps the resumed frame honest.
    window.addEventListener('focus', () => {
      this.lastFrameMs = performance.now();
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---- run lifecycle -------------------------------------------------------

  /**
   * Everything a run needs reset before it, shared by the campaign and Horde: a
   * fresh RNG/tracker/skill pool, a fresh world and monster, every piece of
   * transient run state. What differs between the two starts *after* this —
   * `beginRun` goes on to pick a biome/map, `beginHordeRun` a single arena.
   */
  private resetRunState(seed: number, daily: boolean): void {
    this.ads.notifyGameplayStart();
    this.isDailyRun = daily;
    this.earnedTrials = [];
    this.runRng = new RNG(seed);
    this.tracker = new RunStats(seed);
    this.skillPool = new SkillPool(this.runRng.fork(), this.meta);

    this.world = new World(this.runRng.fork(), this.tracker, this.camera, this.sound);
    this.monster = new Monster(0, 0, this.meta.species);
    this.monster.syncMaxHp(true);
    this.monster.hp = this.monster.maxHp;
    this.world.monster = this.monster;
    this.world.contentGate = this.meta;
    this.soulsAtRunStart = 0;

    this.installWorldHooks();

    this.pendingCards = [];
    this.pendingMutations = [];
    this.cardsReturnState = null;
    this.cardAdRerollPending = false;
    this.cardAdRerollUsed = false;
    Object.assign(this.mapView, initMapViewState());
    this.hurtFlash = 0;
    this.controlsHintClearedAt = null;
    this.reviveAdUsed = false;
    this.reviveView.phase = 'offer';
    this.roomProgress = null;
    this.quitting = false;
  }

  /** The top level of every progression path: which mode this run is. */
  private get runMode(): 'campaign' | 'daily' | 'horde' {
    return this.hordeLevel !== null ? 'horde' : this.isDailyRun ? 'daily' : 'campaign';
  }

  /** Progression path of the run as a whole — `campaign`, or `horde › level3`. */
  private get runProgress(): string[] {
    return this.hordeLevel !== null ? ['horde', `level${this.hordeLevel}`] : [this.runMode];
  }

  private reportRunStart(): void {
    this.analytics.progression('start', this.runProgress);
    const where = this.hordeLevel !== null ? 'arena' : biomeTag(this.biome);
    this.analytics.design(['run', 'start', this.runMode, this.meta.speciesId, where]);
  }

  /**
   * Start a campaign run.
   *
   * Everything random in a run is forked from this one seed, so passing the daily
   * seed is all it takes to give every player the identical run — the map, the
   * settlements, the relics and the order cards come up in.
   */
  private beginRun(seed = (Math.random() * 0xffffffff) >>> 0, daily = false): void {
    this.resetRunState(seed, daily);
    this.hordeLevel = null;

    // A daily is compared against every other player on the same seed, so it
    // always starts at the true beginning regardless of a pending checkpoint.
    // Everything else resumes from wherever the last non-victorious run's third
    // room landed, same reasoning as the biome preference below: asking the
    // player to re-clear ground they already paid for in blood would be
    // friction, not a decision.
    if (!daily && this.meta.checkpointDepth > 0) {
      const startDepth = Math.min(this.meta.checkpointDepth, BIOME_ROOMS - 2);
      const base = (this.meta.checkpointBiome - 1) * BIOME_ROOMS + startDepth;
      this.generateBiome(this.meta.checkpointBiome, base, TOTAL_DEPTHS, startDepth);
      // A fresh level-1 body thrown at a room this deep would be fighting a
      // roster tuned for whatever the run had already grown into — replay the
      // build the checkpoint was taken with rather than just its depth.
      if (this.meta.checkpointBuild) this.applyCheckpointBuild(this.meta.checkpointBuild);
    } else if (this.meta.selectedStartBiome >= 2) {
      // Biomes reached in a past run are a standing preference, same as the
      // starting body — asking again before every hunt would be friction, not a
      // decision. Chosen directly rather than continued into, a later biome is
      // its own short run: a fresh difficulty ramp and its own ending, not the
      // back half of a longer one the player never played the front half of.
      this.generateBiome(this.meta.selectedStartBiome as 1 | 2 | 3, 0, BIOME_ROOMS);
    } else {
      // The first biome's map and every arena behind it come from the seed, so a
      // run is fully reproducible — including which branches were on offer.
      this.generateBiome(1, 0, TOTAL_DEPTHS);
    }
    this.reportRunStart();
  }

  /**
   * Generate one biome's map and pre-build every arena behind it.
   *
   * Called once at the start of a run, and again — without ending the run —
   * whenever the first biome's boss falls and the war-camp opens up, so the second
   * biome is exactly as reproducible from the seed as the first.
   *
   * `difficultyBase` is added to the biome's own node depths (which always start
   * at 0) for every difficulty curve and for `roomIndex`; `totalRunRooms` is this
   * run's whole length, for the HUD and for `generateRoom`'s pacing. Continuing
   * naturally into the war-camp passes `BIOME_ROOMS`/`TOTAL_DEPTHS` so the climb
   * started in the first biome keeps going; starting the war-camp directly from
   * the menu passes `0`/`BIOME_ROOMS` so it ramps up fresh, like a short run of
   * its own.
   *
   * `startDepth` shortens the generated map by that many layers when resuming
   * from a checkpoint — the player re-enters mid-climb, so there is that much
   * less of this biome left to walk. Zero (the default) generates the whole
   * thing, same as ever.
   */
  private generateBiome(biome: 1 | 2 | 3, difficultyBase: number, totalRunRooms: number, startDepth = 0): void {
    this.biome = biome;
    this.difficultyBase = difficultyBase;
    this.totalRunRooms = totalRunRooms;
    this.biomeStartDepth = startDepth;
    this.runMap = generateRunMap(BIOME_ROOMS - startDepth, this.runRng.fork());

    const planRng = this.runRng.fork();
    this.plansByNode = new Map();
    for (const node of this.runMap.nodes) {
      if (!isArenaNode(node.kind)) continue;
      const request = node.kind === 'boss' ? 'boss' : node.kind === 'elite' ? 'elite' : 'battle';
      this.plansByNode.set(
        node.id,
        generateRoom(difficultyBase + node.depth, planRng, request, biome),
      );
    }

    this.currentNodeId = null;
    this.visitedNodes.clear();
    this.roomIndex = difficultyBase;
    this.mapTime = 0;

    // The map opens as soon as it's ready: the very first stop is already a choice
    // of one, same as the run's own opening.
    this.state = 'map';
  }

  /**
   * Start a Horde run: one arena, a live wave spawner instead of a map, and no
   * portal — see `checkHordeProgress`/`enterArena`.
   */
  private beginHordeRun(level: number): void {
    this.resetRunState((Math.random() * 0xffffffff) >>> 0, false);
    this.hordeLevel = level;
    this.hordeElapsed = 0;
    this.hordeWaveNumber = 0;
    // Starts at the warning lead rather than zero: even the first wave gets a beat
    // of "brace yourself" instead of landing the instant the arena appears.
    this.hordeSpawnTimer = HORDE_WAVE_CONFIG.warningLeadSeconds;
    this.hordeWarning = false;
    this.hordeWarningElite = false;
    this.hordeTargetSeconds = HORDE_LEVELS.find((l) => l.level === level)?.targetSeconds ?? 0;

    const { plan, spawnPoints } = generateHordeArena(level, this.runRng.fork());
    this.hordeSpawnPoints = spawnPoints;
    this.enterArena(plan, Math.floor(hordeDifficultyTier(0, level)));
    this.state = 'hordePlaying';
    this.reportRunStart();
  }

  // ---- map navigation ------------------------------------------------------

  /** The arena plan for wherever the player currently is, if it is a fight. */
  private get currentPlan(): RoomPlan | null {
    return this.activePlan;
  }

  /**
   * Move to a stop and open whatever it is.
   *
   * Fights load an arena; the market and the altar are pure screens with no world,
   * so the player returns to the map straight afterwards.
   */
  private enterNode(nodeId: number): void {
    const node = this.runMap.nodes[nodeId];
    if (!node) return;

    this.currentNodeId = nodeId;
    this.visitedNodes.add(nodeId);
    this.roomIndex = this.difficultyBase + node.depth;

    switch (node.kind) {
      case 'battle':
      case 'elite':
      case 'boss':
        this.loadRoom(nodeId);
        this.state = 'playing';
        this.roomProgress = [this.runMode, biomeTag(this.biome), roomTag(node.depth + this.biomeStartDepth)];
        this.analytics.progression('start', this.roomProgress);
        break;

      case 'market':
        this.openMarket();
        break;

      case 'cursed':
        this.openCursedAltar();
        break;
    }
  }

  /**
   * Back to the map after a stop is done — or, after a boss, onward. The first
   * biome's boss opens a gate into the war-camp instead of ending the run; every
   * other boss (the war-camp's, whether reached naturally or started there
   * directly) actually finishes it.
   */
  private returnToMap(): void {
    const node = this.currentNodeId !== null ? this.runMap.nodes[this.currentNodeId] : null;

    // Every third room cleared becomes the checkpoint the next run resumes
    // from if this one doesn't end in victory. Market and altar stops don't
    // move `roomsCleared`, so passing through one between fights can't
    // re-trigger this on a room already checkpointed.
    if (node && this.tracker.roomsCleared > 0 && this.tracker.roomsCleared % 3 === 0) {
      this.meta.recordCheckpoint(this.biome, node.depth + this.biomeStartDepth, this.snapshotBuild());
    }

    if (node && node.kind === 'boss') {
      if (this.biome === 1) {
        // Permanent the instant the boss falls, independent of how the run
        // subsequently ends — dying partway through the war-camp must not cost
        // the player the unlock they just earned reaching it.
        this.meta.recordBiomeReached(2);
        this.sound.victory();
        this.generateBiome(2, BIOME_ROOMS, TOTAL_DEPTHS);
        return;
      }
      if (this.biome === 2) {
        // Same reasoning one act later: the Cathedral opens up regardless of
        // how this run's climb through it goes.
        this.meta.recordBiomeReached(3);
        this.sound.victory();
        this.generateBiome(3, BIOME_ROOMS * 2, TOTAL_DEPTHS);
        return;
      }
      this.tracker.outcome = 'victory';
      this.sound.victory();
      // The run is won — the next hunt starts from the top, not from a
      // checkpoint that belonged to the climb that just finished.
      this.meta.clearCheckpoint();
      this.finishRun();
      return;
    }
    this.state = 'map';
  }

  /** What `recordCheckpoint` freezes the character as, for `applyCheckpointBuild` to replay. */
  private snapshotBuild(): CheckpointBuild {
    return {
      level: this.monster.level,
      xpIntoLevel: this.monster.xpIntoLevel,
      souls: this.monster.souls,
      skills: this.skillPool.takenList.map((s) => ({ id: s.card.id, stacks: s.stacks })),
      mutationIds: [...this.monster.mutations],
      curseIds: [...this.monster.curses],
    };
  }

  /**
   * Replays a checkpointed build onto the freshly-constructed monster a
   * resumed run starts with. Mutations and curses go through their normal
   * apply paths (a burst of particles/sound on a run's very first frame reads
   * as a fitting "here's what you had" flourish, not a bug); skills are
   * re-acquired stack by stack so `SkillPool`'s own bookkeeping — max-stack
   * limits, what a future draft should avoid repeating — stays correct.
   */
  private applyCheckpointBuild(build: CheckpointBuild): void {
    const monster = this.monster;
    monster.level = build.level;
    monster.xpIntoLevel = build.xpIntoLevel;
    monster.souls = build.souls;

    for (const id of build.mutationIds) {
      const mutation = getMutation(id);
      if (mutation) monster.applyMutation(mutation, this.world);
    }
    for (const id of build.curseIds) {
      const curse = getCurse(id);
      if (!curse) continue;
      applyCurse(curse, monster.stats);
      monster.curses.add(id);
    }
    for (const { id, stacks } of build.skills) {
      const card = getCard(id);
      if (!card) continue;
      for (let i = 0; i < stacks; i++) this.skillPool.acquire(card, monster.stats);
    }

    monster.syncMaxHp(true);
    monster.hp = monster.maxHp;
  }

  private installWorldHooks(): void {
    const world = this.world;

    world.spawnHuman = (id, x, y, tier) => {
      const human = new Human(id, x, y, tier);
      human.alert();
      world.humans.push(human);
    };

    world.onBuildingBreached = (building, occupants) => {
      this.monster.noteBuildingRazed();

      // Survivors spill out of the wreckage in a panic.
      for (let i = 0; i < occupants; i++) {
        const angle = world.rng.next() * TAU;
        const radius = Math.max(building.rect.w, building.rect.h) * 0.55;
        const human = new Human(
          'peasant',
          building.x + Math.cos(angle) * radius,
          building.y + Math.sin(angle) * radius,
          this.roomIndex,
        );
        human.alert();
        human.witnessDeath(1);
        world.humans.push(human);
      }
      // Newcomers count toward the room's total so the progress bar stays honest.
      this.humansAtRoomStart += occupants;
    };

    world.onHumanKilled = (human, ctx) => {
      this.applyOnKillEffects(human, ctx.sourceLabel);
    };
  }

  private applyOnKillEffects(human: Human, sourceLabel: string): void {
    const stats = this.monster.stats;
    const world = this.world;
    const areaSize = stats.get('areaSize');

    if (stats.has('explodeOnKill')) {
      const cfg = ON_KILL_EFFECTS.explodeOnKill;
      const power = stats.get('damage') * (cfg.baseFraction + cfg.perStackFraction * stats.count('explodeOnKill'));
      world.explode(
        human.x,
        human.y,
        cfg.radius * areaSize,
        [{ type: 'physical', amount: power * stats.damageMultiplierFor('physical') }],
        t('skill.flesh-burst.name'),
        { color: '#c0343c', knockback: cfg.knockback },
      );
    }

    if (stats.has('poisonCloud')) {
      const cfg = ON_KILL_EFFECTS.poisonCloud;
      world.addGroundHazard({
        x: human.x,
        y: human.y,
        radius: cfg.radius * areaSize,
        life: cfg.life,
        dps: stats.get('damage') * cfg.dpsFraction * stats.damageMultiplierFor('poison'),
        type: 'poison',
        color: '#8ed44f',
        sourceLabel: t('effect.plagueCloud'),
        status: {
          id: 'poison',
          duration: cfg.statusDuration,
          stacks: cfg.statusStacks,
          power: stats.get('damage') * cfg.statusPowerFraction,
          sourceLabel: t('effect.plagueCloud'),
        },
      });
    }

    if (stats.has('fearOnKill')) {
      const cfg = ON_KILL_EFFECTS.fearOnKill;
      const nearby = world.acquireHumanBuffer();
      world.humansInRadiusInto(human.x, human.y, cfg.radius * areaSize, nearby);
      for (const other of nearby) {
        if (other.archetype.role === 'boss') continue;
        other.statuses.apply({ id: 'fear', duration: cfg.duration, sourceLabel: t('skill.dread-roar.name') });
      }
      world.releaseHumanBuffer(nearby);
    }

    if (stats.has('deathBlossom')) {
      const cfg = ON_KILL_EFFECTS.deathBlossom;
      const crit = false;
      const { packets, statuses } = this.monster.buildAttack(crit);
      const scaled = packets.map((p) => ({ type: p.type, amount: p.amount * cfg.damageFraction }));

      for (let i = 0; i < cfg.shards; i++) {
        const angle = (i / cfg.shards) * TAU;
        world.spawnProjectile({
          x: human.x,
          y: human.y,
          angle,
          speed: cfg.speed,
          packets: scaled,
          faction: 'monster',
          sourceLabel: t('skill.death-blossom.name'),
          radius: cfg.projectileRadius,
          range: cfg.range,
          color: this.monster.body.glowColor,
          glow: '#ffffff',
          shape: 'shard',
          statuses,
          owner: this.monster,
          trail: false,
        });
      }
    }

    if (stats.has('devourCorpses')) {
      world.spawnPickup('blood', human.x, human.y, ON_KILL_EFFECTS.devourCorpses.baseAmount + this.roomIndex);
    }

    void sourceLabel;
  }

  private loadRoom(nodeId: number): void {
    const plan = this.plansByNode.get(nodeId);
    if (!plan) return;
    const index = this.difficultyBase + this.runMap.nodes[nodeId]!.depth;
    this.enterArena(plan, index);
  }

  /**
   * Turns a `RoomPlan` into a live arena: world reset, buildings instanced,
   * garrison spawned, monster placed. Shared by the campaign's `loadRoom` (which
   * looks its plan up from `plansByNode`) and Horde's `beginHordeRun` (which
   * generates one on the spot) — everything past "I have a plan and an index" is
   * identical between the two.
   */
  private enterArena(plan: RoomPlan, index: number): void {
    this.roomIndex = index;
    this.activePlan = plan;

    this.world.reset(plan.bounds, plan.wallThickness);
    this.renderer.terrain.build(plan);

    for (const planned of plan.buildings) {
      this.world.buildings.push(
        new Building(planned.kind, planned.rect, this.world.rng, 1 + index * BUILDING_HP_SCALE_PER_ROOM_INDEX),
      );
    }
    this.world.markSolidsDirty();

    this.spawnHumans(plan.spawns, index, false);

    for (const relic of plan.relics) {
      this.world.spawnBoon(relic.x, relic.y);
    }

    this.monster.x = plan.monsterStart.x;
    this.monster.y = plan.monsterStart.y;
    this.monster.vx = 0;
    this.monster.vy = 0;
    this.monster.statuses.clear();
    this.monster.onRoomStart(this.world);
    this.lastHp = this.monster.hp;

    this.camera.snapTo(this.monster.x, this.monster.y);
    this.humansAtRoomStart = this.world.humans.length;
    this.exitReady = false;
    this.reinforcementsSpawned = false;
    this.stallTimer = 0;
    this.stallDamageMark = this.tracker.totalDamageDealt;
    this.stallKillMark = this.tracker.totalKills;
    this.roomIntroTimer = ROOM_INTRO_DURATION;

    this.tracker.beginRoom(index, plan.name);
    if (plan.isBoss) this.sound.bossSpawn(this.monster);
  }

  /**
   * Build `Human`s from a planned spawn list and drop them into the world.
   *
   * Shared by the room's initial garrison and a reinforcement wave arriving
   * mid-fight — `alertNow` is the only real difference: the initial wave still
   * relies on each unit's own `alertDelay`/proximity to notice the monster, while
   * reinforcements already know exactly where the fight is the moment they arrive
   * (same convention `world.spawnHuman` uses for a building-breach spawn).
   */
  private spawnHumans(spawns: readonly PlannedSpawn[], tier: number, alertNow: boolean): void {
    for (const spawn of spawns) {
      const human = new Human(spawn.id, spawn.x, spawn.y, tier);
      // Turrets built with `mountedBuildingIndex` (roomgen.ts) are shielded by that
      // tower until it falls — `world.buildings` is filled in the same order as
      // `plan.buildings`, so the index still lines up here.
      if (spawn.mountedBuildingIndex !== undefined) {
        human.mountedOn = this.world.buildings[spawn.mountedBuildingIndex] ?? null;
      }
      if (alertNow) human.alert();
      this.world.humans.push(human);
    }
  }

  private completeRoom(): void {
    this.tracker.endRoom(this.monster.healthFraction);
    if (this.roomProgress) {
      // Score is the health left, in percent: a room everyone clears on 5% is a wall,
      // one they clear on 95% is filler — the pass rate alone can't tell those apart.
      this.analytics.progression('complete', this.roomProgress, Math.round(this.monster.healthFraction * 100));
      this.roomProgress = null;
    }

    // Skill cards come from levelling, which the player spends whenever they like.
    // Depth only gates evolution, which is a bigger, rarer decision.
    if (isEvolutionRoom(this.roomIndex)) {
      this.pendingMutations = drawMutations(
        this.runRng,
        this.monster.mutations,
        this.monster.stats,
        3,
        this.meta,
      );
      if (this.pendingMutations.length > 0) {
        this.state = 'mutation';
        return;
      }
    }

    this.returnToMap();
  }

  // ---- market --------------------------------------------------------------

  /**
   * Stock the den.
   *
   * Prices climb with depth so souls keep their value late, and the cure only
   * appears when there is something to cure — an offer you can never use is just
   * noise on the screen.
   */
  private openMarket(): void {
    const depth = this.roomIndex;
    const offers: MarketOffer[] = [
      { kind: 'card', price: Math.round(28 + depth * 7), amount: 0, sold: false },
      { kind: 'heal', price: Math.round(18 + depth * 5), amount: 40, sold: false },
      { kind: 'maxHp', price: Math.round(24 + depth * 6), amount: 25, sold: false },
    ];

    if (this.monster.curses.size > 0) {
      offers.push({ kind: 'cure', price: Math.round(40 + depth * 9), amount: 0, sold: false });
    }

    this.marketOffers = offers;
    this.state = 'market';
  }

  private buyOffer(index: number): void {
    const offer = this.marketOffers[index];
    if (!offer || offer.sold || this.monster.souls < offer.price) return;

    this.monster.souls -= offer.price;
    offer.sold = true;
    this.analytics.design(['market', 'buy', offer.kind], offer.price);
    this.sound.cardPick();

    switch (offer.kind) {
      case 'card':
        // Nested draft: remember to come back here rather than to the arena.
        this.cardsReturnState = 'market';
        this.cardAdRerollUsed = false;
        if (!this.openCardDraft()) this.cardsReturnState = null;
        break;

      case 'heal':
        this.monster.heal(
          this.monster.maxHp * (offer.amount / 100),
          this.world,
          t('offer.heal.name'),
        );
        break;

      case 'maxHp':
        this.monster.stats.addModifier({
          key: 'maxHp',
          flat: offer.amount,
          source: t('offer.maxHp.name'),
        });
        this.monster.syncMaxHp(true);
        break;

      case 'cure': {
        // Lift the first curse taken; they are all equally permanent otherwise.
        const id = [...this.monster.curses][0];
        if (id) {
          const curse = getCurse(id);
          if (curse) this.monster.stats.removeBySource(curseName(curse));
          this.monster.curses.delete(id);
          this.monster.syncMaxHp(false);
        }
        break;
      }
    }
  }

  // ---- cursed altar --------------------------------------------------------

  /**
   * Offer two bargains.
   *
   * The cards are drawn from the high end of the pool — a curse is only a real
   * decision if what it buys could change the run.
   */
  private openCursedAltar(): void {
    const cards = this.skillPool.draw(
      2,
      { taken: new Map(), stats: this.monster.stats, depth: this.roomIndex + 6 },
      1.2,
      'rare',
    );
    const curses = rollCurses(this.runRng, this.monster.curses, cards.length);

    this.cursedOffers = cards.map((card, i) => ({ card, curse: curses[i]! }));
    // Nothing left to offer: don't strand the player on an empty altar.
    if (this.cursedOffers.length === 0) {
      this.returnToMap();
      return;
    }
    this.state = 'cursed';
  }

  private takeCursedOffer(index: number): void {
    const offer = this.cursedOffers[index];
    if (!offer) return;

    this.skillPool.acquire(offer.card, this.monster.stats);
    this.tracker.recordSkill(offer.card.id, offer.card.name, offer.card.rarity);
    this.analytics.design(['card', 'pick', 'cursed', offer.card.id]);
    this.analytics.design(['curse', 'take', offer.curse.id]);

    applyCurse(offer.curse, this.monster.stats);
    this.monster.curses.add(offer.curse.id);
    this.tracker.recordCurse(offer.curse.id, curseName(offer.curse));
    // Curses that cut max HP must not kill: keep the health ratio.
    this.monster.syncMaxHp(false);

    this.sound.mutation();
    this.cursedOffers = [];
    this.returnToMap();
  }

  /**
   * Show three cards. Used both by levelling and by the market, which sells a draft.
   * Returns false when the pool has nothing left to offer.
   */
  private openCardDraft(): boolean {
    this.pendingCards = this.skillPool.draw(3, {
      taken: new Map(),
      stats: this.monster.stats,
      depth: this.roomIndex,
    });

    if (this.pendingCards.length === 0) return false;
    this.state = 'cards';
    return true;
  }

  /** Open the draft against one banked level. Returns false if none is due. */
  private offerCards(): boolean {
    if (this.monster.pendingLevels <= 0) return false;

    if (!this.openCardDraft()) {
      // Pool exhausted: don't strand the player holding an unspendable level.
      this.monster.pendingLevels = 0;
      return false;
    }
    return true;
  }

  private finishRun(): void {
    this.ads.notifyGameplayStop();
    const earned = Math.floor(this.monster.soulsThisRun);
    this.soulsAtRunStart = earned;
    // Permanent the instant the run is scored, regardless of which of the several
    // places a Horde run can end landed it here — death, a declined revive, or
    // reaching the target duration (the only place `outcome` is actually set to
    // 'victory' for Horde; see `checkHordeProgress`).
    if (this.hordeLevel !== null) {
      this.meta.recordHordeResult(this.hordeLevel, this.tracker.outcome === 'victory');
    }
    this.earnedTrials = this.meta.recordRun(this.tracker, earned, { daily: this.isDailyRun });
    this.reportRunEnd(earned);
    this.resultsView.scroll = 0;
    this.state = 'results';
  }

  /**
   * Everything a finished run tells analytics. One place, because a run can end from
   * half a dozen call sites (death, declined revive, retreat from pause or the map,
   * Horde's clock) and every one of them funnels through `finishRun`.
   */
  private reportRunEnd(soulsEarned: number): void {
    const a = this.analytics;
    const outcome = this.quitting ? 'quit' : this.tracker.outcome === 'victory' ? 'victory' : 'death';
    const status = outcome === 'victory' ? 'complete' : 'fail';

    if (this.roomProgress) {
      a.progression('fail', this.roomProgress);
      this.roomProgress = null;
    }
    // Score: rooms cleared for the campaign, seconds survived for Horde — the one
    // number that says how far this attempt got.
    const score = this.hordeLevel !== null ? Math.floor(this.hordeElapsed) : this.tracker.roomsCleared;
    a.progression(status, this.runProgress, score);
    a.design(['run', 'end', this.runMode, outcome], Math.round(this.tracker.elapsed));
    if (outcome === 'death') a.design(['run', 'killer', this.runMode, this.tracker.killerId || 'unknown']);
    if (this.hordeLevel !== null) a.design(['horde', 'wave', `level${this.hordeLevel}`], this.hordeWaveNumber);
    a.resource('source', 'souls', soulsEarned, 'run', this.runMode);
    for (const trial of this.earnedTrials) a.design(['trial', trial.id]);
    // Real players' hardware, which is the thing the two dev machines can't show.
    a.design(['perf', 'frame_ms', this.touchActive() ? 'touch' : 'desktop'], Math.round(this.frameCostMs * 10) / 10);
  }

  /**
   * Called once the ad promise settles — anywhere from a second to however long a
   * real network's video runs.
   *
   * Guarded on the state still being 'revive': the frame-error fallback in
   * `recoverFromFrameError` can have bounced the player back to the menu, or they may
   * already be mid-way into a new run, by the time this fires. Reviving a monster
   * that no longer belongs to the run in progress would be a bug no player action
   * caused.
   */
  private resolveRevive(result: AdResult): void {
    if (this.state !== 'revive') return;

    this.reportAdResult(result, 'revive');
    if (result === 'completed') {
      this.reviveAdUsed = true;
      this.monster.revive(this.world, 0.5, t('effect.adRevive'), () => this.sound.secondWind());
      this.state = this.hordeLevel !== null ? 'hordePlaying' : 'playing';
    } else {
      this.finishRun();
    }
  }

  // ---- frame ---------------------------------------------------------------

  /**
   * One frame.
   *
   * The body is wrapped because the call that schedules the *next* frame is the last
   * thing here: an exception escaping `update()` or `draw()` used to mean no frame was
   * ever scheduled again, and the game hung permanently on a single bad number. It has
   * happened for real — `roundRect` with a negative radius on a narrow viewport. A
   * dropped frame is a glitch; a dropped `requestAnimationFrame` is the end of the
   * session, so the two must not share a fate.
   */
  private frame = (nowMs: number): void => {
    const rawDelta = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    // Clamp so an alt-tab doesn't fast-forward the simulation.
    const delta = Math.min(0.25, rawDelta) * this.cinema.timeScale;

    const started = performance.now();

    try {
      this.applySettings();
      this.renderer.syncCamera(this.camera);
      // Only the arena turns a touch into a stick and buttons; every other screen
      // needs a touch to keep behaving like a click, or none of the existing menus
      // would work on glass at all.
      this.input.setTouchContext(
        this.meta.settings.touchControls !== 'off',
        this.state === 'playing' || this.state === 'hordePlaying' ? 'play' : 'ui',
      );

      // One reading of the notch per frame, handed to both the half that hit-tests
      // touches and the half that draws what they hit. Splitting that would be the
      // same bug as a touch button drawn somewhere other than where it is tested.
      const safe = this.renderer.safe;
      this.input.setSafeArea(safe, this.renderer.viewScale);
      this.ui.frame(this.input, this.renderer.safeWidth, this.renderer.safeHeight, {
        x: -safe.left,
        y: -safe.top,
        w: this.renderer.width,
        h: this.renderer.height,
      });

      this.update(delta);
      this.draw(delta);
      this.consecutiveFrameErrors = 0;

      // Exponential smoothing: a raw per-frame number flickers too fast to read, and
      // the point of showing it is to notice a trend, not to catch one bad frame.
      const cost = performance.now() - started;
      this.frameCostMs = this.frameCostMs === 0 ? cost : this.frameCostMs * 0.9 + cost * 0.1;
    } catch (error) {
      this.recoverFromFrameError(error);
    } finally {
      // Both in `finally`: input must not stay latched on a frame that threw, and the
      // next frame has to be scheduled even if recovery itself goes wrong.
      this.input.endFrame();
      requestAnimationFrame(this.frame);
    }
  };

  /**
   * Put the canvas back in a usable state after a frame threw.
   *
   * Unwinding the context stack is the part that matters. `begin()` resets the
   * transform every frame, but a `clip()` left behind by a throw between `save()` and
   * `restore()` survives it, and every later frame would draw into that clip — the
   * screen goes mostly blank with no error to explain it. Restoring past the bottom of
   * the stack is defined as a no-op, so unwinding blind is safe.
   */
  private recoverFromFrameError(error: unknown): void {
    const ctx = this.renderer.ctx;
    for (let i = 0; i < 32; i++) ctx.restore();

    this.consecutiveFrameErrors++;
    this.frameErrors++;

    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    // Log the first of each distinct failure. A fault that repeats every frame would
    // otherwise bury the console — and itself — under thousands of identical lines.
    if (message !== this.lastFrameError) {
      this.lastFrameError = message;
      console.error(`[samarkand] frame failed (${this.frameErrors} total):`, error);
      this.analytics.error(message);
    }

    // Still failing a second later: whatever is broken is broken every frame, and the
    // player is looking at a frozen picture. The menu draws almost none of the code
    // that a run does, so backing out to it is the best chance of staying playable.
    if (this.consecutiveFrameErrors === BROKEN_FRAME_LIMIT && this.state !== 'menu') {
      console.error('[samarkand] too many failed frames in a row — returning to the menu');
      this.state = 'menu';
    }
  }

  private update(delta: number): void {
    switch (this.state) {
      case 'menu':
      case 'lifetime':
      case 'lair':
      case 'trials':
      case 'settings':
      case 'hordeMenu':
        this.menuTime += delta;
        return;

      case 'playing':
      case 'hordePlaying':
        this.updatePlaying(delta);
        return;

      case 'map':
      case 'market':
      case 'cursed':
        if (this.input.consumePress('pause')) {
          this.pauseReturnState = this.state;
          this.state = 'pause';
          return;
        }
        // Between-stop screens have no world behind them; only their own clock runs.
        this.mapTime += delta;
        this.ambience.update(0.05, 0);
        return;

      case 'cards':
      case 'mutation':
      case 'pause':
      case 'results':
        // Modal states still animate the camera so the frozen world doesn't jitter.
        this.camera.update(delta);
        return;

      case 'revive':
        this.camera.update(delta);
        this.reviveElapsed += delta;
        return;
    }
  }

  /** Shared by `'playing'` and `'hordePlaying'` — both just step the simulation. */
  private updatePlaying(delta: number): void {
    if (this.input.wasPressed('stats')) this.showBuildSheet = !this.showBuildSheet;
    // Claimed, or the pause screen drawn later this same frame would read the very
    // same press and resume immediately.
    if (this.input.consumePress('pause')) {
      this.pauseReturnState = this.state;
      this.state = 'pause';
      return;
    }

    // Captured up front: `step()` can change `this.state` itself (death, a level
    // banked mid-fight), and the loop must stop the instant it does either way.
    const activeState = this.state;
    this.accumulator += delta;
    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_STEP;
      steps++;
      this.step(FIXED_STEP);
      if (this.state !== activeState) break;
    }

    // If we fell too far behind, drop the backlog rather than spiral.
    if (this.accumulator > FIXED_STEP * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.camera.update(delta);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - delta * 2.2);
    if (this.roomIntroTimer > 0) this.roomIntroTimer -= delta;
    this.updateAudio(delta);
  }

  /**
   * Keep the mix following the fight.
   *
   * Tension rises with how much of the settlement is still standing against you and
   * with recent damage taken; danger is purely how close to death you are, and it
   * drives the heartbeat layer.
   */
  private updateAudio(delta: number): void {
    this.audio.setListener(this.camera.x, this.camera.y);

    this.heat = Math.max(0, this.heat - delta * 0.5);

    const alive = this.world.livingHumans;
    const crowd = Math.min(1, alive / 8);
    const tension = this.exitReady ? 0.05 : Math.min(1, crowd * 0.8 + this.heat * 0.4);
    const danger = this.monster.alive ? Math.max(0, 1 - this.monster.healthFraction / 0.35) : 0;
    const boss = !this.exitReady && this.bossAlive;

    this.ambience.update(tension, danger, boss);
  }

  /** One fixed simulation tick. */
  private step(dt: number): void {
    const world = this.world;

    // Hit-stop freezes the simulation for a few frames on heavy hits.
    const simDt = this.camera.consumeHitStop(dt);
    if (simDt <= 0) return;

    if (this.cinema.immortal && this.monster.alive) this.monster.hp = this.monster.maxHp;

    world.time += simDt;
    this.tracker.tick(simDt);
    if (
      this.controlsHintClearedAt === null &&
      this.roomIndex === 0 &&
      this.tracker.distanceTravelled > 60 &&
      this.tracker.hitsLanded > 0
    ) {
      this.controlsHintClearedAt = this.tracker.elapsed;
    }
    world.rebuildGrid();

    this.monster.handleInput(this.input, world, simDt);
    this.monster.update(simDt, world);

    for (const human of world.humans) {
      if (human.alive) human.update(simDt, world);
    }
    for (const projectile of world.projectiles) {
      if (projectile.alive) projectile.update(simDt, world);
    }
    for (const building of world.buildings) {
      building.update(simDt, world);
    }
    for (const pickup of world.pickups) {
      if (pickup.alive) pickup.update(simDt, world);
    }

    world.updateEffects(simDt);
    world.cull();

    this.camera.follow(this.monster, this.monster.vx, this.monster.vy, simDt);

    // Damage feedback.
    if (this.monster.hp < this.lastHp) {
      const share = (this.lastHp - this.monster.hp) / this.monster.maxHp;
      this.hurtFlash = Math.min(1, this.hurtFlash + share * 3);
      this.heat = Math.min(1, this.heat + share * 2.5);
    }
    this.lastHp = this.monster.hp;

    if (!this.monster.alive) {
      if (!this.reviveAdUsed && this.ads.isRewardedAdAvailable()) {
        this.reviveView.phase = 'offer';
        this.reviveElapsed = 0;
        this.state = 'revive';
        return;
      }
      this.finishRun();
      return;
    }

    if (!this.exitReady && this.checkStalledRoom(simDt)) {
      for (const human of world.humans) human.alive = false;
      // The guard exists to end a broken room, not open a fresh one.
      this.reinforcementsSpawned = true;
    }

    // Cached once per simulation step rather than rescanned every render frame in
    // `updateAudio` — boss presence only ever changes here (spawn/death/stall-kill),
    // never between one fixed step and the next.
    this.bossAlive = world.humans.some((h) => h.alive && h.archetype.role === 'boss');

    if (this.hordeLevel !== null) this.checkHordeProgress(simDt);
    else this.checkRoomProgress();
  }

  /**
   * Anti-softlock guard.
   *
   * A settlement must always be completable. Generation tries hard to guarantee it
   * — turrets get open ground, defenders charge out of stalemates — but any future
   * unit or layout could still strand a survivor somewhere neither side can reach.
   * If nothing at all has happened for a long stretch, the room is declared won
   * rather than trapping the player forever.
   */
  private checkStalledRoom(dt: number): boolean {
    const progressed =
      this.tracker.totalDamageDealt !== this.stallDamageMark ||
      this.tracker.totalKills !== this.stallKillMark;

    if (progressed) {
      this.stallDamageMark = this.tracker.totalDamageDealt;
      this.stallKillMark = this.tracker.totalKills;
      this.stallTimer = 0;
      return false;
    }

    this.stallTimer += dt;
    return this.stallTimer > STALL_TIMEOUT;
  }

  private checkRoomProgress(): void {
    const world = this.world;

    if (!this.exitReady) {
      if (world.livingHumans > 0) return;

      const plan = this.currentPlan;
      if (plan && !this.reinforcementsSpawned && plan.reinforcements.length > 0) {
        this.reinforcementsSpawned = true;
        this.spawnHumans(plan.reinforcements, this.roomIndex, true);
        world.camera.shake(6);
        // "This one is different" horn — exactly the read a second wave needs.
        this.sound.bossSpawn(this.monster);
        world.texts.add(
          this.monster.x,
          this.monster.y - 60,
          t('text.reinforcementsArrived'),
          '#c0343c',
          22,
          1,
        );
        return;
      }

      this.exitReady = true;
      world.cleared = true;
      world.camera.shake(4);
      this.sound.roomCleared();

      // Sweep the battlefield: every soul still lying around comes to you. Souls
      // are experience now, so losing track of them would silently cost levels.
      for (const pickup of world.pickups) pickup.forceAttract();

      world.texts.add(
        this.monster.x,
        this.monster.y - 60,
        t('text.settlementFallen'),
        '#d8a13a',
        22,
        1,
      );
      return;
    }

    const plan = this.currentPlan;
    if (!plan) return;
    const exit = plan.exit;
    const distance = Math.hypot(this.monster.x - exit.x, this.monster.y - exit.y);
    if (distance < 46) {
      this.sound.portal(this.monster);
      // Levels banked during the fight are spent here, at the door out — not mid-fight.
      if (this.offerCards()) return;
      this.completeRoom();
    }
  }

  /**
   * Horde's win condition: there is no portal to walk to, only the clock. Waves
   * land on a timer and levelling can't wait for a door that doesn't exist, so a
   * banked level is drafted the instant it's earned — `state === 'cards'` already
   * freezes the whole simulation (see `update()`'s switch), which pauses the wave
   * clock and spawn timer along with everything else for free.
   */
  private checkHordeProgress(dt: number): void {
    const level = this.hordeLevel;
    if (level === null) return;

    this.hordeElapsed += dt;
    const tier = hordeDifficultyTier(this.hordeElapsed, level);
    this.roomIndex = Math.floor(tier);

    this.hordeSpawnTimer -= dt;
    // A beat of warning before a wave actually lands — it can now arrive from any
    // edge of the arena, so a pulse on the HUD counter (see `drawHud`) plus the
    // horn/shake on actual arrival below are what keep that fair.
    if (!this.hordeWarning && this.hordeSpawnTimer <= HORDE_WAVE_CONFIG.warningLeadSeconds) {
      this.hordeWarning = true;
      this.hordeWarningElite = isEliteWave(this.hordeWaveNumber);
    }
    if (this.hordeSpawnTimer <= 0) {
      this.hordeSpawnTimer += HORDE_WAVE_CONFIG.spawnIntervalSeconds;
      this.hordeWarning = false;
      const elite = this.hordeWarningElite;
      this.hordeWarningElite = false;
      const spawns = rollHordeWave(this.hordeElapsed, this.hordeWaveNumber, level, this.hordeSpawnPoints, this.runRng);
      this.hordeWaveNumber++;
      this.spawnHumans(spawns, tier, true);
      this.camera.shake(elite ? 9 : 5);
      // Same "this one is different" horn the campaign's reinforcement wave uses —
      // exactly the read a fresh wave needs here too.
      this.sound.bossSpawn(this.monster);
    }

    if (this.monster.pendingLevels > 0) {
      this.offerCards();
      return;
    }

    if (this.hordeElapsed >= this.hordeTargetSeconds) {
      this.tracker.outcome = 'victory';
      this.finishRun();
    }
  }

  // ---- draw ----------------------------------------------------------------

  private draw(delta: number): void {
    this.renderer.begin();
    this.drawFrame(delta);
    if (this.meta.settings.showFrameCost) this.drawFrameCost();
  }

  /**
   * Frame cost in the corner.
   *
   * Drawn after everything else and never over the middle of the screen: a diagnostic
   * that covers the thing being diagnosed is worse than none.
   */
  private drawFrameCost(): void {
    const budget = 1000 / 60;
    const over = this.frameCostMs > budget;
    this.ui.text(`${this.frameCostMs.toFixed(1)} ms`, this.ui.width - 12, 12, {
      size: 11,
      color: over ? PALETTE.bad : PALETTE.dim,
      align: 'right',
      baseline: 'top',
    });
  }

  private drawFrame(delta: number): void {

    if (this.state === 'menu' && this.needsConsent) {
      drawMenuBackdrop(this.ui, this.menuTime);
      const answer = drawConsent(this.ui);
      if (answer !== 'none') {
        this.meta.settings.analytics = answer === 'allow';
        this.meta.settings.analyticsAsked = true;
        this.meta.save();
      }
      this.applyCursor();
      return;
    }

    if (this.state === 'menu') {
      // The menu widget edits the profile directly; push the result into the mix.
      this.audio.setVolume(this.meta.volume);
      this.audio.setMuted(this.meta.muted);
      this.ambience.quiet();

      const action = drawMainMenu(this.ui, this.meta, this.menuTime, this.touchActive());
      if (action === 'start') this.beginRun();
      if (action === 'daily') this.beginRun(dailySeed(), true);
      if (action === 'horde') this.state = 'hordeMenu';
      if (action === 'stats') this.state = 'lifetime';
      if (action === 'lair') this.state = 'lair';
      if (action === 'trials') this.state = 'trials';
      if (action === 'settings') {
        this.settingsReturnState = 'menu';
        this.state = 'settings';
      }
      this.applyCursor();
      return;
    }

    if (this.state === 'lair') {
      drawMenuBackdrop(this.ui, this.menuTime);
      if (drawLair(this.ui, this.input, this.meta, this.lairView, this.menuTime) === 'back') this.state = 'menu';
      this.applyCursor();
      return;
    }

    if (this.state === 'hordeMenu') {
      drawMenuBackdrop(this.ui, this.menuTime);
      const result = drawHordeMenu(this.ui, this.input, this.meta, this.hordeMenuView);
      if (result.back) this.state = 'menu';
      if (result.play >= 1) this.beginHordeRun(result.play);
      this.applyCursor();
      return;
    }

    if (this.state === 'settings') {
      // Over a frozen arena when opened mid-run, over the title backdrop otherwise —
      // so pausing to change a setting never hides where you were.
      if (this.settingsReturnState === 'menu') {
        drawMenuBackdrop(this.ui, this.menuTime);
      } else {
        const behind = this.currentPlan;
        if (behind) this.renderer.drawWorld(this.world, this.camera, behind.exit, this.exitReady);
      }

      if (drawSettings(this.ui, this.input, this.meta, this.settingsView) === 'back') {
        this.state = this.settingsReturnState;
      }
      this.applyCursor();
      return;
    }

    if (this.state === 'trials') {
      drawMenuBackdrop(this.ui, this.menuTime);
      if (drawAchievements(this.ui, this.input, this.meta, this.trialsView) === 'back') {
        this.state = 'menu';
      }
      this.applyCursor();
      return;
    }

    if (this.state === 'lifetime') {
      drawMenuBackdrop(this.ui, this.menuTime);
      const action = drawLifetime(this.ui, this.meta);
      if (action === 'back') this.state = 'menu';
      if (action === 'reset') {
        this.meta.reset();
        this.state = 'menu';
      }
      this.applyCursor();
      return;
    }

    // Between-stop screens stand alone: there is no arena behind them, and before
    // the first fight there is no world to draw at all.
    if (this.state === 'map' || this.state === 'market' || this.state === 'cursed') {
      this.drawBetweenStops();
      if (!this.cinema.hideHud) this.drawPauseIcon();
      this.applyCursor();
      return;
    }

    // The arena and its HUD are drawn only when the current stop actually has one.
    // A card draft can be opened from the market, where there is no world at all —
    // the modal screens below must still run in that case.
    const plan = this.currentPlan;
    if (plan) {
      this.renderer.drawWorld(this.world, this.camera, plan.exit, this.exitReady);

      const boss = this.world.humans.find((h) => h.alive && h.archetype.role === 'boss');

      if (!this.cinema.hideHud) drawHud(this.ui, {
        monster: this.monster,
        tracker: this.tracker,
        roomIndex: this.roomIndex,
        totalRooms: this.totalRunRooms,
        roomName: plan.name,
        humansAlive: this.world.livingHumans,
        humansTotal: this.humansAtRoomStart,
        cleared: this.exitReady,
        skills: this.skillPool.takenList,
        hurtFlash: this.hurtFlash,
        elapsed: this.tracker.elapsed,
        hintClearedAt: this.controlsHintClearedAt,
        bossName: boss ? boss.archetype.name : null,
        bossHealth: boss ? boss.healthFraction : 0,
        touchActive: this.touchActive(),
        survival:
          this.hordeLevel !== null
            ? {
                elapsed: this.hordeElapsed,
                target: this.hordeTargetSeconds,
                wave: this.hordeWaveNumber,
                warning: this.hordeWarning,
                elite: this.hordeWarningElite,
              }
            : undefined,
      });

      if (this.roomIntroTimer > 0 && !this.cinema.hideHud) {
        const progress = 1 - this.roomIntroTimer / ROOM_INTRO_DURATION;
        drawRoomIntro(this.ui, plan.name, this.roomIndex, progress);
      }
    }

    switch (this.state) {
      case 'playing':
      case 'hordePlaying':
        if (this.showBuildSheet) {
          drawBuildSheet(this.ui, this.monster, this.tracker, this.skillPool.takenList);
        }
        if (!this.cinema.active) drawTouchControls(this.ui, this.input, this.meta.settings.touchControls);
        break;

      case 'cards':
        this.drawCardScreen();
        break;

      case 'mutation':
        this.drawMutationScreen();
        break;

      case 'pause': {
        const action = drawPause(this.ui, this.touchActive());
        if (action === 'resume' || this.input.consumePress('pause')) this.state = this.pauseReturnState;
        if (action === 'settings') {
          this.settingsReturnState = 'pause';
          this.state = 'settings';
        }
        if (action === 'menu') {
          this.tracker.outcome = 'death';
          this.tracker.killedBy = t('source.retreat');
          this.quitting = true;
          this.finishRun();
        }
        break;
      }

      case 'revive': {
        const action = drawReviveOffer(this.ui, this.reviveView, this.reviveElapsed);
        if (action === 'watch') {
          this.reviveView.phase = 'watching';
          this.reviveElapsed = 0;
          this.analytics.ad('show', 'revive', this.ads.sdkName);
          // A real network's promise is more likely to reject on failure than resolve
          // with a sentinel — caught the same way, so a rejected ad ends the run
          // instead of leaving the offer screen stuck waiting forever.
          this.ads
            .showRewardedAd()
            .then((result) => this.resolveRevive(result))
            .catch(() => this.resolveRevive('unavailable'));
        }
        if (action === 'decline') {
          this.analytics.design(['ad', 'revive', 'declined']);
          this.finishRun();
        }
        break;
      }

      case 'results': {
        const action = drawResults(this.ui, this.input, this.tracker, this.soulsAtRunStart, this.meta, {
          daily: this.isDailyRun,
          earned: this.earnedTrials,
          horde: this.hordeLevel !== null ? { level: this.hordeLevel, wave: this.hordeWaveNumber } : undefined,
        }, this.resultsView);
        // "Again" after a daily replays the same day's seed — that is the whole
        // point of a daily: the run stays fixed, only you change. "Again" after a
        // Horde attempt replays the same level, win or lose — the ladder only
        // moves forward on a win (`recordHordeResult`), so a loss just gets
        // another go at the same rung.
        if (action === 'again') {
          if (this.hordeLevel !== null) this.beginHordeRun(this.hordeLevel);
          else if (this.isDailyRun) this.beginRun(dailySeed(), true);
          else this.beginRun();
        }
        if (action === 'menu') this.state = 'menu';
        break;
      }
    }

    this.applyCursor();
    void delta;
  }

  /** The map, the den and the altar — everything that happens between fights. */
  private drawBetweenStops(): void {
    switch (this.state) {
      case 'map': {
        const reachable = reachableFrom(this.runMap, this.currentNodeId).filter(
          (node) => !this.visitedNodes.has(node.id),
        );

        // Nowhere left to go should be impossible by construction; treat it as a
        // finished run rather than a soft lock if it ever happens.
        if (reachable.length === 0) {
          this.tracker.outcome = 'victory';
          this.finishRun();
          return;
        }

        const mapResult = drawRunMap(this.ui, this.input, this.runMap, this.mapView, {
          currentNodeId: this.currentNodeId,
          reachable,
          visited: this.visitedNodes,
          time: this.mapTime,
          biome: this.biome,
        });
        if (mapResult.picked >= 0 && reachable.some((node) => node.id === mapResult.picked)) {
          this.enterNode(mapResult.picked);
        } else if (mapResult.back) {
          // Straight to the title screen, not the results report — this is a "never
          // mind, get me out" button, not a run worth reading a summary of. The run
          // still counts for lifetime stats and souls; it just skips the screen.
          this.tracker.outcome = 'death';
          this.tracker.killedBy = t('source.retreat');
          this.quitting = true;
          this.finishRun();
          this.state = 'menu';
        }
        break;
      }

      case 'market': {
        const result = drawMarket(this.ui, this.input, this.marketOffers, this.monster.souls);
        if (result.bought >= 0) this.buyOffer(result.bought);
        else if (result.left) this.returnToMap();
        break;
      }

      case 'cursed': {
        const result = drawCursedAltar(this.ui, this.input, this.cursedOffers);
        if (result.taken >= 0) this.takeCursedOffer(result.taken);
        else if (result.left) {
          this.cursedOffers = [];
          this.returnToMap();
        }
        break;
      }

      default:
        break;
    }
  }

  private drawCardScreen(): void {
    const rerollCost = 20 + this.roomIndex * 12;
    const remaining = this.monster.pendingLevels;
    // The ad reroll only makes sense on a draft the market sold — a level-up draft
    // is already free, so trading an ad for a second free reroll there would just be
    // a way to skip the souls cost this same draft charges everywhere else.
    const atMarket = this.cardsReturnState === 'market';
    const result = drawCardSelect(this.ui, this.input, this.pendingCards, {
      title: t('cardDraft.title', { n: this.monster.level - remaining + 1 }),
      subtitle:
        remaining > 1
          ? t('cardDraft.subtitleMulti', { n: remaining })
          : t('cardDraft.subtitleSingle'),
      rerollCost,
      souls: this.monster.souls,
      canReroll: true,
      stats: this.monster.stats,
      adReroll: atMarket
        ? {
            available: !this.cardAdRerollUsed && !this.cardAdRerollPending && this.ads.isRewardedAdAvailable(),
            pending: this.cardAdRerollPending,
          }
        : undefined,
    });

    if (result.rerolled && this.monster.souls >= rerollCost) {
      this.monster.souls -= rerollCost;
      this.analytics.design(['card', 'reroll', 'souls'], rerollCost);
      this.rerollPendingCards();
      return;
    }

    if (
      result.adRerolled &&
      atMarket &&
      !this.cardAdRerollUsed &&
      !this.cardAdRerollPending &&
      this.ads.isRewardedAdAvailable()
    ) {
      this.cardAdRerollPending = true;
      this.analytics.ad('show', 'reroll', this.ads.sdkName);
      this.ads
        .showRewardedAd()
        .then((adResult) => this.resolveCardAdReroll(adResult))
        .catch(() => this.resolveCardAdReroll('unavailable'));
      return;
    }

    if (result.picked < 0) return;

    const card = this.pendingCards[result.picked];
    if (!card) return;

    this.sound.cardPick();
    this.skillPool.acquire(card, this.monster.stats);
    this.tracker.recordSkill(card.id, card.name, card.rarity);
    this.analytics.design(['card', 'pick', atMarket ? 'market' : 'level', card.id]);
    // Max-HP changes from a card grant the new health immediately.
    this.monster.syncMaxHp(true);
    this.pendingCards = [];

    // A draft bought at the market is not a level-up; it costs souls, not a level.
    if (this.cardsReturnState !== null) {
      const back = this.cardsReturnState;
      this.cardsReturnState = null;
      this.state = back;
      return;
    }

    this.monster.pendingLevels = Math.max(0, this.monster.pendingLevels - 1);
    // Several levels can be banked at once; keep drafting until they are spent.
    if (this.monster.pendingLevels > 0 && this.offerCards()) return;

    // Horde drafts mid-fight — there is no room to complete, just a wave clock to
    // unpause. The campaign only ever reaches this screen at the portal, with the
    // fight already over, so it resumes the room-completion sequence instead.
    if (this.hordeLevel !== null) {
      this.state = 'hordePlaying';
      return;
    }
    this.completeRoom();
  }

  private rerollPendingCards(): void {
    this.pendingCards = this.skillPool.draw(3, {
      taken: new Map(),
      stats: this.monster.stats,
      depth: this.roomIndex,
    });
  }

  /**
   * Called once the market's ad-reroll promise settles.
   *
   * Guarded on the state still being 'cards' for the same reason `resolveRevive` is:
   * a frame error or a menu bail can have moved the player on by the time a real
   * network's video finishes.
   */
  private resolveCardAdReroll(result: AdResult): void {
    this.cardAdRerollPending = false;
    this.reportAdResult(result, 'reroll');
    if (this.state !== 'cards') return;
    // Spent only by an ad actually watched to the end — a skipped or failed one
    // leaves the offer standing, since the player got nothing for it.
    if (result === 'completed') {
      this.cardAdRerollUsed = true;
      this.rerollPendingCards();
    }
  }

  /** 'declined' is the player closing the ad early — not a failure to show one. */
  private reportAdResult(result: AdResult, placement: 'revive' | 'reroll'): void {
    if (result === 'completed') this.analytics.ad('rewarded', placement, this.ads.sdkName);
    else if (result === 'unavailable') this.analytics.ad('failed', placement, this.ads.sdkName);
  }

  private drawMutationScreen(): void {
    const picked = drawMutationSelect(this.ui, this.input, this.pendingMutations, this.monster.stats);
    if (picked < 0) return;

    const mutation = this.pendingMutations[picked];
    if (!mutation) return;

    this.monster.applyMutation(mutation, this.world);
    this.analytics.design(['mutation', 'pick', mutation.id]);
    this.pendingMutations = [];
    this.returnToMap();
  }

  /**
   * Whether the player appears to be on the on-screen stick rather than a keyboard.
   *
   * Same three-way logic `Input` already uses to decide whether a touch on the arena
   * steers: 'off' never counts, 'on' always does, 'auto' waits for an actual touch so
   * a mouse-and-keyboard player is never shown a hint for a key that isn't there
   * because their hardware happens to also have a touchscreen.
   */
  private touchActive(): boolean {
    if (this.cinema.active) return false;
    const mode = this.meta.settings.touchControls;
    if (mode === 'off') return false;
    if (mode === 'auto') return this.input.touchDetected;
    return true;
  }

  /**
   * Small pause icon, top-right, on every between-stop screen.
   *
   * The map has no button of its own that leads back to the title screen — picking a
   * destination used to be the only thing the screen let you do. The market and the
   * altar already have their own "leave", but that only backs out to the map, not out
   * of the run, and a touch player has no Escape key to fall back on either. Reuses
   * the same "II" glyph the in-arena touch controls already use for pause, so it reads
   * as the same button appearing somewhere new rather than a second one to learn.
   */
  private drawPauseIcon(): void {
    const r = 18;
    const x = this.ui.width - r - 14;
    const y = r + 14;
    const zone = this.ui.hitZone({ x: x - r, y: y - r, w: r * 2, h: r * 2 });

    const ctx = this.ui.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = zone.hovered ? 'rgba(46,40,36,0.9)' : 'rgba(20,19,23,0.7)';
    ctx.fill();
    ctx.strokeStyle = zone.hovered ? PALETTE.gold : 'rgba(232,226,212,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    this.ui.text(t('touch.pause'), x, y, {
      size: 12,
      color: PALETTE.ink,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (zone.clicked) {
      this.pauseReturnState = this.state;
      this.state = 'pause';
    }
  }

  private applyCursor(): void {
    const wanted =
      this.ui.hoveringInteractive
        ? 'pointer'
        : this.state === 'playing' || this.state === 'hordePlaying'
          ? 'crosshair'
          : 'default';
    if (this.renderer.canvas.style.cursor !== wanted) {
      this.renderer.canvas.style.cursor = wanted;
    }
  }

  // ---- reels mode ------------------------------------------------------------
  //
  // The public surface `src/reels/` drives. Kept here rather than reaching into
  // private state from outside: every one of these has to leave the run in a state
  // the rest of the game already knows how to be in.

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  setFixedViewport(viewport: FixedViewport | null): void {
    this.renderer.setFixedViewport(viewport);
  }

  setZoomScale(scale: number): void {
    this.renderer.zoomScale = scale;
  }

  /** The game's audio as a stream to record, or null before the first gesture. */
  captureAudio(): MediaStream | null {
    this.audio.unlock();
    return this.audio.captureStream();
  }

  /**
   * Drop straight into a fight: a fresh campaign run on `biome`, entered at the
   * first arena stop at `depth` (clamped; the last depth is the boss). Ignores the
   * checkpoint and the preferred start biome on purpose — a take should start where
   * it was asked to, not wherever the profile last left off.
   */
  startReelsScene(biome: 1 | 2 | 3, depth: number): void {
    this.resetRunState((Math.random() * 0xffffffff) >>> 0, false);
    this.hordeLevel = null;
    this.generateBiome(biome, (biome - 1) * BIOME_ROOMS, TOTAL_DEPTHS);
    const wanted = clamp(Math.round(depth), 0, BIOME_ROOMS - 1);
    const nodeId = this.runMap.byDepth[wanted]?.find((id) => isArenaNode(this.runMap.nodes[id]!.kind));
    if (nodeId !== undefined) this.enterNode(nodeId);
  }

  startReelsHorde(level: number): void {
    this.beginHordeRun(level);
  }

  /** Whether there is a live monster for `reelsEvolve`/`reelsEmpower` to act on. */
  get inArena(): boolean {
    return this.currentPlan !== null && (this.state === 'playing' || this.state === 'hordePlaying');
  }

  /**
   * Grow the monster without stopping for drafts: `cards` random skill cards and
   * `mutations` random mutations, applied through their normal paths. Mutations are
   * the ones that matter on camera — they are what reshape the silhouette.
   */
  reelsEvolve(cards: number, mutations: number): void {
    if (!this.inArena) return;
    for (let i = 0; i < cards; i++) {
      const card = this.skillPool.draw(1, { taken: new Map(), stats: this.monster.stats, depth: this.roomIndex })[0];
      if (card) this.skillPool.acquire(card, this.monster.stats);
    }
    const offered = drawMutations(this.runRng, this.monster.mutations, this.monster.stats, mutations, this.meta);
    for (const mutation of offered) this.monster.applyMutation(mutation, this.world);
    this.monster.syncMaxHp(true);
  }

  /** Strong enough to wade through any room on camera — same numbers as `debugBuff`. */
  reelsEmpower(): void {
    if (this.inArena) this.debugBuff();
  }

  /**
   * The statistics question is still open: asked on the title screen, before the
   * first run, and only in a build that has somewhere to send statistics. Reels
   * mode skips it — the take would open on a dialog.
   */
  private get needsConsent(): boolean {
    return this.analytics.configured && !this.meta.settings.analyticsAsked && !this.cinema.active;
  }

  /** Exposed for the boot screen. */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Whether there is nowhere further back to go.
   *
   * Exposed for the Android hardware back button: everywhere else, "back" is already
   * ESC — pausing a run, closing a dropdown, leaving a submenu — but the title screen
   * has no ESC handler of its own, because there is nothing behind it to return to.
   * That is also exactly the one place a back press should exit the app instead.
   */
  get atMainMenu(): boolean {
    return this.state === 'menu';
  }

  /**
   * Drive a single frame by hand.
   *
   * `requestAnimationFrame` is paused whenever the document is hidden (background
   * tab, undisplayed embed), which makes the game impossible to smoke-test from a
   * console. This lets a dev harness advance time deterministically.
   */
  debugFrame(deltaMs: number): void {
    this.frame(this.lastFrameMs + deltaMs);
  }

  /** Dev: jump straight to a room in the active biome's map, ending the current one normally. */
  debugLoadRoom(depth: number): void {
    if (!this.runMap) return;
    const wanted = clamp(Math.round(depth), 0, BIOME_ROOMS - 1);
    // Depths hold several nodes; take the first that is actually a fight.
    const nodeId = this.runMap.byDepth[wanted]!.find((id) =>
      isArenaNode(this.runMap.nodes[id]!.kind),
    );
    if (nodeId === undefined) return;

    if (this.state === 'playing') this.tracker.endRoom(this.monster.healthFraction);
    this.enterNode(nodeId);
  }

  /**
   * Dev: jump straight to a biome's map, skipping the grind to reach it normally.
   *
   * Only ever called by hand from the console — there is nothing to "turn off"
   * beyond not calling it again, and nothing here is reachable outside a dev build
   * (see `main.ts`'s `window.samarkand` gate). Requires a run already in progress,
   * same as every other `debug*` helper.
   */
  debugSetBiome(biome: 1 | 2 | 3): void {
    if (!this.runMap) return;
    if (biome === 3) this.generateBiome(3, BIOME_ROOMS * 2, TOTAL_DEPTHS);
    else if (biome === 2) this.generateBiome(2, BIOME_ROOMS, TOTAL_DEPTHS);
    else this.generateBiome(1, 0, TOTAL_DEPTHS);
  }

  /** Dev: the analytics events recorded this session (dev builds without GameAnalytics keys). */
  debugAnalytics(): readonly string[] {
    return this.analytics instanceof RecordingAnalytics ? this.analytics.events : [];
  }

  /** Dev: bank souls, for exercising the lair without grinding runs. */
  debugGrantSouls(amount: number): number {
    this.meta.souls += amount;
    this.meta.save();
    return this.meta.souls;
  }

  /** Dev: what the profile currently allows into a run. */
  debugGateReport(): Record<string, unknown> {
    return {
      souls: Math.floor(this.meta.souls),
      unlocked: [...this.meta.unlocked],
      unlockedCount: this.meta.unlockedCount,
      unlockableCount: this.meta.unlockableCount,
    };
  }

  /** Dev: jump straight to the map screen. */
  debugOpenMap(): void {
    this.state = 'map';
  }

  /** Dev: start a run on an exact seed, for reproducing a reported layout. */
  debugBeginRun(seed?: number, daily = false): number {
    this.beginRun(seed ?? (daily ? dailySeed() : undefined), daily);
    return this.tracker.seed;
  }

  /**
   * Dev: jump straight into a Horde run, bypassing the menu and level-select —
   * the robust equivalent of clicking through for a mode with no map to click
   * pixel-coordinates on.
   */
  debugStartHorde(level = 1): void {
    this.beginHordeRun(level);
  }

  /** Dev: what the profile has earned, and where today's daily stands. */
  debugTrialReport(): Record<string, unknown> {
    return {
      earned: [...this.meta.achievements],
      earnedCount: this.meta.achievementCount,
      total: this.meta.achievementTotal,
      rewardedSouls: this.meta.achievementSouls,
      dailySeed: dailySeed(),
      today: this.meta.todaysDaily(),
    };
  }

  /** Dev: enter the first unvisited stop of a given kind, wherever it is. */
  debugEnterKind(kind: string): boolean {
    if (!this.runMap) return false;
    const node = this.runMap.nodes.find(
      (n) => n.kind === kind && !this.visitedNodes.has(n.id),
    );
    if (!node) return false;
    this.enterNode(node.id);
    return true;
  }

  /** Dev: make the monster strong enough to reach late content for inspection. */
  debugBuff(): void {
    this.monster.stats.addModifier({ key: 'maxHp', flat: 5000, source: 'debug' });
    this.monster.stats.addModifier({ key: 'damage', mult: 12, source: 'debug' });
    this.monster.stats.addModifier({ key: 'moveSpeed', mult: 0.6, source: 'debug' });
    this.monster.syncMaxHp(true);
  }

  /** Dev: fire one catalogue entry by name, for tuning and leak-hunting. */
  debugPlaySound(name: string): boolean {
    const bank = this.sound as unknown as Record<string, unknown>;
    const fn = bank[name];
    if (typeof fn !== 'function') return false;

    const here = { x: this.camera.x, y: this.camera.y };
    // Arguments differ per sound; pass a placement plus a mid-range scalar and let
    // the extras be ignored by the ones that take fewer parameters.
    (fn as (...args: unknown[]) => void).call(this.sound, here, 0.5);
    return true;
  }

  /** Dev: put on a specific temporary form by id. */
  debugGrantBoon(id: string): boolean {
    const def = getBoon(id);
    if (!def || !this.world) return false;
    this.monster.grantBoon(def, this.world);
    return true;
  }

  /** Dev: force the evolution screen with a fresh set of offers. */
  debugOfferMutations(): void {
    this.pendingMutations = drawMutations(
      this.runRng,
      this.monster.mutations,
      this.monster.stats,
      3,
      this.meta,
    );
    if (this.pendingMutations.length > 0) this.state = 'mutation';
  }

  /** Closest living human regardless of line of sight — debug harness only. */
  private debugNearestEnemy(): { x: number; y: number; id: string } | null {
    if (!this.world) return null;
    let best: { x: number; y: number; id: string } | null = null;
    let bestD = Infinity;
    for (const human of this.world.humans) {
      if (!human.alive) continue;
      const d = Math.hypot(human.x - this.monster.x, human.y - this.monster.y);
      if (d < bestD) {
        bestD = d;
        best = { x: Math.round(human.x), y: Math.round(human.y), id: human.archetype.id };
      }
    }
    return best;
  }

  /** Read-only view of the machine state, for debugging. */
  debugSnapshot(): Record<string, unknown> {
    return {
      state: this.state,
      frameErrors: this.frameErrors,
      lastFrameError: this.lastFrameError.split('\n')[0],
      seed: this.tracker ? this.tracker.seed : 0,
      daily: this.isDailyRun,
      room: this.roomIndex,
      hordeLevel: this.hordeLevel,
      hordeElapsed: Number(this.hordeElapsed.toFixed(1)),
      hordeTargetSeconds: this.hordeTargetSeconds,
      hordeWaveNumber: this.hordeWaveNumber,
      humansAlive: this.world ? this.world.livingHumans : 0,
      humansTotal: this.humansAtRoomStart,
      hp: this.monster ? Math.round(this.monster.hp) : 0,
      maxHp: this.monster ? Math.round(this.monster.maxHp) : 0,
      souls: this.monster ? Math.floor(this.monster.souls) : 0,
      kills: this.tracker ? this.tracker.totalKills : 0,
      damage: this.tracker ? Math.round(this.tracker.totalDamageDealt) : 0,
      elapsed: this.tracker ? Number(this.tracker.elapsed.toFixed(1)) : 0,
      projectiles: this.world ? this.world.projectiles.length : 0,
      particles: this.world ? this.world.particles.activeCount : 0,
      x: this.monster ? Math.round(this.monster.x) : 0,
      y: this.monster ? Math.round(this.monster.y) : 0,
      bounds: this.world ? this.world.bounds : null,
      exit: this.currentPlan?.exit ?? null,
      cleared: this.exitReady,
      buildings: this.world ? this.world.buildings.filter((b) => b.alive).length : 0,
      attacksFired: this.tracker ? this.tracker.attacksFired : 0,
      shotsFired: this.tracker ? this.tracker.projectilesFired : 0,
      shotsHit: this.tracker ? this.tracker.projectilesHit : 0,
      hasTarget: this.monster ? this.monster.target !== null : false,
      boons: this.monster
        ? this.monster.activeBoons.map((b) => ({
            id: b.def.id,
            left: Number(b.remaining.toFixed(1)),
          }))
        : [],
      audio: this.audio.debugInfo(),
      node: this.currentNodeId !== null ? this.runMap.nodes[this.currentNodeId]!.kind : null,
      options: this.runMap
        ? reachableFrom(this.runMap, this.currentNodeId)
            .filter((n) => !this.visitedNodes.has(n.id))
            .map((n) => ({ id: n.id, kind: n.kind, lane: n.lane }))
        : [],
      curses: this.monster ? [...this.monster.curses] : [],
      marketOffers: this.marketOffers.map((o) => ({ kind: o.kind, price: o.price, sold: o.sold })),
      relics: this.world
        ? this.world.pickups
            .filter((p) => p.kind === 'boon')
            .map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), boon: p.boon?.id ?? '?' }))
        : [],
      level: this.monster ? this.monster.level : 0,
      pendingLevels: this.monster ? this.monster.pendingLevels : 0,
      xp: this.monster ? `${Math.floor(this.monster.xpIntoLevel)}/${this.monster.xpForNextLevel}` : '',
      nearestEnemy: this.debugNearestEnemy(),
      shotOutcomes: this.world ? { ...this.world.shotOutcomes } : null,
      // Deliberately cheap: the autoplay harness reads this every tick, and a
      // line-of-sight test per survivor against every wall made a run take minutes.
      survivors: this.world
        ? this.world.humans
            .filter((h) => h.alive)
            .slice(0, 12)
            .map((h) => ({
              id: h.archetype.id,
              x: Math.round(h.x),
              y: Math.round(h.y),
              hp: Math.round(h.hp),
              d: Math.round(Math.hypot(h.x - this.monster.x, h.y - this.monster.y)),
            }))
        : [],
    };
  }
}

/** Utility kept here so the game module owns all clamping of run-level values. */
export function clampFraction(value: number): number {
  return clamp(value, 0, 1);
}
