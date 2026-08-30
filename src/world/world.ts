import {
  DAMAGE_INFO,
  type DamageOptions,
  type DamagePacket,
  type DamageResult,
  type DamageType,
} from '../combat/damage';
import { type StatusApplication } from '../combat/status';
import { Camera } from '../core/camera';
import {
  circleRectOverlap,
  dist2,
  type Rect,
  resolveCircleRect,
  segmentRectHit,
  TAU,
} from '../core/math';
import { RNG } from '../core/rng';
import { t } from '../i18n';
import { Combatant, type DeathContext, type Entity } from '../entities/entity';
import type { Building } from '../entities/building';
import type { Human, HumanId } from '../entities/human';
import type { Monster } from '../entities/monster';
import { Pickup, type PickupKind } from '../entities/pickup';
import { rollBoon } from '../progression/boons';
import { type ContentGate, OPEN_GATE } from '../progression/gate';
import { Projectile, type ProjectileConfig } from '../entities/projectile';
import { type SoundBank } from '../audio/sfx';
import { DecalLayer, FloatingTextSystem, ParticleSystem } from '../render/effects';
import type { RunStats } from '../stats/tracker';

/** Cell size for the broad-phase grid. Roughly 3x a human's diameter. */
const GRID_CELL = 96;

/**
 * The live simulation for one room: entities, terrain, effects and all the
 * cross-entity queries. Entities never talk to each other directly — they go
 * through the world, which keeps damage attribution and telemetry in one place.
 */
export class World {
  readonly rng: RNG;
  readonly tracker: RunStats;
  readonly camera: Camera;
  /** Shared across runs; entities reach audio through the world like everything else. */
  readonly sound: SoundBank;
  /** Which relics this profile has unlocked. Assigned by the run. */
  contentGate: ContentGate = OPEN_GATE;

  /** Assigned by the game once the monster exists; never null during play. */
  monster!: Monster;

  humans: Human[] = [];
  projectiles: Projectile[] = [];
  buildings: Building[] = [];
  pickups: Pickup[] = [];

  /** Static collision rects: arena walls plus every standing building. */
  private solids: Rect[] = [];
  /** Subset of `solids` tall enough to block sight and projectiles. */
  private sightBlockers: Rect[] = [];
  private solidsDirty = true;

  readonly particles = new ParticleSystem();
  readonly texts = new FloatingTextSystem();
  readonly decals = new DecalLayer();

  /** Arena rect in world coordinates, including the drawn barrier band. */
  bounds: Rect = { x: 0, y: 0, w: 1600, h: 1200 };

  /**
   * How far inside `bounds` the playable area starts. The barrier is painted into
   * the terrain rather than being made of entities, so this is what stops things
   * walking into the rocks.
   */
  wallInset = 0;

  /** Seconds of simulated time since the room started. */
  time = 0;

  /** Set when the last human dies, so the game can open the exit. */
  cleared = false;

  private grid = new Map<number, Human[]>();
  private gridCols = 0;

  /** Broad-phase grid for `solids`, rebuilt whenever they change (buildings don't move). */
  private solidGrid = new Map<number, Rect[]>();
  private solidGridCols = 0;

  /** Reusable `Human[]` buffers for `humansInRadius`, see `acquireHumanBuffer`. */
  private readonly humanBufferPool: Human[][] = [];

  /** Queued lightning arcs to draw this frame: [x1,y1,x2,y2,age]. */
  readonly arcs: Array<{ x1: number; y1: number; x2: number; y2: number; life: number }> = [];

  /** Lingering damage zones: fire pools, poison clouds, consecrated ground. */
  readonly hazards: GroundHazard[] = [];

  /** Callbacks the run installs so entities never import the run directly. */
  onBuildingBreached?: (building: Building, occupants: number) => void;
  onHumanKilled?: (human: Human, ctx: DeathContext) => void;
  spawnHuman?: (id: HumanId, x: number, y: number, tier: number) => void;

  private readonly delayed: Array<{ remaining: number; fn: (world: World) => void }> = [];

  /** Why monster projectiles stopped. Surfaced in the debug snapshot only. */
  readonly shotOutcomes = { hitBuilding: 0, outOfRange: 0, leftBounds: 0 };

