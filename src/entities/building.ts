import { BUILDING_BURN_RATE_PER_SECOND, BUILDING_PROFILES } from '../balance';
import { clamp, type Rect, TAU } from '../core/math';
import { cosmeticRng, RNG } from '../core/rng';
import { drawGroundShadow } from '../render/shadow';
import type { World } from '../world/world';
import { Entity } from './entity';

export type BuildingKind =
  | 'hut'
  | 'house'
  | 'longhouse'
  | 'granary'
  | 'chapel'
  | 'watchtower'
  | 'stronghold'
  | 'well'
  | 'wall'
  | 'palisade'
  | 'cart'
  | 'stack';

export interface BuildingProfile {
  readonly kind: BuildingKind;
  readonly name: string;
  readonly hp: number;
  /** Souls awarded for razing it. */
  readonly souls: number;
  /** How many villagers may be hiding inside. */
  readonly occupancy: [number, number];
  readonly wallColor: string;
  readonly roofColor: string;
  /** Structures with no roof (wells, carts) draw flat. */
  readonly hasRoof: boolean;
  /**
   * Whether the structure blocks line of sight and projectiles.
   *
   * Low or open things — palisades, wells, carts, haystacks — still block movement
   * but you can see and shoot over them. Without this distinction a fortified
   * village becomes a maze where the auto-attack almost never finds a target.
   */
  readonly opaque: boolean;
  /** Chance that razing this structure uncovers a relic (a temporary form). */
  readonly relicChance: number;
  readonly indestructible?: boolean;
}
// The actual per-kind numbers live in ../balance now, re-exporting keeps
// every existing from './building' import working unchanged.
export { BUILDING_PROFILES };

/**
 * A structure in the settlement. Buildings block movement and line of sight while
 * standing, and turn into passable rubble once razed — the arena literally opens
 * up as you destroy it.
 */
export class Building extends Entity {
  readonly profile: BuildingProfile;
  readonly rect: Rect;
  hp: number;
  readonly maxHp: number;
  blocking = true;

  /** True while this structure stands and is tall enough to stop sight and shots. */
  get blocksSight(): boolean {
    return this.alive && this.blocking && this.profile.opaque;
  }

  /** Villagers that spill out when the structure comes down. */
  hiddenOccupants = 0;

  /** 0..1, drives the shake-and-crack visual. */
  private damageFlash = 0;
  private burning = 0;
  private readonly seed: number;
  /** Rubble chunk offsets, generated once on destruction. */
  private rubble: Array<{ x: number; y: number; w: number; h: number; a: number }> = [];

  /**
   * Baked walls/roof/crenellations/turret for `drawStructure`, so a standing
   * building's unchanging silhouette isn't re-stroked plank-by-plank every frame.
   * Only `hiddenOccupants > 0` (the lit-window state) can change after construction,
   * so that's the only thing that invalidates it — cracks depend continuously on
   * HP and are drawn live over the cache instead of rebaking on every hit.
   */
  private staticCache: HTMLCanvasElement | null = null;
  private staticCacheLit: boolean | null = null;
  private cacheOriginX = 0;
  private cacheOriginY = 0;

  constructor(kind: BuildingKind, rect: Rect, rng: RNG, hpScale = 1) {
    super();
    this.profile = BUILDING_PROFILES[kind];
    this.rect = rect;
    this.maxHp = this.profile.hp * hpScale;
    this.hp = this.maxHp;
    this.faction = 'human';
    this.seed = rng.next() * 1000;
    this.x = rect.x + rect.w / 2;
    this.y = rect.y + rect.h / 2;
    this.radius = Math.max(rect.w, rect.h) / 2;

    const [minOcc, maxOcc] = this.profile.occupancy;
    this.hiddenOccupants = maxOcc > 0 ? rng.int(minOcc, maxOcc) : 0;
  }

  /** Buildings ignore the elemental pipeline — they only care about raw force. */
  takeStructuralDamage(amount: number, world: World): void {
    if (!this.alive || this.profile.indestructible || amount <= 0) return;

    this.hp -= amount;
    this.damageFlash = 1;
    world.sound.buildingHit(this);

    world.particles.emit({
      count: 4,
      x: this.x + world.rng.range(-this.rect.w / 3, this.rect.w / 3),
      y: this.y + world.rng.range(-this.rect.h / 3, this.rect.h / 3),
      color: this.profile.wallColor,
      shape: 'shard',
      speed: [50, 160],
      size: [2, 5],
      life: [0.3, 0.7],
      gravity: 300,
    });

    if (this.hp <= 0) this.collapse(world);
  }

  ignite(seconds: number): void {
    this.burning = Math.max(this.burning, seconds);
  }

