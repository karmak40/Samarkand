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
import { Combatant, type DeathContext, type Entity } from '../entities/entity';
import type { Building } from '../entities/building';
import type { Human, HumanId } from '../entities/human';
import type { Monster } from '../entities/monster';
import { Pickup, type PickupKind } from '../entities/pickup';
import { rollBoon } from '../progression/boons';
import { Projectile, type ProjectileConfig } from '../entities/projectile';
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

  constructor(rng: RNG, tracker: RunStats, camera: Camera) {
    this.rng = rng;
    this.tracker = tracker;
    this.camera = camera;
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

  /** Every living human within `radius` of a point. Allocates one array per call. */
  humansInRadius(x: number, y: number, radius: number): Human[] {
    const out: Human[] = [];
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
   * Closest living human to a point, optionally requiring line of sight.
   * This is the auto-aim query, so it runs every frame and avoids allocation.
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

    for (const human of this.humans) {
      if (!human.alive || human === exclude) continue;
      if (human.untargetable) continue;
      const d2 = dist2(x, y, human.x, human.y);
      if (d2 >= bestD2) continue;
      if (requireLineOfSight && !this.hasLineOfSight(x, y, human.x, human.y)) continue;
      best = human;
      bestD2 = d2;
    }
    return best;
  }

  hasLineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    for (const rect of this.sightRects) {
      if (segmentRectHit(ax, ay, bx, by, rect)) return false;
    }
    return true;
  }

  /** Push a circle out of every solid and the arena walls. Returns true if moved. */
  collideWithWorld(entity: { x: number; y: number; radius: number }): boolean {
    let moved = false;

    for (const rect of this.solidRects) {
      if (!circleRectOverlap(entity.x, entity.y, entity.radius, rect)) continue;
      const fixed = resolveCircleRect(entity.x, entity.y, entity.radius, rect);
      if (fixed) {
        entity.x = fixed.x;
        entity.y = fixed.y;
        moved = true;
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
    const def = rollBoon(this.rng, active);
    const pickup = new Pickup('boon', x, y, 1, def);
    this.pickups.push(pickup);

    this.particles.ring(x, y, def.color, 70, 0.6);
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

    for (const human of this.humansInRadius(x, y, radius)) {
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

    for (let i = 0; i < jumps; i++) {
      let next: Human | null = null;
      let bestD2 = range * range;

      for (const candidate of this.humansInRadius(source.x, source.y, range)) {
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
      next.takeDamage(
        { packets: current, sourceLabel, kind: 'chain', dodgeable: false },
        this,
        this.monster,
      );
      next.statuses.apply({ id: 'shock', duration: 3, stacks: 1, sourceLabel });

      struck.add(next.id);
      source = next;
    }
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

      for (const human of this.humansInRadius(hazard.x, hazard.y, hazard.radius)) {
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
    }

    if (attacker && attacker.faction === 'monster' && options.lifesteal) {
      const healed = attacker.heal(result.total * options.lifesteal, this, 'Вампиризм');
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
    this.texts.add(target.x, target.y - target.radius - 8, 'мимо', '#9fb4c7', 13);
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

  /** All entities that need y-sorted rendering. */
  drawables(): Entity[] {
    const list: Entity[] = [];
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
