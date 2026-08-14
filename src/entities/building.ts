import { clamp, type Rect, TAU } from '../core/math';
import { cosmeticRng, RNG } from '../core/rng';
import { t } from '../i18n';
import type { World } from '../world/world';
import { Entity } from './entity';

export type BuildingKind =
  | 'hut'
  | 'house'
  | 'longhouse'
  | 'granary'
  | 'chapel'
  | 'watchtower'
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

export const BUILDING_PROFILES: Record<BuildingKind, BuildingProfile> = {
  hut: {
    kind: 'hut',
    get name() { return t('building.hut.name'); },
    hp: 120,
    souls: 3,
    occupancy: [0, 2],
    wallColor: '#5d4c3a',
    roofColor: '#7a5c34',
    hasRoof: true,
    opaque: true,
    relicChance: 0.04,
  },
  house: {
    kind: 'house',
    get name() { return t('building.house.name'); },
    hp: 220,
    souls: 6,
    occupancy: [1, 3],
    wallColor: '#6b5741',
    roofColor: '#8a4a32',
    hasRoof: true,
    opaque: true,
    relicChance: 0.07,
  },
  longhouse: {
    kind: 'longhouse',
    get name() { return t('building.longhouse.name'); },
    hp: 400,
    souls: 12,
    occupancy: [2, 5],
    wallColor: '#71604a',
    roofColor: '#6d4230',
    hasRoof: true,
    opaque: true,
    relicChance: 0.14,
  },
  granary: {
    kind: 'granary',
    get name() { return t('building.granary.name'); },
    hp: 180,
    souls: 5,
    occupancy: [0, 1],
    wallColor: '#7d6a4c',
    roofColor: '#9a7b3f',
    hasRoof: true,
    opaque: true,
    relicChance: 0.1,
  },
  chapel: {
    kind: 'chapel',
    get name() { return t('building.chapel.name'); },
    hp: 520,
    souls: 20,
    occupancy: [2, 4],
    wallColor: '#8b8579',
    roofColor: '#4a4f5c',
    hasRoof: true,
    opaque: true,
    relicChance: 0.3,
  },
  watchtower: {
    kind: 'watchtower',
    get name() { return t('building.watchtower.name'); },
    hp: 340,
    souls: 14,
    occupancy: [1, 2],
    wallColor: '#6a625a',
    roofColor: '#3f3a35',
    hasRoof: true,
    opaque: true,
    relicChance: 0.12,
  },
  well: {
    kind: 'well',
    get name() { return t('building.well.name'); },
    hp: 160,
    souls: 2,
    occupancy: [0, 0],
    wallColor: '#5f5c58',
    roofColor: '#4a463f',
    hasRoof: false,
    opaque: false,
    relicChance: 0.02,
  },
  wall: {
    kind: 'wall',
    get name() { return t('building.wall.name'); },
    hp: 600,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#585349',
    roofColor: '#585349',
    hasRoof: false,
    opaque: true,
    relicChance: 0,
  },
  palisade: {
    kind: 'palisade',
    get name() { return t('building.palisade.name'); },
    hp: 260,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#6a5741',
    roofColor: '#6a5741',
    hasRoof: false,
    opaque: false,
    relicChance: 0,
  },
  cart: {
    kind: 'cart',
    get name() { return t('building.cart.name'); },
    hp: 90,
    souls: 2,
    occupancy: [0, 0],
    wallColor: '#6f5a3e',
    roofColor: '#5a4830',
    hasRoof: false,
    opaque: false,
    relicChance: 0.03,
  },
  stack: {
    kind: 'stack',
    get name() { return t('building.stack.name'); },
    hp: 60,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#a8913f',
    roofColor: '#c2a94c',
    hasRoof: false,
    opaque: false,
    relicChance: 0.02,
  },
};

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
      // Fire eats 3% of max HP per second, so a torched village burns down on its own.
      this.takeStructuralDamage(this.maxHp * 0.03 * dt, world);

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
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(4, r.h * 0.42, r.w * 0.54, r.h * 0.22, 0, 0, TAU);
    ctx.fill();

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
    const p = this.profile;

    // Walls.
    ctx.fillStyle = p.wallColor;
    ctx.fillRect(-w / 2, -h / 2, w, h);

    // Vertical timber texture.
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    const planks = Math.floor(w / 14);
    for (let i = 1; i < planks; i++) {
      const px = -w / 2 + (i * w) / planks;
      ctx.beginPath();
      ctx.moveTo(px, -h / 2);
      ctx.lineTo(px, h / 2);
      ctx.stroke();
    }

    if (p.hasRoof) {
      // Roof drawn as an overhanging slab, offset up to fake height.
      const overhang = 7;
      const roofH = h * 0.62;
      ctx.fillStyle = p.roofColor;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - overhang, -h / 2 + 2);
      ctx.lineTo(w / 2 + overhang, -h / 2 + 2);
      ctx.lineTo(w / 2 + overhang * 0.4, -h / 2 - roofH);
      ctx.lineTo(-w / 2 - overhang * 0.4, -h / 2 - roofH);
      ctx.closePath();
      ctx.fill();

      // Ridge highlight.
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w / 2 - overhang * 0.4, -h / 2 - roofH);
      ctx.lineTo(w / 2 + overhang * 0.4, -h / 2 - roofH);
      ctx.stroke();

      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(-w / 2, -h / 2, w, 5);
    }

    if (this.profile.kind === 'chapel') {
      // A crude cross on the ridge — a clear "kill the priests here" landmark.
      ctx.strokeStyle = '#d9cfb6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 - h * 0.62);
      ctx.lineTo(0, -h / 2 - h * 0.62 - 18);
      ctx.moveTo(-6, -h / 2 - h * 0.62 - 12);
      ctx.lineTo(6, -h / 2 - h * 0.62 - 12);
      ctx.stroke();
    }

    // Door and window. Lit while occupied, dark once the family is dead.
    const lit = this.hiddenOccupants > 0;
    ctx.fillStyle = '#2b2118';
    const doorW = Math.min(16, w * 0.22);
    ctx.fillRect(-doorW / 2, h / 2 - Math.min(22, h * 0.5), doorW, Math.min(22, h * 0.5));

    if (w > 54) {
      ctx.fillStyle = lit ? 'rgba(255,190,90,0.85)' : '#241c15';
      const winW = 10;
      ctx.fillRect(-w / 2 + 12, -h / 4, winW, winW);
      ctx.fillRect(w / 2 - 12 - winW, -h / 4, winW, winW);
    }

    // Cracks appear as the structure nears collapse.
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
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, 4, this.rect.w * 0.45, this.rect.h * 0.22, 0, 0, TAU);
    ctx.fill();

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