  private collapse(world: World): void {
    this.alive = false;
    this.blocking = false;
    // Rubble draws from `rubble`, never the baked structure — free it now rather
    // than waiting for the room to end.
    this.staticCache = null;
    world.markSolidsDirty();

    world.camera.shake(6);
    world.sound.buildingCollapse(this);
    world.decals.scorch(this.x, this.y, Math.max(this.rect.w, this.rect.h) * 0.6);

    world.particles.emit({
      count: 26,
      x: this.x,
      y: this.y,
      color: this.profile.wallColor,
      shape: 'shard',
      speed: [60, 300],
      size: [3, 9],
      life: [0.4, 1.1],
      gravity: 420,
      drag: 1.5,
    });
    world.particles.emit({
      count: 16,
      x: this.x,
      y: this.y,
      color: '#3a332c',
      shape: 'smoke',
      speed: [20, 90],
      size: [10, 24],
      life: [0.9, 1.8],
      drag: 1,
    });

    // Generate the rubble silhouette once so it stays stable across frames.
    const rng = new RNG(Math.floor(this.seed * 7919));
    const chunks = 5 + Math.floor(this.rect.w / 40);
    this.rubble = [];
    for (let i = 0; i < chunks; i++) {
      this.rubble.push({
        x: rng.range(-this.rect.w / 2.4, this.rect.w / 2.4),
        y: rng.range(-this.rect.h / 3, this.rect.h / 3),
        w: rng.range(10, Math.max(14, this.rect.w / 3)),
        h: rng.range(6, Math.max(9, this.rect.h / 4)),
        a: rng.range(-0.5, 0.5),
      });
    }

    world.tracker.recordBuildingDestroyed();
    world.spawnPickup('soul', this.x, this.y, this.profile.souls);

    // Bigger structures sometimes hide a relic. Razing the village is optional, so
    // it needs a reward beyond souls to be worth the detour.
    if (world.rng.next() < this.profile.relicChance) {
      world.spawnBoon(this.x, this.y);
    }
    world.texts.add(this.x, this.y - this.rect.h / 2, this.profile.name.toUpperCase(), '#c9a227', 15);

    // Anyone hiding inside runs out into the open.
    if (this.hiddenOccupants > 0) {
      world.onBuildingBreached?.(this, this.hiddenOccupants);
      this.hiddenOccupants = 0;
    }
  }

  override update(dt: number, world: World): void {
    this.age += dt;
    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 4);

    if (this.burning > 0 && this.alive) {
      this.burning -= dt;
      // Fire eats BUILDING_BURN_RATE_PER_SECOND of max HP per second, so a torched
      // village burns down on its own.
      this.takeStructuralDamage(this.maxHp * BUILDING_BURN_RATE_PER_SECOND * dt, world);

      if (world.rng.next() < dt * 14) {
        world.particles.emit({
          count: 1,
          x: this.x + world.rng.range(-this.rect.w / 2, this.rect.w / 2),
          y: this.y + world.rng.range(-this.rect.h / 2, this.rect.h / 4),
          color: world.rng.bool(0.6) ? '#ff8a3c' : '#ffd27a',
          shape: 'ember',
          speed: [10, 60],
          size: [2, 5],
          life: [0.4, 1],
          angle: -Math.PI / 2,
          spread: 0.7,
          additive: true,
          gravity: -60,
        });
      }
    }
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;

    if (!this.alive) {
      this.drawRubble(ctx);
      return;
    }

    const healthFrac = clamp(this.hp / this.maxHp, 0, 1);
    // Structures visibly lean and jitter as they take damage. Cosmetic randomness
    // only — the gameplay RNG must stay untouched by rendering.
    const shake = this.damageFlash * 3;
    const lean = (1 - healthFrac) * 0.05 * Math.sin(this.seed);

    ctx.save();
    ctx.translate(this.x + (cosmeticRng.next() - 0.5) * shake, this.y);
    ctx.rotate(lean);

    // Drop shadow grounds the building on the terrain.
    drawGroundShadow(ctx, 4, r.h * 0.42, r.w * 0.54, r.h * 0.22);

    if (this.profile.kind === 'well') {
      this.drawWell(ctx);
    } else if (this.profile.kind === 'stack') {
      this.drawStack(ctx);
    } else if (this.profile.kind === 'cart') {
      this.drawCart(ctx);
    } else if (this.profile.kind === 'palisade' || this.profile.kind === 'wall') {
      this.drawWall(ctx);
    } else {
      this.drawStructure(ctx, healthFrac);
    }

