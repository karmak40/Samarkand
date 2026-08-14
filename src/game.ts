import { Ambience } from './audio/ambience';
import { AudioEngine } from './audio/engine';
import { SoundBank } from './audio/sfx';
import { Camera } from './core/camera';
import { Input } from './core/input';
import { clamp, TAU } from './core/math';
import { RNG } from './core/rng';
import { Building } from './entities/building';
import { Human } from './entities/human';
import { Monster } from './entities/monster';
import { t } from './i18n';
import { type AchievementDef } from './progression/achievements';
import { getBoon } from './progression/boons';
import { dailySeed } from './progression/daily';
 import { applyCurse, curseName, getCurse, rollCurses } from './progression/curses';
import { drawMutations, isEvolutionRoom, type Mutation } from './progression/evolution';
import { MetaProgress } from './progression/meta';
import { EFFECTS_SCALE, SHAKE_SCALE } from './progression/settings';
import { type UnlockCategory } from './progression/gate';
import { type SkillCard, SkillPool } from './progression/skills';
import { Renderer } from './render/renderer';
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
  drawRoomIntro,
} from './ui/screens';
import {
  type CursedOffer,
  drawCursedAltar,
  drawMarket,
  drawRunMap,
  type MarketOffer,
} from './ui/run-screens';
import { drawAchievements } from './ui/achievements';
import { drawLair } from './ui/lair';
import { drawSettings, newSettingsView, type SettingsView } from './ui/settings';
import { drawTouchControls } from './ui/touch-hud';
import { PALETTE, Ui } from './ui/widgets';
import { generateRoom, type RoomPlan } from './world/roomgen';
 import { generateRunMap, isArenaNode, reachableFrom, type RunMap } from './world/runmap';
import { World } from './world/world';

const MAP_DEPTHS = 12;
const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

