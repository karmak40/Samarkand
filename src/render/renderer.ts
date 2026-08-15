import { Camera } from '../core/camera';
import { clamp, TAU, type Vec2 } from '../core/math';
import { t } from '../i18n';
import type { World } from '../world/world';
import { hexAlpha } from './monster-render';
import { Terrain } from './terrain';

/**
 * Owns the canvas, the device-pixel-ratio dance and the draw order.
 *
 * Layer order (bottom to top): terrain, decals, ground hazards, y-sorted entities,
 * projectiles, lightning arcs, particles, damage numbers, vignette. UI is drawn
 * afterwards in screen space by the HUD.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain = new Terrain();

  /** CSS pixel size of the viewport. */
  width = 0;
  height = 0;
  private dpr = 1;

  private observer: ResizeObserver | null = null;

  /** Baked edge darkening, rebuilt only when the viewport changes shape. */
  private vignette: HTMLCanvasElement | null = null;
  private vignetteSize = { w: 0, h: 0, dpr: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize();

    // The first resize can land before layout has settled, which would leave the
    // backing store at 1x1 forever. Observing the element covers that and every
    // later layout change without polling getBoundingClientRect each frame.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Re-read the element size and rescale the backing store. */
  resize(): void {
    // Cap DPR at 2: beyond that the fill-rate cost outweighs the sharpness gain.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));

    const bw = Math.round(this.width * this.dpr);
    const bh = Math.round(this.height * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /**
   * Re-read the size if the element changed shape.
   *
   * ResizeObserver covers the normal case, but it does not fire in every embedding
   * — a pane that is never displayed can leave the backing store at 1x1 forever
   * while the element itself reports a real rect. One rect read per frame is far
   * cheaper than shipping a game that renders into a single pixel.
   */
  private syncSize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== this.width || h !== this.height) this.resize();
  }

  /** Apply the DPR transform and clear. Call once per frame. */
  begin(): void {
    this.syncSize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, this.width, this.height);
  }

  syncCamera(camera: Camera): void {
    camera.viewW = this.width;
    camera.viewH = this.height;

    // Zoom to keep the monster a readable size on any window. At 1:1 the creature
    // is a ~36px smudge and none of its procedural detail reads; tying zoom to
    // viewport height keeps roughly the same number of body-widths on screen.
    const heightZoom = clamp(this.height / 460, 1.4, 2.4);

    // A phone in portrait has plenty of height but little width, and zooming by
    // height alone was cropping ranged attackers out of the frame while they were
    // still well inside firing range — the first anyone knew of an archer was the
    // arrow. This guarantees a minimum width of world space is visible too, and
    // whichever axis is more constrained wins. Landscape windows already show more
    // than this much width, so the desktop view is untouched; only narrow windows
    // pull back.
    const MIN_VIEW_WIDTH = 460;
    const widthZoom = this.width / MIN_VIEW_WIDTH;

    camera.zoom = clamp(Math.min(heightZoom, widthZoom), 0.6, 2.4);
  }

  drawWorld(
    world: World,
    camera: Camera,
    exit: Vec2 | null,
    exitOpen: boolean,
    aim: Vec2 | null = null,
  ): void {
    const ctx = this.ctx;
    const view = camera.visibleRect();

    ctx.save();
    camera.applyTransform(ctx);

    this.terrain.draw(ctx, view);
    world.decals.draw(ctx, view);
    world.drawHazards(ctx);
    // On the ground, under everything that walks on it: a reticle drawn over the
    // crowd would hide the very thing being aimed at.
    this.drawAbilityAim(ctx, world, aim);

    if (exit && exitOpen) {
      this.drawExit(ctx, exit, world.time);
      this.drawExitGuide(ctx, world, exit);
    }

    // Y-sorted entities so things closer to the camera overlap correctly.
    const drawables = world.drawables();
    drawables.sort((a, b) => a.y - b.y);
    for (const entity of drawables) {
      if (entity.x < view.x || entity.x > view.x + view.w) continue;
      if (entity.y < view.y - 200 || entity.y > view.y + view.h + 200) continue;
      entity.draw(ctx, world);
    }

    for (const projectile of world.projectiles) projectile.draw(ctx, world);

    world.drawArcs(ctx);
    world.particles.draw(ctx, view);
    world.texts.draw(ctx, view);

    ctx.restore();

    this.drawVignette();
    this.drawOffscreenMarkers(world, camera);
    if (exit && exitOpen) this.drawExitEdgeMarker(camera, exit);
  }

  /**
   * Where the gift is pointed, and what it is about to do.
   *
   * Two marks in one place. The reticle follows the cursor whenever a gift is held
   * and ready — that is the only thing making the mouse visibly alive. The telegraph
   * is the committed cast: a ring that fills as its windup runs out, so both the
   * player and anyone watching can see exactly where and when it lands.
   */
  private drawAbilityAim(ctx: CanvasRenderingContext2D, world: World, aim: Vec2 | null): void {
    const monster = world.monster;
    const cast = monster.pendingCast;

    if (cast) {
      const progress = clamp(1 - cast.timer / Math.max(0.0001, cast.total), 0, 1);
      const radius = cast.def.radius * monster.stats.get('areaSize');

      ctx.save();
      ctx.translate(cast.x, cast.y);

      ctx.fillStyle = hexAlpha(cast.def.color, 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.fill();

      // The filling wedge is the clock: full circle means it is landing now.
      ctx.fillStyle = hexAlpha(cast.def.color, 0.3);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = hexAlpha(cast.def.color, 0.9);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, TAU);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const held = monster.ability;
    if (!aim || !held) return;

    const ready = monster.abilityReady;
    const radius = held.def.radius * monster.stats.get('areaSize');

    // Clamped the same way the cast itself is, so the reticle never promises reach
    // the gift does not have.
    const dx = aim.x - monster.x;
    const dy = aim.y - monster.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > held.def.range ? held.def.range / distance : 1;

    ctx.save();
    ctx.translate(monster.x + dx * scale, monster.y + dy * scale);
    ctx.strokeStyle = hexAlpha(held.def.color, ready ? 0.75 : 0.28);
    ctx.lineWidth = ready ? 2 : 1.5;
    ctx.setLineDash([10, 9]);
    ctx.lineDashOffset = -world.time * 22;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // A crosshair tick in the middle, so a small reticle is still findable on a
    // busy floor of corpses and fire.
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.moveTo(0, -7);
    ctx.lineTo(0, 7);
    ctx.stroke();
    ctx.restore();
  }

  /** Gold pointer on the viewport border while the portal is off screen. */
  private drawExitEdgeMarker(camera: Camera, exit: Vec2): void {
    const ctx = this.ctx;
    const screen = camera.worldToScreen(exit.x, exit.y);
    const margin = 46;

    if (
      screen.x > margin &&
      screen.x < this.width - margin &&
      screen.y > margin &&
      screen.y < this.height - margin
    ) {
      return;
    }

    const cx = this.width / 2;
    const cy = this.height / 2;
    const angle = Math.atan2(screen.y - cy, screen.x - cx);
    const halfW = this.width / 2 - margin;
    const halfH = this.height / 2 - margin;
    const scale = Math.min(
      Math.abs(halfW / Math.cos(angle)) || Infinity,
      Math.abs(halfH / Math.sin(angle)) || Infinity,
    );
    const mx = cx + Math.cos(angle) * scale;
    const my = cy + Math.sin(angle) * scale;

    ctx.save();
    ctx.translate(mx, my);

    ctx.fillStyle = 'rgba(10,8,14,0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#c9a0ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.rotate(angle);
    ctx.fillStyle = '#d8bcff';
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-4, -7);
    ctx.lineTo(-4, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** The portal that opens once every human is dead. */
  private drawExit(ctx: CanvasRenderingContext2D, exit: Vec2, time: number): void {
    const pulse = 1 + Math.sin(time * 3) * 0.08;
    const r = 44 * pulse;

    ctx.save();
    ctx.translate(exit.x, exit.y);
    ctx.globalCompositeOperation = 'lighter';

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 1.8);
    grad.addColorStop(0, 'rgba(180,120,255,0.55)');
    grad.addColorStop(0.45, 'rgba(120,60,200,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, 0, TAU);
    ctx.fill();

    // Rotating rune ring.
    ctx.strokeStyle = hexAlpha('#c9a0ff', 0.8);
    ctx.lineWidth = 2;
    for (let ring = 0; ring < 2; ring++) {
      const spin = time * (ring === 0 ? 0.7 : -0.45);
      const rr = r * (0.7 + ring * 0.28);
      ctx.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = spin + (i / 12) * TAU;
        if (i % 2 === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * A short trail of chevrons floating beside the monster, pointing at the portal.
   *
   * Drawn in world space right next to the player rather than as a screen-edge
   * marker: once a room is cleared the only question left is "which way out", and
   * the answer should be readable without looking away from the character.
   */
  private drawExitGuide(
    ctx: CanvasRenderingContext2D,
    world: World,
    exit: Vec2,
  ): void {
    const monster = world.monster;
    const dx = exit.x - monster.x;
    const dy = exit.y - monster.y;
    const distance = Math.hypot(dx, dy);

    // Standing on the portal needs no directions.
    if (distance < 90) return;

    const angle = Math.atan2(dy, dx);
    const start = monster.radius + 26;

    ctx.save();
    ctx.translate(monster.x, monster.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 3; i++) {
      // Chevrons pulse outward along the direction of travel.
      const cycle = (world.time * 1.6 + i * 0.33) % 1;
      const x = start + cycle * 46;
      const fade = Math.sin(cycle * Math.PI);

      ctx.globalAlpha = fade * 0.85;
      ctx.strokeStyle = '#c9a0ff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x - 7, -7);
      ctx.lineTo(x, 0);
      ctx.lineTo(x - 7, 7);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();

    // Distance readout under the chevrons, so it also tells you how far.
    const label = `${Math.round(distance / 10)} ${t('unit.metersAbbrev')}`;
    const lx = monster.x + Math.cos(angle) * (start + 62);
    const ly = monster.y + Math.sin(angle) * (start + 62);
    ctx.save();
    ctx.font = 'bold 12px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#d8bcff';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  /** Edge arrows pointing at surviving humans the player can't see. */
  private drawOffscreenMarkers(world: World, camera: Camera): void {
    const ctx = this.ctx;
    const margin = 34;
    const cx = this.width / 2;
    const cy = this.height / 2;

    let drawn = 0;
    for (const human of world.humans) {
      if (!human.alive || drawn >= 8) continue;

      const screen = camera.worldToScreen(human.x, human.y);
      const onScreen =
        screen.x > -20 && screen.x < this.width + 20 && screen.y > -20 && screen.y < this.height + 20;
      if (onScreen) continue;

      const angle = Math.atan2(screen.y - cy, screen.x - cx);
      // Project onto the viewport rectangle border.
      const halfW = this.width / 2 - margin;
      const halfH = this.height / 2 - margin;
      const scale = Math.min(
        Math.abs(halfW / Math.cos(angle)) || Infinity,
        Math.abs(halfH / Math.sin(angle)) || Infinity,
      );
      const mx = cx + Math.cos(angle) * scale;
      const my = cy + Math.sin(angle) * scale;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.globalAlpha = human.archetype.role === 'boss' ? 0.95 : 0.5;
      ctx.fillStyle = human.archetype.role === 'boss' ? '#d8a13a' : '#a8232a';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      drawn++;
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Darken the edges of the screen.
   *
   * Baked once per viewport size rather than filled every frame. The shape only ever
   * depends on the width and the height, and evaluating a radial gradient across
   * three quarters of a million pixels sixty times a second is the single most
   * expensive thing a frame did on an engine without GPU compositing.
   */
  private drawVignette(): void {
    const ctx = this.ctx;

    const stale =
      this.vignetteSize.w !== this.width ||
      this.vignetteSize.h !== this.height ||
      this.vignetteSize.dpr !== this.dpr;
    if (!this.vignette || stale) this.bakeVignette();
    if (!this.vignette) return;

    ctx.drawImage(this.vignette, 0, 0, this.width, this.height);
  }

  private bakeVignette(): void {
    const canvas = document.createElement('canvas');
    // Baked at device resolution, not CSS resolution. The frame is drawn under a DPR
    // transform, so a CSS-sized bitmap would be upscaled on a retina display and the
    // cache would have cost sharpness rather than saved time.
    canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    canvas.height = Math.max(1, Math.round(this.height * this.dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(this.dpr, this.dpr);
    const grad = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.35,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.75,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    this.vignette = canvas;
    this.vignetteSize = { w: this.width, h: this.height, dpr: this.dpr };
  }

  /** Full-screen colour wash, used for damage flashes and transitions. */
  overlay(color: string, alpha: number): void {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalAlpha = 1;
  }
}
