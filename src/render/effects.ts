import { clamp, type Rect, TAU } from '../core/math';
import { cosmeticRng } from '../core/rng';
import { blitVisible } from './blit';

export type ParticleShape = 'spark' | 'blob' | 'smoke' | 'shard' | 'ember' | 'ring';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: ParticleShape;
  drag: number;
  gravity: number;
  spin: number;
  rotation: number;
  /** Additive blending reads as light: fire, lightning, magic. */
  additive: boolean;
}

export interface EmitOptions {
  count: number;
  x: number;
  y: number;
  color: string;
  shape?: ParticleShape;
  speed?: [number, number];
  size?: [number, number];
  life?: [number, number];
  /** Restrict emission to a cone around this angle. */
  angle?: number;
  spread?: number;
  drag?: number;
  gravity?: number;
  additive?: boolean;
}

/**
 * Fixed-capacity particle pool. Once full, the oldest particle is recycled rather
 * than growing the array — a hundred humans exploding at once must not stutter.
 */
export class ParticleSystem {
  private readonly pool: Particle[] = [];
  private count = 0;
  private writeCursor = 0;

  constructor(private readonly capacity = 1400) {
    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: '#fff',
        shape: 'spark',
        drag: 2,
        gravity: 0,
        spin: 0,
        rotation: 0,
        additive: false,
      });
    }
  }

  /** Player-set particle density, 0 to 1. */
  densityScale = 1;

  get activeCount(): number {
    return this.count;
  }

  emit(options: EmitOptions): void {
    const {
      count,
      x,
      y,
      color,
      shape = 'spark',
      speed = [40, 160],
      size = [1.5, 4],
      life = [0.25, 0.7],
      angle,
      spread = Math.PI,
      drag = 3,
      gravity = 0,
      additive = false,
    } = options;

    // Density is scaled here, once, rather than at every call site. A burst never
    // drops to nothing: an impact with no particles at all reads as a miss.
    const wanted = count <= 0 ? 0 : Math.max(1, Math.round(count * this.densityScale));

    for (let i = 0; i < wanted; i++) {
      const p = this.acquire();
      const dir =
        angle === undefined
          ? cosmeticRng.next() * TAU
          : angle + cosmeticRng.range(-spread, spread);
      const spd = cosmeticRng.range(speed[0], speed[1]);

      p.x = x;
      p.y = y;
      p.vx = Math.cos(dir) * spd;
      p.vy = Math.sin(dir) * spd;
      p.maxLife = cosmeticRng.range(life[0], life[1]);
      p.life = p.maxLife;
      p.size = cosmeticRng.range(size[0], size[1]);
      p.color = color;
      p.shape = shape;
      p.drag = drag;
      p.gravity = gravity;
      p.rotation = cosmeticRng.next() * TAU;
      p.spin = cosmeticRng.range(-8, 8);
      p.additive = additive;
    }
  }

  /** A single expanding ring — used for explosions, novas and dash puffs. */
  ring(x: number, y: number, color: string, size: number, life = 0.35, additive = true): void {
    const p = this.acquire();
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.maxLife = life;
    p.life = life;
    p.size = size;
    p.color = color;
    p.shape = 'ring';
    p.drag = 0;
    p.gravity = 0;
    p.rotation = 0;
    p.spin = 0;
    p.additive = additive;
  }

  private acquire(): Particle {
    // Ring buffer: overwrite the oldest slot when saturated.
    const p = this.pool[this.writeCursor]!;
    if (p.life <= 0) this.count++;
    this.writeCursor = (this.writeCursor + 1) % this.capacity;
    return p;
  }

  update(dt: number): void {
    let alive = 0;
    for (const p of this.pool) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;

      const dragFactor = Math.exp(-p.drag * dt);
      p.vx *= dragFactor;
      p.vy *= dragFactor;
      p.rotation += p.spin * dt;
      alive++;
    }
    this.count = alive;
  }

  draw(ctx: CanvasRenderingContext2D, view: Rect): void {
    let currentComposite: GlobalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = 'source-over';

    for (const p of this.pool) {
      if (p.life <= 0) continue;
      if (p.x < view.x || p.x > view.x + view.w || p.y < view.y || p.y > view.y + view.h) continue;

      const t = clamp(p.life / p.maxLife, 0, 1);
      const wanted: GlobalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      if (wanted !== currentComposite) {
        ctx.globalCompositeOperation = wanted;
        currentComposite = wanted;
      }

      ctx.globalAlpha = p.shape === 'smoke' ? t * 0.4 : t;
      ctx.fillStyle = p.color;

      switch (p.shape) {
        case 'ring': {
          const r = p.size * (1.4 - t * 0.9);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, 5 * t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, TAU);
          ctx.stroke();
          break;
        }
        case 'shard': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          const s = p.size * t;
          ctx.beginPath();
          ctx.moveTo(-s, -s * 0.4);
          ctx.lineTo(s, 0);
          ctx.lineTo(-s, s * 0.4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'spark': {
          const len = p.size * 2.2;
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > 20) {
            const nx = p.vx / sp;
            const ny = p.vy / sp;
            ctx.strokeStyle = p.color;
            ctx.lineWidth = p.size * t;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - nx * len, p.y - ny * len);
            ctx.stroke();
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * t * 0.6, 0, TAU);
            ctx.fill();
          }
          break;
        }
        case 'smoke': {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (2 - t), 0, TAU);
          ctx.fill();
          break;
        }
        case 'ember':
        case 'blob':
        default: {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * t, 0, TAU);
          ctx.fill();
          break;
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear(): void {
    for (const p of this.pool) p.life = 0;
    this.count = 0;
  }
}

