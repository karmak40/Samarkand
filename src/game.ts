import { Camera } from './core/camera';
import { Input } from './core/input';
import { clamp, TAU } from './core/math';
import { RNG } from './core/rng';
import { Building } from './entities/building';
import { Human, type HumanId } from './entities/human';
import { Monster } from './entities/monster';
import { drawMutations, isEvolutionRoom, type Mutation } from './progression/evolution';
import { MetaProgress } from './progression/meta';
import { type SkillCard, SkillPool } from './progression/skills';
import { Renderer } from './render/renderer';
import { RunStats } from './stats/tracker';
import { drawHud } from './ui/hud';
import {
  drawBuildSheet,
  drawCardSelect,
  drawLifetime,
  drawMainMenu,
  drawMutationSelect,
  drawPause,
  drawResults,
  drawRoomIntro,
} from './ui/screens';
import { Ui } from './ui/widgets';
import { generateRoom, type RoomPlan } from './world/roomgen';
import { World } from './world/world';

const TOTAL_ROOMS = 12;
const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const ROOM_INTRO_DURATION = 2.4;

type GameState =
  | 'menu'
  | 'lifetime'
  | 'playing'
  | 'cards'
  | 'mutation'
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

  private state: GameState = 'menu';
  /** Toggled with Tab during play. */
  private showBuildSheet = false;

  // --- run state ------------------------------------------------------------
  private world!: World;
  private monster!: Monster;
  private tracker!: RunStats;
  private skillPool!: SkillPool;
  private runRng!: RNG;
  private plans: RoomPlan[] = [];
  private roomIndex = 0;
  private humansAtRoomStart = 0;
  private roomIntroTimer = 0;
  private exitReady = false;
  private soulsAtRunStart = 0;

  private pendingCards: SkillCard[] = [];
  private pendingMutations: Mutation[] = [];
  /** Queued after a mutation choice, so evolution rooms still offer a card. */
  private cardAfterMutation = false;

  private hurtFlash = 0;
  private lastHp = 0;
  private menuTime = 0;

  // --- loop -----------------------------------------------------------------
  private accumulator = 0;
  private lastFrameMs = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.input = new Input(canvas);
    this.ui = new Ui(this.renderer.ctx);

    window.addEventListener('resize', () => this.renderer.resize());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---- run lifecycle -------------------------------------------------------

  private beginRun(): void {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.runRng = new RNG(seed);
    this.tracker = new RunStats(seed);
    this.skillPool = new SkillPool(this.runRng.fork());

    this.world = new World(this.runRng.fork(), this.tracker, this.camera);
    this.monster = new Monster(0, 0);
    this.meta.applyTo(this.monster.stats);
    this.monster.syncMaxHp(true);
    this.monster.hp = this.monster.maxHp;
    this.world.monster = this.monster;
    this.soulsAtRunStart = 0;

    this.installWorldHooks();

    // Pre-generate the whole biome so room names can be shown ahead of time and
    // the layout stays reproducible from the seed.
    const planRng = this.runRng.fork();
    this.plans = [];
    for (let i = 0; i < TOTAL_ROOMS; i++) {
      this.plans.push(generateRoom(i, TOTAL_ROOMS, planRng));
    }

    this.roomIndex = 0;
    this.pendingCards = [];
    this.pendingMutations = [];
    this.cardAfterMutation = false;
    this.hurtFlash = 0;

    this.loadRoom(0);
    this.state = 'playing';
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
        'Разрыв плоти',
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
        sourceLabel: 'Чумное облако',
        status: {
          id: 'poison',
          duration: 5,
          stacks: 2,
          power: stats.get('damage') * 0.06,
          sourceLabel: 'Чумное облако',
        },
      });
    }

    if (stats.has('fearOnKill')) {
      for (const other of world.humansInRadius(human.x, human.y, 200 * areaSize)) {
        if (other.archetype.role === 'boss') continue;
        other.statuses.apply({ id: 'fear', duration: 2.5, sourceLabel: 'Устрашающий рёв' });
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
          sourceLabel: 'Смертный цвет',
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

  private loadRoom(index: number): void {
    const plan = this.plans[index]!;
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
      this.world.humans.push(new Human(spawn.id as HumanId, spawn.x, spawn.y, index));
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
    this.roomIntroTimer = ROOM_INTRO_DURATION;

    this.tracker.beginRoom(index, plan.name);
  }

  private completeRoom(): void {
    this.tracker.endRoom(this.monster.healthFraction);

    const isLast = this.roomIndex >= TOTAL_ROOMS - 1;
    if (isLast) {
      this.tracker.outcome = 'victory';
      this.finishRun();
      return;
    }

    // Skill cards now come from levelling, which the player spends whenever they
    // like. Rooms only gate evolution, which is a bigger, rarer decision.
    if (isEvolutionRoom(this.roomIndex)) {
      this.pendingMutations = drawMutations(
        this.runRng,
        this.monster.mutations,
        this.monster.stats,
        3,
      );
      if (this.pendingMutations.length > 0) {
        this.cardAfterMutation = false;
        this.state = 'mutation';
        return;
      }
    }

    this.advanceRoom();
  }

  /** Open the skill draft against one banked level. Returns false if none is due. */
  private offerCards(): boolean {
    if (this.monster.pendingLevels <= 0) return false;

    this.pendingCards = this.skillPool.draw(3, {
      taken: new Map(),
      stats: this.monster.stats,
      depth: this.roomIndex,
    });

    if (this.pendingCards.length === 0) {
      // Pool exhausted: don't strand the player holding an unspendable level.
      this.monster.pendingLevels = 0;
      return false;
    }

    this.state = 'cards';
    return true;
  }

  private advanceRoom(): void {
    this.loadRoom(this.roomIndex + 1);
    this.state = 'playing';
  }

  private finishRun(): void {
    const earned = Math.floor(this.monster.soulsThisRun);
    this.soulsAtRunStart = earned;
    this.meta.recordRun(this.tracker, earned);
    this.state = 'results';
  }

  // ---- frame ---------------------------------------------------------------

  private frame = (nowMs: number): void => {
    const rawDelta = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    // Clamp so an alt-tab doesn't fast-forward the simulation.
    const delta = Math.min(0.25, rawDelta);

    this.renderer.syncCamera(this.camera);
    this.ui.frame(this.input, this.renderer.width, this.renderer.height);

    this.update(delta);
    this.draw(delta);

    this.input.endFrame();
    requestAnimationFrame(this.frame);
  };

  private update(delta: number): void {
    switch (this.state) {
      case 'menu':
      case 'lifetime':
        this.menuTime += delta;
        return;

      case 'playing':
        this.updatePlaying(delta);
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
    if (this.input.wasPressed('pause')) {
      this.state = 'pause';
      return;
    }

    // Banked levels are spent on demand — mid-fight if you want the power now, or
    // saved for a calmer moment.
    if (this.input.wasPressed('confirm') && this.monster.pendingLevels > 0) {
      if (this.offerCards()) return;
    }

    this.accumulator += delta;
    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      this.accumulator -= FIXED_STEP;
      steps++;
      this.step(FIXED_STEP);
    }

    // If we fell too far behind, drop the backlog rather than spiral.
    if (this.accumulator > FIXED_STEP * MAX_STEPS_PER_FRAME) this.accumulator = 0;

    this.camera.update(delta);
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - delta * 2.2);
    if (this.roomIntroTimer > 0) this.roomIntroTimer -= delta;
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
      this.hurtFlash = Math.min(1, this.hurtFlash + (this.lastHp - this.monster.hp) / this.monster.maxHp * 3);
    }
    this.lastHp = this.monster.hp;

    if (!this.monster.alive) {
      this.finishRun();
      return;
    }

    this.checkRoomProgress();
  }

  private checkRoomProgress(): void {
    const world = this.world;

    if (!this.exitReady) {
      if (world.livingHumans > 0) return;

      this.exitReady = true;
      world.cleared = true;
      world.camera.shake(4);

      // Sweep the battlefield: every soul still lying around comes to you. Souls
      // are experience now, so losing track of them would silently cost levels.
      for (const pickup of world.pickups) pickup.forceAttract();
      world.texts.add(
        this.monster.x,
        this.monster.y - 60,
        'ПОСЕЛЕНИЕ ПАЛО',
        '#d8a13a',
        22,
        1,
      );
      return;
    }

    const exit = this.plans[this.roomIndex]!.exit;
    const distance = Math.hypot(this.monster.x - exit.x, this.monster.y - exit.y);
    if (distance < 46) this.completeRoom();
  }

  // ---- draw ----------------------------------------------------------------

  private draw(delta: number): void {
    this.renderer.begin();

    if (this.state === 'menu') {
      const action = drawMainMenu(this.ui, this.meta, this.menuTime);
      if (action === 'start') this.beginRun();
      if (action === 'stats') this.state = 'lifetime';
      this.applyCursor();
      return;
    }

    if (this.state === 'lifetime') {
      drawMainMenu(this.ui, this.meta, this.menuTime);
      const action = drawLifetime(this.ui, this.meta);
      if (action === 'back') this.state = 'menu';
      if (action === 'reset') {
        this.meta.reset();
        this.state = 'menu';
      }
      this.applyCursor();
      return;
    }

    // Every remaining state draws the world underneath.
    const plan = this.plans[this.roomIndex]!;
    this.renderer.drawWorld(this.world, this.camera, plan.exit, this.exitReady);

    const boss = this.world.humans.find((h) => h.alive && h.archetype.role === 'boss');

    drawHud(this.ui, {
      monster: this.monster,
      tracker: this.tracker,
      roomIndex: this.roomIndex,
      totalRooms: TOTAL_ROOMS,
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

    switch (this.state) {
      case 'playing':
        if (this.showBuildSheet) {
          drawBuildSheet(this.ui, this.monster, this.tracker, this.skillPool.takenList);
        }
        break;

      case 'cards':
        this.drawCardScreen();
        break;

      case 'mutation':
        this.drawMutationScreen();
        break;

      case 'pause': {
        const action = drawPause(this.ui);
        if (action === 'resume' || this.input.wasPressed('pause')) this.state = 'playing';
        if (action === 'menu') {
          this.tracker.outcome = 'death';
          this.tracker.killedBy = 'отступление';
          this.finishRun();
        }
        break;
      }

      case 'results': {
        const action = drawResults(this.ui, this.tracker, this.soulsAtRunStart, this.meta);
        if (action === 'again') this.beginRun();
        if (action === 'menu') this.state = 'menu';
        break;
      }
    }

    this.applyCursor();
    void delta;
  }

  private drawCardScreen(): void {
    const rerollCost = 20 + this.roomIndex * 12;
    const remaining = this.monster.pendingLevels;
    const result = drawCardSelect(this.ui, this.input, this.pendingCards, {
      title: `УРОВЕНЬ ${this.monster.level - remaining + 1}`,
      subtitle:
        remaining > 1
          ? `Съеденные души меняют тебя. Осталось выборов: ${remaining}.`
          : 'Съеденные души меняют тебя. Выбери, чем станешь.',
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

    this.skillPool.acquire(card, this.monster.stats);
    this.tracker.recordSkill(card.id, card.name, card.rarity);
    // Max-HP changes from a card grant the new health immediately.
    this.monster.syncMaxHp(true);
    this.pendingCards = [];
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
    this.advanceRoom();
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
  debugLoadRoom(index: number): void {
    if (this.state !== 'playing') return;
    this.tracker.endRoom(this.monster.healthFraction);
    this.loadRoom(clamp(Math.round(index), 0, TOTAL_ROOMS - 1));
  }

  /** Dev: make the monster strong enough to reach late content for inspection. */
  debugBuff(): void {
    this.monster.stats.addModifier({ key: 'maxHp', flat: 5000, source: 'отладка' });
    this.monster.stats.addModifier({ key: 'damage', mult: 12, source: 'отладка' });
    this.monster.stats.addModifier({ key: 'moveSpeed', mult: 0.6, source: 'отладка' });
    this.monster.syncMaxHp(true);
  }

  /** Dev: force the evolution screen with a fresh set of offers. */
  debugOfferMutations(): void {
    this.pendingMutations = drawMutations(this.runRng, this.monster.mutations, this.monster.stats, 3);
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
      exit: this.plans[this.roomIndex]?.exit ?? null,
      cleared: this.exitReady,
      buildings: this.world ? this.world.buildings.filter((b) => b.alive).length : 0,
      attacksFired: this.tracker ? this.tracker.attacksFired : 0,
      shotsFired: this.tracker ? this.tracker.projectilesFired : 0,
      shotsHit: this.tracker ? this.tracker.projectilesHit : 0,
      hasTarget: this.monster ? this.monster.target !== null : false,
      level: this.monster ? this.monster.level : 0,
      pendingLevels: this.monster ? this.monster.pendingLevels : 0,
      xp: this.monster ? `${Math.floor(this.monster.xpIntoLevel)}/${this.monster.xpForNextLevel}` : '',
      nearestEnemy: this.debugNearestEnemy(),
      shotOutcomes: this.world ? { ...this.world.shotOutcomes } : null,
      survivors: this.world
        ? this.world.humans
            .filter((h) => h.alive)
            .slice(0, 12)
            .map((h) => ({
              id: h.archetype.id,
              x: Math.round(h.x),
              y: Math.round(h.y),
              hp: Math.round(h.hp),
              los: this.world.hasLineOfSight(this.monster.x, this.monster.y, h.x, h.y),
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
