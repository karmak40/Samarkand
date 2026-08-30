import { TAU } from '../core/math';

/**
 * A flat ground-contact shadow ellipse, drawn under an entity to ground it on the
 * terrain. `(cx, cy)` are in whatever space the caller is already drawing in —
 * some entities translate to their own local origin first, others draw straight
 * in world space, so this takes plain coordinates rather than an entity.
 */
export function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  alpha = 0.35,
): void {
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();
}