  constructor(rng: RNG, tracker: RunStats, camera: Camera, sound: SoundBank) {
    this.rng = rng;
    this.tracker = tracker;
    this.camera = camera;
    this.sound = sound;
  }

  // ---- setup ---------------------------------------------------------------

  reset(bounds: Rect, wallInset = 0): void {
    this.bounds = bounds;
    this.wallInset = wallInset;
    this.humans = [];
    this.projectiles = [];
    this.buildings = [];
    this.pickups = [];
    this.arcs.length = 0;
    this.hazards.length = 0;
    this.delayed.length = 0;
    this.time = 0;
    this.cleared = false;
    this.solidsDirty = true;
    this.particles.clear();
    this.texts.clear();
    this.decals.clear();
    this.decals.resize(bounds.w, bounds.h, bounds.x, bounds.y);
    this.camera.setBounds(bounds);
  }

  markSolidsDirty(): void {
    this.solidsDirty = true;
  }

  private rebuildSolids(): void {
    this.solids = [];
    this.sightBlockers = [];
    for (const b of this.buildings) {
      if (!b.alive || !b.blocking) continue;
      this.solids.push(b.rect);
      if (b.blocksSight) this.sightBlockers.push(b.rect);
    }
    this.solidsDirty = false;
    this.rebuildSolidGrid();
  }