    if (this.damageFlash > 0) {
      ctx.globalAlpha = this.damageFlash * 0.5;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  private drawStructure(ctx: CanvasRenderingContext2D, healthFrac: number): void {
    const r = this.rect;
    const w = r.w;
    const h = r.h;

    const lit = this.hiddenOccupants > 0;
    if (!this.staticCache || this.staticCacheLit !== lit) this.bakeStaticCache(lit);
    ctx.drawImage(this.staticCache!, -this.cacheOriginX, -this.cacheOriginY);

    // Cracks depend continuously on HP, so they're drawn live over the cache
    // instead of forcing a rebake on every hit the building takes.
    if (healthFrac < 0.65) {
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1.6;
      const cracks = Math.round((1 - healthFrac) * 5);
      for (let i = 0; i < cracks; i++) {
        const sx = -w / 2 + ((this.seed * (i + 3)) % 1) * w;
        ctx.beginPath();
        ctx.moveTo(sx, -h / 2);
        ctx.lineTo(sx + Math.sin(this.seed + i) * 12, 0);
        ctx.lineTo(sx + Math.cos(this.seed + i * 2) * 16, h / 2);
        ctx.stroke();
      }
    }
  }

  /**
   * Bake the walls/planks/roof/chapel-cross/crenellations/turret/door/window into
   * `staticCache`, in local building-space (origin at the rect's centre, same as
   * every other draw method here) so `drawStructure` can blit it unchanged.
   */
  private bakeStaticCache(lit: boolean): void {
    const w = this.rect.w;
    const h = this.rect.h;
    const p = this.profile;

    // Generous fixed padding rather than exact per-shape bounds — cheap in memory
    // for a per-room, per-building canvas, and safe against clipping the tallest
    // roof/cross/turret combination without having to keep this in sync with them.
    const topPad = h + 80;
    const sidePad = 40;
    const botPad = 20;
    this.cacheOriginX = sidePad + w / 2;
    this.cacheOriginY = topPad + h / 2;

    const canvas = this.staticCache ?? document.createElement('canvas');
    canvas.width = Math.ceil(w + sidePad * 2);
    canvas.height = Math.ceil(topPad + h + botPad);
    const cctx = canvas.getContext('2d')!;
    cctx.clearRect(0, 0, canvas.width, canvas.height);
    cctx.save();
    cctx.translate(this.cacheOriginX, this.cacheOriginY);

    // Walls.
    cctx.fillStyle = p.wallColor;
    cctx.fillRect(-w / 2, -h / 2, w, h);

    // Vertical timber texture.
    cctx.strokeStyle = 'rgba(0,0,0,0.16)';
    cctx.lineWidth = 1;
    const planks = Math.floor(w / 14);
    for (let i = 1; i < planks; i++) {
      const px = -w / 2 + (i * w) / planks;
      cctx.beginPath();
      cctx.moveTo(px, -h / 2);
      cctx.lineTo(px, h / 2);
      cctx.stroke();
    }

    if (p.hasRoof) {
      // Roof drawn as an overhanging slab, offset up to fake height.
      const overhang = 7;
      const roofH = h * 0.62;
      cctx.fillStyle = p.roofColor;
      cctx.beginPath();
      cctx.moveTo(-w / 2 - overhang, -h / 2 + 2);
      cctx.lineTo(w / 2 + overhang, -h / 2 + 2);
      cctx.lineTo(w / 2 + overhang * 0.4, -h / 2 - roofH);
      cctx.lineTo(-w / 2 - overhang * 0.4, -h / 2 - roofH);
      cctx.closePath();
      cctx.fill();

      // Ridge highlight.
      cctx.strokeStyle = 'rgba(255,255,255,0.12)';
      cctx.lineWidth = 2;
      cctx.beginPath();
      cctx.moveTo(-w / 2 - overhang * 0.4, -h / 2 - roofH);
      cctx.lineTo(w / 2 + overhang * 0.4, -h / 2 - roofH);
      cctx.stroke();

      cctx.fillStyle = 'rgba(0,0,0,0.22)';
      cctx.fillRect(-w / 2, -h / 2, w, 5);
    }

    if (this.profile.kind === 'chapel') {
      // A crude cross on the ridge — a clear "kill the priests here" landmark.
      cctx.strokeStyle = '#d9cfb6';
      cctx.lineWidth = 3;
      cctx.beginPath();
      cctx.moveTo(0, -h / 2 - h * 0.62);
      cctx.lineTo(0, -h / 2 - h * 0.62 - 18);
      cctx.moveTo(-6, -h / 2 - h * 0.62 - 12);
      cctx.lineTo(6, -h / 2 - h * 0.62 - 12);
      cctx.stroke();
    }

    if (this.profile.kind === 'stronghold' || this.profile.kind === 'watchtower') {
      // Crenellations along the wall top — the parapet a shielded defender stands
      // behind, on both towers. The stronghold gets an extra corner turret below.
      cctx.fillStyle = p.wallColor;
      const merlonW = 10;
      for (let mx = -w / 2 + 4; mx < w / 2 - 4; mx += merlonW * 1.8) {
        cctx.fillRect(mx, -h / 2 - 6, merlonW, 8);
      }
    }

    if (this.profile.kind === 'stronghold') {
      // A corner turret rising above the roofline — what makes this read as a
      // castle rather than a bigger house, since the siege engine it fields never
      // leaves that turret.
      const turretX = w / 2 - 16;
      const turretTop = -h / 2 - h * 0.62 - 14;
      cctx.fillStyle = p.wallColor;
      cctx.fillRect(turretX - 12, turretTop, 24, h / 2 + h * 0.62 + 14);
      cctx.fillStyle = p.roofColor;
      cctx.beginPath();
      cctx.moveTo(turretX - 14, turretTop);
      cctx.lineTo(turretX + 14, turretTop);
      cctx.lineTo(turretX, turretTop - 16);
      cctx.closePath();
      cctx.fill();
      for (let mx = turretX - 10; mx <= turretX + 10; mx += 8) {
        cctx.fillRect(mx, turretTop - 4, 4, 6);
      }
    }

    // Door and window. Lit while occupied, dark once the family is dead.
    cctx.fillStyle = '#2b2118';
    const doorW = Math.min(16, w * 0.22);
    cctx.fillRect(-doorW / 2, h / 2 - Math.min(22, h * 0.5), doorW, Math.min(22, h * 0.5));

    if (w > 54) {
      cctx.fillStyle = lit ? 'rgba(255,190,90,0.85)' : '#241c15';
      const winW = 10;
      cctx.fillRect(-w / 2 + 12, -h / 4, winW, winW);
      cctx.fillRect(w / 2 - 12 - winW, -h / 4, winW, winW);
    }

    cctx.restore();
    this.staticCache = canvas;
    this.staticCacheLit = lit;
  }

  private drawWall(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.fillStyle = this.profile.wallColor;
    ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h);

    // Sharpened stake tops along the long axis.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    const horizontal = r.w >= r.h;
    const count = Math.floor((horizontal ? r.w : r.h) / 11);
    for (let i = 0; i < count; i++) {
      if (horizontal) {
        const px = -r.w / 2 + i * 11;
        ctx.beginPath();
        ctx.moveTo(px, -r.h / 2);
        ctx.lineTo(px + 5.5, -r.h / 2 - 6);
        ctx.lineTo(px + 11, -r.h / 2);
        ctx.closePath();
        ctx.fill();
      } else {
        const py = -r.h / 2 + i * 11;
        ctx.fillRect(-r.w / 2, py, r.w, 1.4);
      }
    }
  }

