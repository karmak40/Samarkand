import { clamp, damp, type Rect, type Vec2 } from './math';
import { cosmeticRng } from './rng';

/**
 * Follows the monster with a soft lead toward where it is heading, clamped so the
 * view never leaves the arena. Also owns screen shake and hit-stop.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  /** Viewport size in world units (updated by the renderer on resize). */
  viewW = 1280;
  viewH = 720;

  private shakeAmount = 0;
  private shakeDecay = 6;
  private shakeX = 0;
  private shakeY = 0;

  /** Frozen frames after a big hit, in seconds. The game loop consumes this. */
  private hitStop = 0;

  private bounds: Rect | null = null;

  setBounds(bounds: Rect | null): void {
    this.bounds = bounds;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToBounds();
  }

  /**
   * @param leadX/leadY  velocity of the target; the camera looks slightly ahead of it
   */
  follow(target: Vec2, leadX: number, leadY: number, dt: number): void {
    const leadScale = 0.22;
    const desiredX = target.x + leadX * leadScale;
    const desiredY = target.y + leadY * leadScale;

    this.x = damp(this.x, desiredX, 7, dt);
    this.y = damp(this.y, desiredY, 7, dt);
    this.clampToBounds();
  }

  private clampToBounds(): void {
    if (!this.bounds) return;
    const halfW = this.viewW / (2 * this.zoom);
    const halfH = this.viewH / (2 * this.zoom);
    const b = this.bounds;

    // When the arena is narrower than the view, centre on it instead of clamping.
    if (b.w < halfW * 2) this.x = b.x + b.w / 2;
    else this.x = clamp(this.x, b.x + halfW, b.x + b.w - halfW);

    if (b.h < halfH * 2) this.y = b.y + b.h / 2;
    else this.y = clamp(this.y, b.y + halfH, b.y + b.h - halfH);
  }

  /**
   * Scales every shake request, 0 to 1.
   *
   * Set from the player's comfort setting rather than checked at each of the fifteen
   * call sites — those know how hard the hit was, not how much motion this person can
   * take, and a flag threaded through all of them would be forgotten by the sixteenth.
   */
  shakeScale = 1;

  /** Additive: the strongest recent shake wins rather than stacking into nausea. */
  shake(requested: number, decay = 6): void {
    const amount = requested * this.shakeScale;
    if (amount > this.shakeAmount) {
      this.shakeAmount = amount;
      this.shakeDecay = decay;
    }
  }

  freeze(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds);
  }

  /** Returns the dt the simulation should use — zero while hit-stop is active. */
  consumeHitStop(dt: number): number {
    if (this.hitStop <= 0) return dt;
    this.hitStop -= dt;
    return 0;
  }

  update(dt: number): void {
    if (this.shakeAmount > 0.01) {
      this.shakeAmount = Math.max(0, this.shakeAmount - this.shakeAmount * this.shakeDecay * dt);
      this.shakeX = cosmeticRng.gaussian(0, this.shakeAmount);
      this.shakeY = cosmeticRng.gaussian(0, this.shakeAmount);
    } else {
      this.shakeAmount = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** Apply the world transform to a context. Caller is responsible for save/restore. */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x + this.shakeX, -this.y + this.shakeY);
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.viewW / 2) / this.zoom + this.x - this.shakeX,
      y: (sy - this.viewH / 2) / this.zoom + this.y - this.shakeY,
    };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: (wx - this.x + this.shakeX) * this.zoom + this.viewW / 2,
      y: (wy - this.y + this.shakeY) * this.zoom + this.viewH / 2,
    };
  }

  /** Generous cull rect in world space, so effects near the edge don't pop. */
  visibleRect(padding = 128): Rect {
    const halfW = this.viewW / (2 * this.zoom) + padding;
    const halfH = this.viewH / (2 * this.zoom) + padding;
    return { x: this.x - halfW, y: this.y - halfH, w: halfW * 2, h: halfH * 2 };
  }
}