  /**
   * Bucket every solid rect into the cells it overlaps. Buildings never move, so
   * this only needs to run when `solids` itself changes (a building collapses),
   * not every frame — unlike the human grid in `rebuildGrid`.
   */
  private rebuildSolidGrid(): void {
    this.solidGrid.clear();
    this.solidGridCols = Math.max(1, Math.ceil(this.bounds.w / GRID_CELL));
    for (const rect of this.solids) {
      const minCx = Math.floor((rect.x - this.bounds.x) / GRID_CELL);
      const maxCx = Math.floor((rect.x + rect.w - this.bounds.x) / GRID_CELL);
      const minCy = Math.floor((rect.y - this.bounds.y) / GRID_CELL);
      const maxCy = Math.floor((rect.y + rect.h - this.bounds.y) / GRID_CELL);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          const key = cy * this.solidGridCols + cx;
          const cell = this.solidGrid.get(key);
          if (cell) cell.push(rect);
          else this.solidGrid.set(key, [rect]);
        }
      }
    }
  }

  get solidRects(): readonly Rect[] {
    if (this.solidsDirty) this.rebuildSolids();
    return this.solids;
  }

  /** Rects that stop line of sight and projectiles — a subset of `solidRects`. */
  get sightRects(): readonly Rect[] {
    if (this.solidsDirty) this.rebuildSolids();
    return this.sightBlockers;
  }

  // ---- spatial queries -----------------------------------------------------

  /** Rebuild the broad-phase grid. Called once per frame before AI updates. */
  rebuildGrid(): void {
    this.grid.clear();
    this.gridCols = Math.max(1, Math.ceil(this.bounds.w / GRID_CELL));
    for (const human of this.humans) {
      if (!human.alive) continue;
      const key = this.cellKey(human.x, human.y);
      const cell = this.grid.get(key);
      if (cell) cell.push(human);
      else this.grid.set(key, [human]);
    }
  }

  private cellKey(x: number, y: number): number {
    const cx = Math.floor((x - this.bounds.x) / GRID_CELL);
    const cy = Math.floor((y - this.bounds.y) / GRID_CELL);
    return cy * this.gridCols + cx;
  }

  /**
   * Every living human within `radius` of a point. Allocates a fresh array every
   * call — fine for cold paths (once per explosion, once per lightning jump), but
   * avoid it on anything that runs every frame per entity. Use
   * `humansInRadiusInto` with a buffer from `acquireHumanBuffer` there instead.
   */
  humansInRadius(x: number, y: number, radius: number): Human[] {
    return this.humansInRadiusInto(x, y, radius, []);
  }

  /** Same query, writing into a caller-owned (cleared) array instead of allocating. */
  humansInRadiusInto(x: number, y: number, radius: number, out: Human[]): Human[] {
    out.length = 0;
    const r2 = radius * radius;
    const cells = Math.ceil(radius / GRID_CELL);
    const baseCx = Math.floor((x - this.bounds.x) / GRID_CELL);
    const baseCy = Math.floor((y - this.bounds.y) / GRID_CELL);

    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const cell = this.grid.get((baseCy + dy) * this.gridCols + (baseCx + dx));
        if (!cell) continue;
        for (const human of cell) {
          if (!human.alive) continue;
          if (dist2(x, y, human.x, human.y) <= r2) out.push(human);
        }
      }
    }
    return out;
  }

  /**
   * Borrow a scratch `Human[]` for a `humansInRadiusInto` call; return it with
   * `releaseHumanBuffer` once done with the results. Safe under reentrancy — e.g.
   * a kill triggered from inside a loop over one buffer (an on-kill skill effect,
   * chain lightning) that itself queries `humansInRadius` gets its own buffer
   * from the pool rather than clobbering the caller's. Forgetting to release just
   * means that buffer goes back to being garbage-collected, not a correctness bug.
   */
  acquireHumanBuffer(): Human[] {
    return this.humanBufferPool.pop() ?? [];
  }

  releaseHumanBuffer(buf: Human[]): void {
    buf.length = 0;
    this.humanBufferPool.push(buf);
  }

  /**
   * Closest living human to a point, optionally requiring line of sight.
   * This is the auto-aim query, so it runs every frame and avoids allocation.
   *
   * Walks the broad-phase grid outward in square rings from the query point
   * instead of scanning every human — a room with dozens of defenders spread
   * across a large arena only visits the handful actually nearby. Rings stop
   * once the closest a further ring could possibly be already loses to the best
   * candidate found so far.
   */
  nearestHuman(
    x: number,
    y: number,
    maxRange: number,
    requireLineOfSight = true,
    exclude?: Human,
  ): Human | null {
    let best: Human | null = null;
    let bestD2 = maxRange * maxRange;

    const maxRing = Math.ceil(maxRange / GRID_CELL);
    const baseCx = Math.floor((x - this.bounds.x) / GRID_CELL);
    const baseCy = Math.floor((y - this.bounds.y) / GRID_CELL);

    for (let ring = 0; ring <= maxRing; ring++) {
      if (ring > 0) {
        // Any point in a cell `ring` cells away is at least `(ring - 1) * GRID_CELL`
        // from the query point — a conservative bound, but enough to stop early
        // once nothing farther out could beat the current best.
        const nearestPossible = (ring - 1) * GRID_CELL;
        if (nearestPossible * nearestPossible > bestD2) break;
      }

      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // Only the ring's boundary is new; its interior was covered by earlier rings.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;

          const cell = this.grid.get((baseCy + dy) * this.gridCols + (baseCx + dx));
          if (!cell) continue;

          for (const human of cell) {
            if (!human.alive || human === exclude || human.untargetable) continue;
            const d2 = dist2(x, y, human.x, human.y);
            if (d2 >= bestD2) continue;
            if (requireLineOfSight && !this.hasLineOfSight(x, y, human.x, human.y)) continue;
            best = human;
            bestD2 = d2;
          }
        }
      }
    }

    return best;
  }

  hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    // Cheap bounding-box reject before the real (and pricier) segment/rect test —
    // most buildings in a room aren't anywhere near a given sightline.
    const minX = Math.min(ax, bx);
    const maxX = Math.max(ax, bx);
    const minY = Math.min(ay, by);
    const maxY = Math.max(ay, by);

    for (const rect of this.sightRects) {
      if (rect.x + rect.w < minX || rect.x > maxX || rect.y + rect.h < minY || rect.y > maxY) continue;
      if (segmentRectHit(ax, ay, bx, by, rect)) return false;
    }
    return true;
  }

  /** Push a circle out of every solid and the arena walls. Returns true if moved. */
  collideWithWorld(entity: { x: number; y: number; radius: number }): boolean {
    if (this.solidsDirty) this.rebuildSolids();
    let moved = false;

    const cells = Math.ceil(entity.radius / GRID_CELL) + 1;
    const baseCx = Math.floor((entity.x - this.bounds.x) / GRID_CELL);
    const baseCy = Math.floor((entity.y - this.bounds.y) / GRID_CELL);

    for (let dy = -cells; dy <= cells; dy++) {
      for (let dx = -cells; dx <= cells; dx++) {
        const cell = this.solidGrid.get((baseCy + dy) * this.solidGridCols + (baseCx + dx));
        if (!cell) continue;
        for (const rect of cell) {
          // A rect spanning several cells is bucketed into each of them, so the
          // same rect can turn up again from an adjacent cell — harmless, since
          // by then it's already resolved and this overlap check just skips it.
          if (!circleRectOverlap(entity.x, entity.y, entity.radius, rect)) continue;
          const fixed = resolveCircleRect(entity.x, entity.y, entity.radius, rect);
          if (fixed) {
            entity.x = fixed.x;
            entity.y = fixed.y;
            moved = true;
          }
        }
      }
    }

    const b = this.bounds;
    const inset = this.wallInset;
    const r = entity.radius;
    const minX = b.x + inset + r;
    const maxX = b.x + b.w - inset - r;
    const minY = b.y + inset + r;
    const maxY = b.y + b.h - inset - r;

    if (entity.x < minX) {
      entity.x = minX;
      moved = true;
    } else if (entity.x > maxX) {
      entity.x = maxX;
      moved = true;
    }
    if (entity.y < minY) {
      entity.y = minY;
      moved = true;
    } else if (entity.y > maxY) {
      entity.y = maxY;
      moved = true;
    }

    return moved;
  }

  /** First building whose rect contains this point, alive or not. */
  buildingAt(x: number, y: number, radius: number): Building | null {
    for (const b of this.buildings) {
      if (!b.alive || !b.blocking) continue;
      if (circleRectOverlap(x, y, radius, b.rect)) return b;
    }
    return null;
  }

  // ---- spawning ------------------------------------------------------------

  spawnProjectile(config: ProjectileConfig): Projectile {
    const p = new Projectile(config);
    this.projectiles.push(p);
    if (config.faction === 'monster') this.tracker.projectilesFired++;
    return p;
  }

  /**
   * Drop a relic granting a temporary form.
   *
   * Rolls against the forms already worn so a find is always something new, and
   * relics do not scatter on spawn — they should stay where they were placed.
   */
  spawnBoon(x: number, y: number): void {
    const active = new Set(this.monster.activeBoons.map((b) => b.def.id));
    const def = rollBoon(this.rng, active, this.contentGate);
    const pickup = new Pickup('boon', x, y, 1, def);
    this.pickups.push(pickup);

    this.particles.ring(x, y, def.color, 70, 0.6);
    this.sound.portal({ x, y });
  }

  spawnPickup(kind: PickupKind, x: number, y: number, value: number): void {
    const pickup = new Pickup(kind, x, y, value);
    // Scatter loot so a pile of corpses doesn't drop everything on one pixel.
    const angle = this.rng.next() * TAU;
    const speed = this.rng.range(40, 130);
    pickup.vx = Math.cos(angle) * speed;
    pickup.vy = Math.sin(angle) * speed;
    this.pickups.push(pickup);
  }

  /**
   * Radial damage with linear falloff to `falloffMin` at the edge.
   * Also scorches the ground and shakes the camera proportionally to the radius.
   */
  explode(
    x: number,
    y: number,
    radius: number,
    packets: DamagePacket[],
    sourceLabel: string,
    options: {
      falloffMin?: number;
      statuses?: StatusApplication[];
      knockback?: number;
      color?: string;
      hurtsBuildings?: boolean;
      shake?: number;
    } = {},
  ): void {
    const {
      falloffMin = 0.4,
      statuses = [],
      knockback = 120,
      color = '#ff7b31',
      hurtsBuildings = true,
      shake = radius * 0.02,
    } = options;

    this.particles.ring(x, y, color, radius, 0.32);
    this.particles.emit({
      count: Math.min(34, 10 + Math.floor(radius / 6)),
      x,
      y,
      color,
      shape: 'ember',
      speed: [radius * 1.2, radius * 3.4],
      size: [2, 5],
      life: [0.25, 0.6],
      additive: true,
      drag: 4,
    });
    this.decals.scorch(x, y, radius * 0.7);
    this.camera.shake(shake);
    this.sound.explosion({ x, y }, radius / 160);

    const nearby = this.acquireHumanBuffer();
    this.humansInRadiusInto(x, y, radius, nearby);
    for (const human of nearby) {
      const d = Math.hypot(human.x - x, human.y - y);
      const falloff = falloffMin + (1 - falloffMin) * (1 - Math.min(1, d / radius));
      const scaled = packets.map((p) => ({ type: p.type, amount: p.amount * falloff }));
      const dirX = human.x - x;
      const dirY = human.y - y;

      human.takeDamage(
        {
          packets: scaled,
          sourceLabel,
          kind: 'explosion',
          knockback,
          dirX,
          dirY,
          dodgeable: false,
        },
        this,
        this.monster,
      );

      for (const status of statuses) human.statuses.apply(status);
    }
    this.releaseHumanBuffer(nearby);

    if (hurtsBuildings) {
      for (const building of this.buildings) {
        if (!building.alive) continue;
        const cx = building.rect.x + building.rect.w / 2;
        const cy = building.rect.y + building.rect.h / 2;
        if (dist2(x, y, cx, cy) > radius * radius * 1.6) continue;
        building.takeStructuralDamage(
          packets.reduce((sum, p) => sum + p.amount, 0) * 0.7,
          this,
        );
      }
    }
  }

  /**
   * Lightning that hops between nearby humans, losing damage per hop.
   * The first target is not damaged here — the caller already hit it.
   */
  chainLightning(
    from: Human,
    packets: DamagePacket[],
    jumps: number,
    range: number,
    sourceLabel: string,
    falloffPerJump = 0.75,
  ): void {
    let source = from;
    const struck = new Set<number>([from.id]);
    let current = packets;

    // Reused across jumps — each jump fully consumes the candidates it finds into
    // `next` before `takeDamage` runs, so nothing here overlaps with a nested
    // `humansInRadius` a kill-triggered effect might make mid-jump.
    const nearby = this.acquireHumanBuffer();

    for (let i = 0; i < jumps; i++) {
      let next: Human | null = null;
      let bestD2 = range * range;

      this.humansInRadiusInto(source.x, source.y, range, nearby);
      for (const candidate of nearby) {
        if (struck.has(candidate.id) || !candidate.alive) continue;
        const d2 = dist2(source.x, source.y, candidate.x, candidate.y);
        if (d2 < bestD2) {
          bestD2 = d2;
          next = candidate;
        }
      }

      if (!next) break;
      current = current.map((p) => ({ type: p.type, amount: p.amount * falloffPerJump }));

      this.arcs.push({ x1: source.x, y1: source.y, x2: next.x, y2: next.y, life: 0.14 });
      this.sound.lightning(next);
      next.takeDamage(
        { packets: current, sourceLabel, kind: 'chain', dodgeable: false },
        this,
        this.monster,
      );
      next.statuses.apply({ id: 'shock', duration: 3, stacks: 1, sourceLabel });

      struck.add(next.id);
      source = next;
    }

    this.releaseHumanBuffer(nearby);
  }

  /** Run a callback after `delay` seconds of simulated time. */
  scheduleDelayed(delay: number, fn: (world: World) => void): void {
    this.delayed.push({ remaining: delay, fn });
  }

  /**
   * Add a lingering damage zone. Zones tick four times a second and merge with any
   * overlapping zone of the same type, so a wall of fire doesn't become a wall of
   * ten thousand overlapping damage instances.
   */
  addGroundHazard(hazard: Omit<GroundHazard, 'tickTimer' | 'age'>): void {
    for (const existing of this.hazards) {
      if (existing.type !== hazard.type) continue;
      if (dist2(existing.x, existing.y, hazard.x, hazard.y) > (existing.radius * 0.6) ** 2) continue;
      existing.life = Math.max(existing.life, hazard.life);
      existing.dps = Math.max(existing.dps, hazard.dps);
      existing.radius = Math.max(existing.radius, hazard.radius);
      return;
    }

    if (this.hazards.length >= 48) this.hazards.shift();
    this.hazards.push({ ...hazard, tickTimer: 0, age: 0 });
  }

  private updateHazards(dt: number): void {
    // Reused across every hazard this call — each hazard's use is fully consumed
    // (looped over and discarded) before the next one refills it.
    const nearby = this.acquireHumanBuffer();

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hazard = this.hazards[i]!;
      hazard.life -= dt;
      hazard.age += dt;

      if (hazard.life <= 0) {
        this.hazards.splice(i, 1);
        continue;
      }

      hazard.tickTimer -= dt;
      if (hazard.tickTimer > 0) continue;
      hazard.tickTimer = 0.25;

      this.humansInRadiusInto(hazard.x, hazard.y, hazard.radius, nearby);
      for (const human of nearby) {
        human.takeDamage(
          {
            packets: [{ type: hazard.type, amount: hazard.dps * 0.25 }],
            sourceLabel: hazard.sourceLabel,
            kind: 'dot',
            dodgeable: false,
          },
          this,
          this.monster,
        );
        if (hazard.status) human.statuses.apply(hazard.status);
      }

      if (this.rng.next() < 0.85) {
        this.particles.emit({
          count: 2,
          x: hazard.x + this.rng.range(-hazard.radius, hazard.radius) * 0.7,
          y: hazard.y + this.rng.range(-hazard.radius, hazard.radius) * 0.7,
          color: hazard.color,
          shape: hazard.type === 'poison' ? 'smoke' : 'ember',
          speed: [5, 40],
          size: [3, 7],
          life: [0.4, 1],
          additive: hazard.type !== 'poison',
          gravity: hazard.type === 'fire' ? -40 : 0,
        });
      }
    }

    this.releaseHumanBuffer(nearby);
  }

  drawHazards(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const hazard of this.hazards) {
      // Fade in fast, fade out over the last second.
      const alpha = Math.min(1, hazard.age * 4) * Math.min(1, hazard.life);
      const wobble = 1 + Math.sin(hazard.age * 3) * 0.05;
      const grad = ctx.createRadialGradient(
        hazard.x,
        hazard.y,
        0,
        hazard.x,
        hazard.y,
        hazard.radius * wobble,
      );
      grad.addColorStop(0, hazard.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = alpha * 0.32;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(hazard.x, hazard.y, hazard.radius * wobble, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Lightning arcs, drawn above entities. */
  drawArcs(ctx: CanvasRenderingContext2D): void {
    if (this.arcs.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (const arc of this.arcs) {
      const alpha = Math.min(1, arc.life * 8);
      ctx.globalAlpha = alpha;

      // Jagged path: a few midpoints perpendicular to the arc direction.
      const dx = arc.x2 - arc.x1;
      const dy = arc.y2 - arc.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const steps = Math.max(3, Math.floor(len / 26));

      for (const [width, color] of [
        [5, 'rgba(255,240,180,0.35)'],
        [2, '#fffbd0'],
      ] as const) {
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(arc.x1, arc.y1);
        for (let i = 1; i < steps; i++) {
          const k = i / steps;
          const jitter = (this.rng.next() - 0.5) * 18 * Math.sin(k * Math.PI);
          ctx.lineTo(arc.x1 + dx * k + nx * jitter, arc.y1 + dy * k + ny * jitter);
        }
        ctx.lineTo(arc.x2, arc.y2);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- events (called from the damage pipeline) ----------------------------

  flashColorFor(type: DamageType): string {
    return DAMAGE_INFO[type].glow;
  }

  onDamageDealt(
    attacker: Combatant | null,
    target: Combatant,
    result: DamageResult,
    options: DamageOptions,
  ): void {
    const color = DAMAGE_INFO[dominantOf(result)].color;
    this.texts.addDamage(target.x, target.y - target.radius - 6, result.total, color, result.crit);

    if (target.faction === 'human') {
      this.tracker.recordDamageDealt(result.byType, result.total, options.sourceLabel, result.crit);
      if (options.kind === 'attack') this.tracker.projectilesHit++;
      // Damage over time ticks constantly; only real impacts get a sound.
      if (options.kind !== 'dot') this.sound.hit(target, result.crit);

      const dirX = options.dirX ?? 0;
      const dirY = options.dirY ?? 0;
      const angle = Math.atan2(dirY, dirX);
      this.particles.emit({
        count: result.crit ? 12 : 6,
        x: target.x,
        y: target.y,
        color: '#8f1c22',
        shape: 'blob',
        speed: [60, 220],
        size: [1.5, 3.5],
        life: [0.2, 0.45],
        angle: dirX === 0 && dirY === 0 ? undefined : angle,
        spread: 0.9,
        gravity: 240,
      });
      if (result.crit) this.camera.shake(2.5);
    } else {
      this.tracker.recordDamageTaken(result.byType, result.total, options.sourceLabel);
      this.camera.shake(Math.min(9, 2 + result.total * 0.12));
      this.camera.freeze(Math.min(0.09, result.total * 0.002));
      this.sound.hurt(target, result.total / Math.max(1, target.maxHp * 0.3));
    }

    if (attacker && attacker.faction === 'monster' && options.lifesteal) {
      const healed = attacker.heal(result.total * options.lifesteal, this, t('effect.vampirism'));
      if (healed > 0) this.tracker.lifestealHealing += healed;
    }
  }

  onKilled(killer: Combatant | null, victim: Combatant, options: DamageOptions): void {
    void killer;
    void victim;
    void options;
    // Concrete kill accounting lives in Human.onDeath, which knows the archetype.
  }

  onHealed(target: Combatant, amount: number, label: string): void {
    if (target.faction === 'monster') {
      this.tracker.healingReceived += amount;
      this.texts.add(target.x, target.y - target.radius - 14, `+${amount.toFixed(0)}`, '#7fe08a', 14);
    } else {
      this.texts.add(target.x, target.y - target.radius - 10, `+${amount.toFixed(0)}`, '#a7ddb0', 12);
    }
    void label;
  }

  onDodge(target: Combatant): void {
    this.texts.add(target.x, target.y - target.radius - 8, t('effect.dodgeText'), '#9fb4c7', 13);
    this.sound.dodge(target);
    if (target.faction === 'monster') this.tracker.dodgesPerformed++;
  }

  // ---- per-frame -----------------------------------------------------------

  updateEffects(dt: number): void {
    this.particles.update(dt);
    this.texts.update(dt);
    this.updateHazards(dt);

    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i]!;
      arc.life -= dt;
      if (arc.life <= 0) this.arcs.splice(i, 1);
    }

    // Delayed callbacks run after their timer elapses; iterate backwards so a
    // callback that schedules another one doesn't fire in the same frame.
    for (let i = this.delayed.length - 1; i >= 0; i--) {
      const item = this.delayed[i]!;
      item.remaining -= dt;
      if (item.remaining > 0) continue;
      this.delayed.splice(i, 1);
      item.fn(this);
    }
  }

  /** Drop dead entities. Called once per frame after all updates. */
  cull(): void {
    let removedBuilding = false;

    for (let i = this.humans.length - 1; i >= 0; i--) {
      if (!this.humans[i]!.alive) this.humans.splice(i, 1);
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (!this.projectiles[i]!.alive) this.projectiles.splice(i, 1);
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      if (!this.pickups[i]!.alive) this.pickups.splice(i, 1);
    }
    for (const building of this.buildings) {
      if (!building.alive && building.blocking) {
        building.blocking = false;
        removedBuilding = true;
      }
    }

    if (removedBuilding) this.markSolidsDirty();
  }

  get livingHumans(): number {
    let n = 0;
    for (const h of this.humans) if (h.alive) n++;
    return n;
  }

  private readonly drawablesBuffer: Entity[] = [];

  /**
   * All entities that need y-sorted rendering. Reuses the same array every call —
   * safe because the caller (the renderer) only ever sorts and iterates it once
   * per frame before the next call overwrites it, and never holds onto it.
   */
  drawables(): Entity[] {
    const list = this.drawablesBuffer;
    list.length = 0;
    for (const b of this.buildings) list.push(b);
    for (const h of this.humans) list.push(h);
    for (const p of this.pickups) list.push(p);
    list.push(this.monster);
    return list;
  }
}

/** A lingering damage zone left on the ground. */
export interface GroundHazard {
  x: number;
  y: number;
  radius: number;
  /** Seconds remaining. */
  life: number;
  dps: number;
  type: DamageType;
  color: string;
  sourceLabel: string;
  status?: StatusApplication;
  /** Countdown to the next damage tick. */
  tickTimer: number;
  age: number;
}

function dominantOf(result: DamageResult): DamageType {
  let best: DamageType = 'physical';
  let bestAmount = -1;
  for (const key of Object.keys(result.byType) as DamageType[]) {
    const amount = result.byType[key] ?? 0;
    if (amount > bestAmount) {
      bestAmount = amount;
      best = key;
    }
  }
  return best;
}
