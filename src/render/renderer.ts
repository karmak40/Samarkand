import { Camera } from '../core/camera';
import { clamp, TAU, type Vec2 } from '../core/math';
import { type Insets, NO_INSETS, readSafeAreaInsets } from '../core/safe-area';
import type { Human } from '../entities/human';
import { t } from '../i18n';
import type { World } from '../world/world';
import { hexAlpha } from './monster-render';
import { Terrain } from './terrain';

/** See `Renderer.setFixedViewport`. */
export interface FixedViewport {
  /** Logical (CSS-pixel) size the game lays itself out in. */
  width: number;
  height: number;
  /** Backing-store width in device pixels; height follows the same ratio. */
  pixelWidth: number;
  /** Insets the HUD keeps clear of, in logical pixels. */
  safe: Insets;
}

/**
 * Owns the canvas, the device-pixel-ratio dance and the draw order.
 *
 * Layer order (bottom to top): terrain, decals, ground hazards, y-sorted entities,
 * projectiles, lightning arcs, particles, damage numbers, vignette. UI is drawn
 * afterwards in screen space by the HUD.
 *
 * Two coordinate spaces come out of here, and which one is current is a property of
 * the canvas, not of the caller. World space (`beginWorld`) has its origin at the
 * corner of the glass, so the arena bleeds under a notch. UI space (`beginUi`) has
 * its origin inside the safe area, which is what makes every `ui.width`-relative
 * position in the HUD land somewhere a thumb can reach — without any of that code
 * knowing the notch exists. `drawWorld` switches to the first and hands back the
 * second, so the only rule for callers is the one they already followed: draw the
 * world, then draw the UI.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly terrain = new Terrain();

  /** CSS pixel size of the viewport, notch included. */
  width = 0;
  height = 0;

  /** What the system has claimed on each edge, in CSS pixels. Zero off a phone. */
  safe: Insets = NO_INSETS;

  private dpr = 1;

  /**
   * A frame size that ignores the element's own rect, for reels mode (`?reels`).
   *
   * Normally the layout is whatever the window happens to be, which is right for a
   * player and wrong for a video: every recording would frame the fight differently
   * depending on the monitor it was shot on. Fixed, the arena and the HUD lay out at
   * the same logical size every time and only the backing store is scaled to the
   * export resolution. The element can then be shown at any size that fits the
   * window — `Input` is told the ratio, so clicks still land where they are drawn.
   */
  private fixed: FixedViewport | null = null;

  /** Multiplies the automatic zoom — reels mode's "closer / wider" framing. */
  zoomScale = 1;

  private observer: ResizeObserver | null = null;
  private onOrientation: (() => void) | null = null;

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

    // Turning a phone from landscape-left to landscape-right swaps which edge the
    // notch is on without changing a single dimension, so the observer above never
    // fires and the HUD would keep avoiding the wrong side of the screen.
    if (typeof window !== 'undefined') {
      this.onOrientation = () => this.resize();
      window.addEventListener('orientationchange', this.onOrientation);
    }
  }

  destroy(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.onOrientation) {
      window.removeEventListener('orientationchange', this.onOrientation);
      this.onOrientation = null;
    }
  }

  /** Pin the logical frame and backing store to exact sizes, or `null` to follow the window again. */
  setFixedViewport(viewport: FixedViewport | null): void {
    this.fixed = viewport;
    this.resize();
  }

  /** Logical pixels per displayed CSS pixel — 1 unless a fixed viewport is shown scaled. */
  get viewScale(): number {
    if (!this.fixed) return 1;
    const rect = this.canvas.getBoundingClientRect();
    return rect.width > 0 ? this.fixed.width / rect.width : 1;
  }

  /** Re-read the element size and rescale the backing store. */
  resize(): void {
    if (this.fixed) {
      this.width = this.fixed.width;
      this.height = this.fixed.height;
      this.dpr = this.fixed.pixelWidth / this.fixed.width;
      this.safe = this.fixed.safe;
    } else {
      // Cap DPR at 2: beyond that the fill-rate cost outweighs the sharpness gain.
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, Math.round(rect.width));
      this.height = Math.max(1, Math.round(rect.height));
      this.safe = readSafeAreaInsets();
    }

    const bw = Math.round(this.width * this.dpr);
    const bh = Math.round(this.height * this.dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /** Width of the box the UI may lay itself out in, in CSS pixels. */
  get safeWidth(): number {
    return Math.max(1, this.width - this.safe.left - this.safe.right);
  }

  /** Height of the box the UI may lay itself out in, in CSS pixels. */
  get safeHeight(): number {
    return Math.max(1, this.height - this.safe.top - this.safe.bottom);
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
    if (this.fixed) return;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (w !== this.width || h !== this.height) this.resize();
  }

  /** Apply the DPR transform and clear. Call once per frame. */
  begin(): void {
    this.syncSize();
    const ctx = this.ctx;
    // Cleared in device pixels so the wipe covers the notch strips too — those are
    // still ours to paint, and leaving them stale would smear last frame down the
    // side of the screen.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07070a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.beginUi();
  }

  /**
   * CSS pixels with the origin at the corner of the glass. The arena is drawn here,
   * so it fills the whole screen on a phone rather than sitting in a letterbox.
   */
  private beginWorld(): void {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * CSS pixels with the origin inside the safe area — the space the HUD, the menus
   * and the on-screen controls all lay themselves out in.
   *
   * Rounded to whole device pixels: an origin on a half-pixel would soften every
   * glyph in the interface, which is a strange price to pay for a notch.
   */
  beginUi(): void {
    const ox = Math.round(this.safe.left * this.dpr);
    const oy = Math.round(this.safe.top * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, ox, oy);
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

    camera.zoom = clamp(Math.min(heightZoom, widthZoom), 0.6, 2.4) * this.zoomScale;
  }

  drawWorld(world: World, camera: Camera, exit: Vec2 | null, exitOpen: boolean): void {
    const ctx = this.ctx;
    const view = camera.visibleRect();

    this.beginWorld();
    ctx.save();
    camera.applyTransform(ctx);

    this.terrain.draw(ctx, view);
    world.decals.draw(ctx, view);
    world.drawHazards(ctx);
    world.drawHolyZones(ctx);

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

    // The world is done; everything after this frame draws interface.
    this.beginUi();
  }

  /**
   * The ring the edge markers ride on, in world-space coordinates.
   *
   * Markers say "the thing you want is that way", which only works if the marker
   * itself can be seen — so unlike the arena behind them they stay out of the notch.
   * The box is the safe area, and the margin is measured inward from that.
   */
  private markerBox(margin: number): { cx: number; cy: number; halfW: number; halfH: number } {
    const halfW = Math.max(1, this.safeWidth / 2 - margin);
    const halfH = Math.max(1, this.safeHeight / 2 - margin);
    return {
      cx: this.safe.left + this.safeWidth / 2,
      cy: this.safe.top + this.safeHeight / 2,
      halfW,
      halfH,
    };
  }

  /** Gold pointer on the viewport border while the portal is off screen. */
  private drawExitEdgeMarker(camera: Camera, exit: Vec2): void {
    const ctx = this.ctx;
    const screen = camera.worldToScreen(exit.x, exit.y);
    const margin = 46;
    const { cx, cy, halfW, halfH } = this.markerBox(margin);

    // Already comfortably on screen — nothing to point at.
    if (
      Math.abs(screen.x - cx) < halfW &&
      Math.abs(screen.y - cy) < halfH
    ) {
      return;
    }

    const angle = Math.atan2(screen.y - cy, screen.x - cx);
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

  /** Recent hits still flag their source on the edge marker after this long. */
  private static readonly THREAT_MARKER_WINDOW = 2.5;

  /**
   * Edge arrows pointing at surviving humans the player can't see.
   *
   * Every off-screen human gets a small, muted marker so the arena never feels like
   * it hides threats outright, but two cases need to read at a glance rather than be
   * found by scanning eight identical triangles: whoever the monster is currently
   * shooting at (so the player's own damage doesn't vanish into the fog), and whoever
   * just landed a hit from off screen (so a "where did that come from" moment always
   * has an answer). Those two get their own bigger, brighter, pulsing markers and are
   * drawn outside the generic cap so a crowded room can never push them out.
   */
  private drawOffscreenMarkers(world: World, camera: Camera): void {
    const ctx = this.ctx;
    const { cx, cy, halfW, halfH } = this.markerBox(34);

    const project = (wx: number, wy: number): { x: number; y: number; angle: number; onScreen: boolean } => {
      const screen = camera.worldToScreen(wx, wy);
      const onScreen =
        screen.x > -20 && screen.x < this.width + 20 && screen.y > -20 && screen.y < this.height + 20;
      const angle = Math.atan2(screen.y - cy, screen.x - cx);
      const scale = Math.min(
        Math.abs(halfW / Math.cos(angle)) || Infinity,
        Math.abs(halfH / Math.sin(angle)) || Infinity,
      );
      return { x: cx + Math.cos(angle) * scale, y: cy + Math.sin(angle) * scale, angle, onScreen };
    };

    const drawArrow = (
      point: { x: number; y: number; angle: number },
      color: string,
      alpha: number,
      size: number,
      ring: boolean,
    ): void => {
      ctx.save();
      ctx.translate(point.x, point.y);
      if (ring) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, size + 7, 0, TAU);
        ctx.stroke();
      }
      ctx.rotate(point.angle);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.65, -size * 0.65);
      ctx.lineTo(-size * 0.65, size * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const target = world.monster.target;
    const attackers = world.monster.recentAttackers;
    const pulse = 0.7 + Math.sin(world.time * 8) * 0.3;

    const special = new Set<Human>();

    if (target && target.alive) {
      const point = project(target.x, target.y);
      if (!point.onScreen) {
        const isAttacker = attackers.has(target) && world.time - attackers.get(target)! < Renderer.THREAT_MARKER_WINDOW;
        drawArrow(point, isAttacker ? '#ff6a4c' : '#7fe0ff', 1, 12, true);
      }
      special.add(target);
    }

    for (const human of world.humans) {
      if (!human.alive || special.has(human)) continue;
      const lastHit = attackers.get(human);
      if (lastHit === undefined || world.time - lastHit >= Renderer.THREAT_MARKER_WINDOW) continue;

      const point = project(human.x, human.y);
      if (point.onScreen) continue;
      drawArrow(point, '#ff6a4c', 0.55 + 0.45 * pulse, 11, true);
      special.add(human);
    }

    let drawn = 0;
    for (const human of world.humans) {
      if (!human.alive || special.has(human) || drawn >= 8) continue;

      const point = project(human.x, human.y);
      if (point.onScreen) continue;

      drawArrow(point, human.archetype.role === 'boss' ? '#d8a13a' : '#a8232a', human.archetype.role === 'boss' ? 0.95 : 0.5, 9, false);
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

  /**
   * Full-screen colour wash, used for damage flashes and transitions.
   *
   * Reaches past the safe area on purpose. A flash that stopped at the notch would
   * leave two unlit bars down the sides of the screen, and the eye reads that as the
   * screen being broken rather than the monster being hurt. Expects UI space, which
   * is what a frame is left in once `drawWorld` has run.
   */
  overlay(color: string, alpha: number): void {
    if (alpha <= 0) return;
    const ctx = this.ctx;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.fillStyle = color;
    ctx.fillRect(-this.safe.left, -this.safe.top, this.width, this.height);
    ctx.globalAlpha = 1;
  }
}