/** Consecutive failed frames before the game gives up on the current screen. */
const BROKEN_FRAME_LIMIT = 60;
const ROOM_INTRO_DURATION = 2.4;
/** Seconds of total inactivity after which a room is force-cleared. */
const STALL_TIMEOUT = 45;

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
  | 'results';

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

  private state: GameState = 'menu';
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
  private mapTime = 0;

  private marketOffers: MarketOffer[] = [];
  private cursedOffers: CursedOffer[] = [];
  /** Where to return after a nested card draft (the market sells one). */
  private cardsReturnState: GameState | null = null;

  /** Depth of the current stop; drives every difficulty curve. */
  private roomIndex = 0;
  private humansAtRoomStart = 0;
  private roomIntroTimer = 0;
  private exitReady = false;
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
  /** Queued after a mutation choice, so evolution rooms still offer a card. */
  private cardAfterMutation = false;

  private hurtFlash = 0;
  private lastHp = 0;
  private menuTime = 0;
  /** Which tab and scroll offset the lair screen is showing. */
  private readonly lairView: { category: UnlockCategory; scroll: number } = {
    category: 'card',
    scroll: 0,
  };
  private readonly trialsView = { scroll: 0 };
  private readonly settingsView: SettingsView = newSettingsView();
  /** Where 'back' returns to: the title screen, or the paused run it was opened from. */
  private settingsReturnState: GameState = 'menu';

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

  constructor(canvas: HTMLCanvasElement) {
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
      if (this.state === 'playing') this.state = 'pause';
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
   * Start a run.
   *
   * Everything random in a run is forked from this one seed, so passing the daily
   * seed is all it takes to give every player the identical run — the map, the
   * settlements, the relics and the order cards come up in.
   */
  private beginRun(seed = (Math.random() * 0xffffffff) >>> 0, daily = false): void {
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

    // The map and every arena behind it come from the seed, so a run is fully
    // reproducible — including which branches were on offer.
    this.runMap = generateRunMap(MAP_DEPTHS, this.runRng.fork());

    const planRng = this.runRng.fork();
    this.plansByNode = new Map();
    for (const node of this.runMap.nodes) {
      if (!isArenaNode(node.kind)) continue;
      const request = node.kind === 'boss' ? 'boss' : node.kind === 'elite' ? 'elite' : 'battle';
      this.plansByNode.set(node.id, generateRoom(node.depth, MAP_DEPTHS, planRng, request));
    }

    this.currentNodeId = null;
    this.visitedNodes.clear();
    this.roomIndex = 0;
    this.pendingCards = [];
    this.pendingMutations = [];
    this.cardAfterMutation = false;
    this.cardsReturnState = null;
    this.hurtFlash = 0;
    this.mapTime = 0;

    // The run opens on the map: the very first stop is already a choice of one.
    this.state = 'map';
  }

  // ---- map navigation ------------------------------------------------------

  /** The arena plan for wherever the player currently is, if it is a fight. */
  private get currentPlan(): RoomPlan | null {
    if (this.currentNodeId === null) return null;
    return this.plansByNode.get(this.currentNodeId) ?? null;
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
    this.roomIndex = node.depth;

    switch (node.kind) {
      case 'battle':
      case 'elite':
      case 'boss':
        this.loadRoom(nodeId);
        this.state = 'playing';
        break;

      case 'market':
        this.openMarket();
        break;

      case 'cursed':
        this.openCursedAltar();
        break;
    }
  }

  /** Back to the map after a stop is done, or straight to victory after the boss. */
  private returnToMap(): void {
    const node = this.currentNodeId !== null ? this.runMap.nodes[this.currentNodeId] : null;
    if (node && node.kind === 'boss') {
      this.tracker.outcome = 'victory';
      this.sound.victory();
      this.finishRun();
      return;
    }
    this.state = 'map';
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
      const power = stats.get('damage') * (0.7 + 0.35 * stats.count('explodeOnKill'));
      world.explode(
        human.x,
        human.y,
        90 * areaSize,
        [{ type: 'physical', amount: power * stats.damageMultiplierFor('physical') }],
        t('skill.flesh-burst.name'),
        { color: '#c0343c', knockback: 140 },
      );
    }

    if (stats.has('poisonCloud')) {
      world.addGroundHazard({
        x: human.x,
        y: human.y,
        radius: 62 * areaSize,
        life: 5,
        dps: stats.get('damage') * 0.3 * stats.damageMultiplierFor('poison'),
        type: 'poison',
        color: '#8ed44f',
        sourceLabel: t('effect.plagueCloud'),
        status: {
          id: 'poison',
          duration: 5,
          stacks: 2,
          power: stats.get('damage') * 0.06,
          sourceLabel: t('effect.plagueCloud'),
        },
      });
    }

    if (stats.has('fearOnKill')) {
      for (const other of world.humansInRadius(human.x, human.y, 200 * areaSize)) {
        if (other.archetype.role === 'boss') continue;
        other.statuses.apply({ id: 'fear', duration: 2.5, sourceLabel: t('skill.dread-roar.name') });
      }
    }

    if (stats.has('deathBlossom')) {
      const crit = false;
      const { packets, statuses } = this.monster.buildAttack(crit);
      const shards = 8;
      const scaled = packets.map((p) => ({ type: p.type, amount: p.amount * 0.4 }));

      for (let i = 0; i < shards; i++) {
        const angle = (i / shards) * TAU;
        world.spawnProjectile({
          x: human.x,
          y: human.y,
          angle,
          speed: 460,
          packets: scaled,
          faction: 'monster',
          sourceLabel: t('skill.death-blossom.name'),
          radius: 5,
          range: 260,
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
      world.spawnPickup('blood', human.x, human.y, 5 + this.roomIndex);
    }

    void sourceLabel;
  }

  private loadRoom(nodeId: number): void {
    const plan = this.plansByNode.get(nodeId);
    if (!plan) return;
    const index = this.runMap.nodes[nodeId]!.depth;
    this.roomIndex = index;

    this.world.reset(plan.bounds, plan.wallThickness);
    this.renderer.terrain.build(plan);

    for (const planned of plan.buildings) {
      this.world.buildings.push(
        new Building(planned.kind, planned.rect, this.world.rng, 1 + index * 0.12),
      );
    }
    this.world.markSolidsDirty();

    for (const spawn of plan.spawns) {
      this.world.humans.push(new Human(spawn.id, spawn.x, spawn.y, index));
    }

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
    this.stallTimer = 0;
    this.stallDamageMark = this.tracker.totalDamageDealt;
    this.stallKillMark = this.tracker.totalKills;
    this.roomIntroTimer = ROOM_INTRO_DURATION;

    this.tracker.beginRoom(index, plan.name);
    if (plan.isBoss) this.sound.bossSpawn(this.monster);
  }

  private completeRoom(): void {
    this.tracker.endRoom(this.monster.healthFraction);

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
        this.cardAfterMutation = false;
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
    this.sound.cardPick();

    switch (offer.kind) {
      case 'card':
        // Nested draft: remember to come back here rather than to the arena.
        this.cardsReturnState = 'market';
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
    const earned = Math.floor(this.monster.soulsThisRun);
    this.soulsAtRunStart = earned;
    this.earnedTrials = this.meta.recordRun(this.tracker, earned, { daily: this.isDailyRun });
    this.state = 'results';
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
    const delta = Math.min(0.25, rawDelta);

    const started = performance.now();

    try {
      this.applySettings();
      this.renderer.syncCamera(this.camera);
      // Only the arena turns a touch into a stick and buttons; every other screen
      // needs a touch to keep behaving like a click, or none of the existing menus
      // would work on glass at all.
      this.input.setTouchContext(
        this.meta.settings.touchControls !== 'off',
        this.state === 'playing' ? 'play' : 'ui',
      );
      this.ui.frame(this.input, this.renderer.width, this.renderer.height);

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
        this.menuTime += delta;
        return;

      case 'playing':
        this.updatePlaying(delta);
        return;

      case 'map':
      case 'market':
      case 'cursed':
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
    }
  }

  private updatePlaying(delta: number): void {
    if (this.input.wasPressed('stats')) this.showBuildSheet = !this.showBuildSheet;
    // Claimed, or the pause screen drawn later this same frame would read the very
    // same press and resume immediately.
    if (this.input.consumePress('pause')) {
      this.state = 'pause';
      return;
    }

    this.accumulator += delta;
    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_STEP;
      steps++;
      this.step(FIXED_STEP);
      // A level lands the instant the soul is absorbed; stop simulating so the
      // draft opens on that exact frame rather than a few ticks later.
      if (this.monster.pendingLevels > 0) break;
      if (this.state !== 'playing') break;
    }

    // If we fell too far behind, drop the backlog rather than spiral.
    if (this.accumulator > FIXED_STEP * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    // Levelling interrupts play immediately — the reward should land while the kill
    // that earned it is still on screen, not wait to be claimed.
    if (this.state === 'playing' && this.monster.pendingLevels > 0) {
      // Drop the backlog too, or the frames owed would replay after the draft.
      this.accumulator = 0;
      if (this.offerCards()) return;
    }

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

    this.ambience.update(tension, danger);
  }

  /** One fixed simulation tick. */
  private step(dt: number): void {
    const world = this.world;

    // Hit-stop freezes the simulation for a few frames on heavy hits.
    const simDt = this.camera.consumeHitStop(dt);
    if (simDt <= 0) return;

    world.time += simDt;
    this.tracker.tick(simDt);
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
      this.finishRun();
      return;
    }

    if (!this.exitReady && this.checkStalledRoom(simDt)) {
      for (const human of world.humans) human.alive = false;
    }

    this.checkRoomProgress();
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
      this.completeRoom();
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

    if (this.state === 'menu') {
      // The menu widget edits the profile directly; push the result into the mix.
      this.audio.setVolume(this.meta.volume);
      this.audio.setMuted(this.meta.muted);
      this.ambience.quiet();

      const action = drawMainMenu(this.ui, this.meta, this.menuTime);
      if (action === 'start') this.beginRun();
      if (action === 'daily') this.beginRun(dailySeed(), true);
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

      drawHud(this.ui, {
        monster: this.monster,
        tracker: this.tracker,
        roomIndex: this.roomIndex,
        totalRooms: MAP_DEPTHS,
        roomName: plan.name,
        humansAlive: this.world.livingHumans,
        humansTotal: this.humansAtRoomStart,
        cleared: this.exitReady,
        skills: this.skillPool.takenList,
        hurtFlash: this.hurtFlash,
        elapsed: this.tracker.elapsed,
        bossName: boss ? boss.archetype.name : null,
        bossHealth: boss ? boss.healthFraction : 0,
      });

      if (this.roomIntroTimer > 0) {
        const progress = 1 - this.roomIntroTimer / ROOM_INTRO_DURATION;
        drawRoomIntro(this.ui, plan.name, this.roomIndex, progress);
      }
    }

    switch (this.state) {
      case 'playing':
        if (this.showBuildSheet) {
          drawBuildSheet(this.ui, this.monster, this.tracker, this.skillPool.takenList);
        }
        drawTouchControls(this.ui, this.input, this.meta.settings.touchControls);
        break;

      case 'cards':
        this.drawCardScreen();
        break;

      case 'mutation':
        this.drawMutationScreen();
        break;

      case 'pause': {
        const action = drawPause(this.ui);
        if (action === 'resume' || this.input.consumePress('pause')) this.state = 'playing';
        if (action === 'settings') {
          this.settingsReturnState = 'pause';
          this.state = 'settings';
        }
        if (action === 'menu') {
          this.tracker.outcome = 'death';
          this.tracker.killedBy = t('source.retreat');
          this.finishRun();
        }
        break;
      }

      case 'results': {
        const action = drawResults(this.ui, this.tracker, this.soulsAtRunStart, this.meta, {
          daily: this.isDailyRun,
          earned: this.earnedTrials,
        });
        // "Again" after a daily replays the same day's seed — that is the whole
        // point of a daily: the run stays fixed, only you change.
        if (action === 'again') {
          if (this.isDailyRun) this.beginRun(dailySeed(), true);
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

        const picked = drawRunMap(this.ui, this.input, this.runMap, {
          currentNodeId: this.currentNodeId,
          reachable,
          visited: this.visitedNodes,
          time: this.mapTime,
        });
        if (picked >= 0 && reachable.some((node) => node.id === picked)) {
          this.enterNode(picked);
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
    const result = drawCardSelect(this.ui, this.input, this.pendingCards, {
      title: t('cardDraft.title', { n: this.monster.level - remaining + 1 }),
      subtitle:
        remaining > 1
          ? t('cardDraft.subtitleMulti', { n: remaining })
          : t('cardDraft.subtitleSingle'),
      rerollCost,
      souls: this.monster.souls,
      canReroll: true,
    });

    if (result.rerolled && this.monster.souls >= rerollCost) {
      this.monster.souls -= rerollCost;
      this.pendingCards = this.skillPool.draw(3, {
        taken: new Map(),
        stats: this.monster.stats,
        depth: this.roomIndex,
      });
      return;
    }

    if (result.picked < 0) return;

    const card = this.pendingCards[result.picked];
    if (!card) return;

    this.sound.cardPick();
    this.skillPool.acquire(card, this.monster.stats);
    this.tracker.recordSkill(card.id, card.name, card.rarity);
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
    this.state = 'playing';
  }

  private drawMutationScreen(): void {
    const picked = drawMutationSelect(this.ui, this.input, this.pendingMutations);
    if (picked < 0) return;

    const mutation = this.pendingMutations[picked];
    if (!mutation) return;

    this.monster.applyMutation(mutation, this.world);
    this.pendingMutations = [];

    if (this.cardAfterMutation) {
      this.cardAfterMutation = false;
      if (this.offerCards()) return;
    }
    this.returnToMap();
  }

  private applyCursor(): void {
    const wanted = this.ui.hoveringInteractive ? 'pointer' : this.state === 'playing' ? 'crosshair' : 'default';
    if (this.renderer.canvas.style.cursor !== wanted) {
      this.renderer.canvas.style.cursor = wanted;
    }
  }

  /** Exposed for the boot screen. */
  get isRunning(): boolean {
    return this.running;
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

  /** Dev: jump straight to a room, ending the current one normally. */
  debugLoadRoom(depth: number): void {
    if (!this.runMap) return;
    const wanted = clamp(Math.round(depth), 0, MAP_DEPTHS - 1);
    // Depths hold several nodes; take the first that is actually a fight.
    const nodeId = this.runMap.byDepth[wanted]!.find((id) =>
      isArenaNode(this.runMap.nodes[id]!.kind),
    );
    if (nodeId === undefined) return;

    if (this.state === 'playing') this.tracker.endRoom(this.monster.healthFraction);
    this.enterNode(nodeId);
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
    this.cardAfterMutation = false;
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