  private drawWell(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.fillStyle = this.profile.wallColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, r.w / 2, r.h / 2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111820';
    ctx.beginPath();
    ctx.ellipse(0, 0, r.w / 2 - 6, r.h / 2 - 6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#4a463f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-r.w / 2 + 4, -r.h / 2 - 14);
    ctx.lineTo(r.w / 2 - 4, -r.h / 2 - 14);
    ctx.stroke();
  }

  private drawStack(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.fillStyle = this.profile.wallColor;
    ctx.beginPath();
    ctx.moveTo(-r.w / 2, r.h / 2);
    ctx.quadraticCurveTo(0, -r.h * 0.9, r.w / 2, r.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 6, r.h / 2);
      ctx.lineTo(i * 3, -r.h * 0.35);
      ctx.stroke();
    }
  }

  private drawCart(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.fillStyle = this.profile.wallColor;
    ctx.fillRect(-r.w / 2, -r.h / 2, r.w, r.h * 0.7);
    ctx.fillStyle = '#3a2f22';
    for (const wx of [-r.w / 3, r.w / 3]) {
      ctx.beginPath();
      ctx.arc(wx, r.h * 0.3, r.h * 0.3, 0, TAU);
      ctx.fill();
    }
  }

  private drawRubble(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(this.x, this.y);
    drawGroundShadow(ctx, 0, 4, this.rect.w * 0.45, this.rect.h * 0.22, 0.28);

    for (const chunk of this.rubble) {
      ctx.save();
      ctx.translate(chunk.x, chunk.y);
      ctx.rotate(chunk.a);
      ctx.fillStyle = this.profile.wallColor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(-chunk.w / 2, -chunk.h / 2, chunk.w, chunk.h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-chunk.w / 2, chunk.h / 2 - 2, chunk.w, 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
