import { TAU } from '../core/math';
import { type BoonDef } from '../progression/boons';
import type { World } from '../world/world';
import { Entity } from './entity';

export type PickupKind = 'soul' | 'blood' | 'ember' | 'boon';

interface PickupStyle {
  color: string;
  glow: string;
  size: number;
}

const STYLES: Record<PickupKind, PickupStyle> = {
  soul: { color: '#9fd7ff', glow: '#dff2ff', size: 4.5 },
  blood: { color: '#c0343c', glow: '#ff8a92', size: 5.5 },
  ember: { color: '#ffb347', glow: '#ffe0a0', size: 5 },
  boon: { color: '#d8a13a', glow: '#fff2c0', size: 11 },
};

/**
 * Loot dropped by the dead. Souls are the meta currency, blood heals, embers give
 * a short burst of attack speed. All of them home in once inside the pickup radius,
 * which is itself an upgradeable stat.
 */
export class Pickup extends Entity {
  readonly kind: PickupKind;
  value: number;

  /** Short delay before magnetism kicks in, so drops visibly scatter first. */
  private settleTime = 0.25;
  private attracted = false;
  private readonly bobPhase: number;

  /** Despawn guard so a skipped pile of loot doesn't leak across rooms. */
  private lifetime = 60;

  /**
   * Pull this pickup in from any distance.
   *
   * Called when a settlement falls: souls now feed experience, so leaving half a
   * room's drops scattered behind you would quietly cost the player levels.
   */
  forceAttract(): void {
    this.attracted = true;
    this.settleTime = 0;
    this.lifetime = Math.max(this.lifetime, 12);
  }

  /** Set for `boon` pickups: the form granted on contact. */
  readonly boon: BoonDef | null;

  constructor(kind: PickupKind, x: number, y: number, value: number, boon: BoonDef | null = null) {
    super();
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.value = value;
    this.radius = STYLES[kind].size;
    this.faction = 'neutral';
    this.bobPhase = Math.random() * TAU;
    this.boon = boon;
    // Relics are landmarks, not litter: they wait for you and are never magnetised
    // away by the end-of-room sweep timer.
    if (kind === 'boon') this.lifetime = Infinity;
  }

  override update(dt: number, world: World): void {
    this.age += dt;
    this.lifetime -= dt;
    if (this.lifetime <= 0) {
      this.alive = false;
      return;
    }

    if (this.settleTime > 0) {
      this.settleTime -= dt;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const drag = Math.exp(-6 * dt);
      this.vx *= drag;
      this.vy *= drag;
      return;
    }

    const monster = world.monster;
    const dx = monster.x - this.x;
    const dy = monster.y - this.y;
    const distance = Math.hypot(dx, dy);
    const pickupRadius = monster.stats.get('pickupRadius');

    // Once attracted, stay attracted — otherwise loot stutters at the radius edge.
    if (!this.attracted && distance < pickupRadius) this.attracted = true;

    if (this.attracted) {
      // Accelerating pull feels far better than constant speed. Drops summoned
      // from across a cleared arena need a much stronger tug or they never arrive.
      const closeness = 1 - Math.min(1, distance / pickupRadius);
      const pull = distance > pickupRadius ? 1400 : 420 + closeness * 900;
      const inv = distance > 1e-4 ? 1 / distance : 0;
      this.vx += dx * inv * pull * dt;
      this.vy += dy * inv * pull * dt;
      const drag = Math.exp(-3 * dt);
      this.vx *= drag;
      this.vy *= drag;
      this.x += this.vx * dt;
      this.y += this.vy * dt;

      if (distance < monster.radius + this.radius) this.collect(world);
    }
  }

  private collect(world: World): void {
    this.alive = false;
    const style = STYLES[this.kind];

    world.particles.emit({
      count: 6,
      x: this.x,
      y: this.y,
      color: style.glow,
      shape: 'spark',
      speed: [30, 120],
      size: [1.5, 3],
      life: [0.2, 0.4],
      additive: true,
    });

    switch (this.kind) {
      case 'soul': {
        const gained = this.value * world.monster.stats.get('soulGain');
        world.monster.gainSouls(gained, world);
        break;
      }
      case 'blood': {
        const healed = this.value * world.monster.stats.get('healingReceived');
        world.monster.heal(healed, world, 'Кровь');
        break;
      }
      case 'ember': {
        world.monster.grantFrenzy(this.value, world);
        break;
      }
      case 'boon': {
        if (this.boon) world.monster.grantBoon(this.boon, world);
        break;
      }
    }
  }

  override draw(ctx: CanvasRenderingContext2D): void {
    if (this.kind === 'boon') {
      this.drawRelic(ctx);
      return;
    }

    const style = STYLES[this.kind];
    const bob = Math.sin(this.age * 4 + this.bobPhase) * 2.5;
    const pulse = 0.75 + 0.25 * Math.sin(this.age * 7 + this.bobPhase);

    ctx.save();
    ctx.translate(this.x, this.y + bob);

    ctx.globalCompositeOperation = 'lighter';
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius * 4.5 * pulse);
    grad.addColorStop(0, style.glow);
    grad.addColorStop(0.35, style.color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 4.5 * pulse, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = style.glow;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * pulse, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * A relic offering a temporary form.
   *
   * Deliberately much louder than a soul mote: a floating shard in the boon's own
   * colour, ringed by a slowly turning halo, so it reads as "go and get that" from
   * across the settlement.
   */
  private drawRelic(ctx: CanvasRenderingContext2D): void {
    const color = this.boon?.color ?? STYLES.boon.color;
    const bob = Math.sin(this.age * 2.2 + this.bobPhase) * 4;
    const spin = this.age * 1.1;
    const pulse = 0.85 + 0.15 * Math.sin(this.age * 3 + this.bobPhase);

    ctx.save();
    ctx.translate(this.x, this.y);

    // Ground pool of light, so it stands out even behind a building corner.
    ctx.globalCompositeOperation = 'lighter';
    const pool = ctx.createRadialGradient(0, 6, 0, 0, 6, 46 * pulse);
    pool.addColorStop(0, hexAlpha(color, 0.4));
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(0, 6, 46 * pulse, 20 * pulse, 0, 0, TAU);
    ctx.fill();

    ctx.translate(0, bob - 10);

    // Halo ring.
    ctx.strokeStyle = hexAlpha(color, 0.75);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = spin + (i / 8) * TAU;
      const r0 = 17;
      const r1 = 23;
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.55);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.55);
    }
    ctx.stroke();

    // The shard itself.
    ctx.rotate(Math.sin(spin) * 0.25);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.35, color);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, TAU);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0d0a10';
    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 13);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }
}

/** #rrggbb + alpha -> rgba() string. */
function hexAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
