import type { Rect } from '../core/math';

/**
 * Draw only the part of a baked layer the camera can actually see.
 *
 * The terrain and the decal layer are each one canvas the size of the whole arena —
 * routinely four or five times the area of the viewport. Handing the lot to
 * `drawImage` every frame costs nothing worth measuring on a GPU-composited canvas,
 * and a great deal without one: on Firefox those two calls were the most expensive
 * thing in the frame by a wide margin, ahead of every fill and stroke combined.
 *
 * A source rectangle is the whole fix. The layer is baked at one pixel per world
 * unit, so the visible region maps across unscaled and the destination is simply
 * where those pixels live in the world.
 */
export function blitVisible(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  origin: { x: number; y: number },
  view: Rect,
): void {
  // Rounded outward, so a fractional camera position never shaves a column of pixels
  // off the edge of what gets drawn.
  const left = clampInt(Math.floor(view.x - origin.x), 0, source.width);
  const right = clampInt(Math.ceil(view.x - origin.x + view.w), 0, source.width);
  const top = clampInt(Math.floor(view.y - origin.y), 0, source.height);
  const bottom = clampInt(Math.ceil(view.y - origin.y + view.h), 0, source.height);

  const width = right - left;
  const height = bottom - top;
  // The camera can sit entirely outside a layer — between rooms, or on a screen with
  // no arena behind it at all.
  if (width <= 0 || height <= 0) return;

  // The camera zoom means this blit is always an upscale, and a smoothed upscale of a
  // near-viewport-sized bitmap is the expensive kind. Both layers are noise — dirt,
  // grass, blood — where bilinear filtering buys nothing a player could point to.
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(
    source,
    left,
    top,
    width,
    height,
    origin.x + left,
    origin.y + top,
    width,
    height,
  );

  ctx.imageSmoothingEnabled = smoothing;
}

function clampInt(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