// ---------------------------------------------------------------------------

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  vx: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
  /** Crits and big hits punch up in scale on spawn. */
  emphasis: number;
}

/**
 * Damage numbers. Nearby numbers from the same source merge so a 12-projectile
 * shotgun reads as one big number instead of twelve unreadable ones.
 */
export class FloatingTextSystem {
  private readonly items: FloatingText[] = [];
  private readonly maxItems = 160;

  /** Recent numeric hits keyed by rounded position, for merging. */
  private readonly mergeWindow = new Map<string, { item: FloatingText; value: number }>();
  private mergeClearTimer = 0;

  add(
    x: number,
    y: number,
    text: string,
    color: string,
    size = 14,
    emphasis = 0,
  ): void {
    if (this.items.length >= this.maxItems) this.items.shift();
    this.items.push({
      x,
      y,
      vx: cosmeticRng.range(-18, 18),
      vy: -52 - emphasis * 20,
      life: 0.85 + emphasis * 0.25,
      maxLife: 0.85 + emphasis * 0.25,
      text,
      color,
      size,
      emphasis,
    });
  }

  /** Numeric damage that merges with other hits at the same spot. */
  /** Damage numbers can be turned off; every other floating text stays. */
  showDamageNumbers = true;

  addDamage(x: number, y: number, amount: number, color: string, crit: boolean): void {
    if (!this.showDamageNumbers) return;
    const key = `${Math.round(x / 34)}:${Math.round(y / 34)}:${color}`;
    const existing = this.mergeWindow.get(key);

    if (existing && existing.item.life > existing.item.maxLife - 0.28) {
      existing.value += amount;
      existing.item.text = formatDamage(existing.value);
      existing.item.size = Math.min(30, 14 + Math.log10(Math.max(1, existing.value)) * 5);
      return;
    }

    const emphasis = crit ? 1 : 0;
    this.add(x, y, formatDamage(amount), color, crit ? 20 : 14, emphasis);
    const item = this.items[this.items.length - 1]!;
    this.mergeWindow.set(key, { item, value: amount });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const t = this.items[i]!;
      t.life -= dt;
      if (t.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vy += 90 * dt;
      t.vx *= Math.exp(-2 * dt);
    }

    this.mergeClearTimer -= dt;
    if (this.mergeClearTimer <= 0) {
      this.mergeClearTimer = 0.5;
      for (const [key, entry] of this.mergeWindow) {
        if (entry.item.life <= 0) this.mergeWindow.delete(key);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: Rect): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const t of this.items) {
      if (t.x < view.x || t.x > view.x + view.w || t.y < view.y || t.y > view.y + view.h) continue;

      const k = t.life / t.maxLife;
      // Overshoot scale on spawn, then settle — makes crits feel like they land.
      const pop = t.emphasis > 0 ? 1 + Math.max(0, (k - 0.75) * 4) * 0.35 : 1;
      const alpha = k > 0.7 ? 1 : k / 0.7;

      ctx.globalAlpha = alpha;
      ctx.font = `bold ${(t.size * pop).toFixed(1)}px "Georgia", serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }

    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.items.length = 0;
    this.mergeWindow.clear();
  }
}

export function formatDamage(amount: number): string {
  if (amount >= 10000) return `${(amount / 1000).toFixed(1)}k`;
  if (amount >= 100) return amount.toFixed(0);
  if (amount >= 10) return amount.toFixed(0);
  return amount.toFixed(1);
}

// ---------------------------------------------------------------------------

export interface Decal {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
  rotation: number;
  /** 0 = blood splat, 1 = scorch, 2 = rubble */
  kind: number;
  seed: number;
}

/**
 * Persistent ground marks. They never fade during a room — a razed village should
 * *look* razed by the time you leave it.
 */
export class DecalLayer {
  private readonly decals: Decal[] = [];
  private readonly maxDecals = 900;

  /** Rendered once into an offscreen canvas and only redrawn when new decals land. */
  private cache: HTMLCanvasElement | null = null;
  private cacheDirty = true;
  private cacheOrigin = { x: 0, y: 0 };

  add(x: number, y: number, radius: number, color: string, kind: number, alpha = 0.5): void {
    if (this.decals.length >= this.maxDecals) this.decals.shift();
    this.decals.push({
      x,
      y,
      radius,
      color,
      alpha,
      rotation: cosmeticRng.next() * TAU,
      kind,
      seed: cosmeticRng.next() * 1000,
    });
    this.cacheDirty = true;
  }

  splatter(x: number, y: number, amount: number, color = '#5c1015'): void {
    const drops = Math.min(7, 2 + Math.floor(amount / 14));
    for (let i = 0; i < drops; i++) {
      const a = cosmeticRng.next() * TAU;
      const d = cosmeticRng.range(0, 22 + amount * 0.3);
      this.add(
        x + Math.cos(a) * d,
        y + Math.sin(a) * d,
        cosmeticRng.range(4, 12 + amount * 0.12),
        color,
        0,
        cosmeticRng.range(0.35, 0.65),
      );
    }
  }

  scorch(x: number, y: number, radius: number): void {
    this.add(x, y, radius, '#14100e', 1, 0.55);
  }

  /** Prepare the offscreen cache for an arena of this size. */
  resize(width: number, height: number, originX: number, originY: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    this.cache = canvas;
    this.cacheOrigin = { x: originX, y: originY };
    this.cacheDirty = true;
  }

  private rebuildCache(): void {
    if (!this.cache) return;
    const ctx = this.cache.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, this.cache.width, this.cache.height);
    ctx.save();
    ctx.translate(-this.cacheOrigin.x, -this.cacheOrigin.y);

    for (const d of this.decals) {
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rotation);

      if (d.kind === 0) {
        // Blood: an irregular blob so splats never look like perfect circles.
        ctx.beginPath();
        const lobes = 7;
        for (let i = 0; i <= lobes; i++) {
          const a = (i / lobes) * TAU;
          const wobble = 0.65 + 0.45 * Math.sin(d.seed + i * 2.7);
          const r = d.radius * wobble;
          const px = Math.cos(a) * r;
          const py = Math.sin(a) * r * 0.8;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else if (d.kind === 1) {
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, d.radius);
        grad.addColorStop(0, 'rgba(10,8,6,0.9)');
        grad.addColorStop(0.6, 'rgba(28,20,14,0.5)');
        grad.addColorStop(1, 'rgba(28,20,14,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, d.radius, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(-d.radius, -d.radius * 0.4, d.radius * 2, d.radius * 0.8);
      }

      ctx.restore();
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    this.cacheDirty = false;
  }

  draw(ctx: CanvasRenderingContext2D, view: Rect): void {
    if (!this.cache) return;
    if (this.cacheDirty) this.rebuildCache();
    blitVisible(ctx, this.cache, this.cacheOrigin, view);
  }

  clear(): void {
    this.decals.length = 0;
    this.cacheDirty = true;
  }
}
