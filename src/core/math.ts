/** Small vector/geometry helpers. Everything here is allocation-light and hot-path safe. */

export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent exponential approach. `rate` is roughly "how fast", in 1/sec. */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = ((to - from + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Squared distance from a point to the nearest point on a rect (0 if inside). */
export function pointRectDist2(r: Rect, x: number, y: number): number {
  const cx = clamp(x, r.x, r.x + r.w);
  const cy = clamp(y, r.y, r.y + r.h);
  return dist2(x, y, cx, cy);
}

export function circleRectOverlap(cx: number, cy: number, radius: number, r: Rect): boolean {
  return pointRectDist2(r, cx, cy) < radius * radius;
}

/**
 * Push a circle out of a rect along the shallowest axis.
 * Returns the corrected position, or null when there was no overlap.
 */
export function resolveCircleRect(
  cx: number,
  cy: number,
  radius: number,
  r: Rect,
): Vec2 | null {
  const nearestX = clamp(cx, r.x, r.x + r.w);
  const nearestY = clamp(cy, r.y, r.y + r.h);
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const d2 = dx * dx + dy * dy;

  if (d2 > radius * radius) return null;

  if (d2 > 1e-9) {
    // Circle centre is outside the rect: push straight out along the contact normal.
    const d = Math.sqrt(d2);
    const push = radius - d;
    return { x: cx + (dx / d) * push, y: cy + (dy / d) * push };
  }

  // Centre is inside the rect: eject along whichever face is closest.
  const left = cx - r.x;
  const right = r.x + r.w - cx;
  const top = cy - r.y;
  const bottom = r.y + r.h - cy;
  const min = Math.min(left, right, top, bottom);

  if (min === left) return { x: r.x - radius, y: cy };
  if (min === right) return { x: r.x + r.w + radius, y: cy };
  if (min === top) return { x: cx, y: r.y - radius };
  return { x: cx, y: r.y + r.h + radius };
}

/** Slab test: does the segment a->b intersect the rect? Used for line-of-sight. */
export function segmentRectHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let tMin = 0;
  let tMax = 1;

  for (let axis = 0; axis < 2; axis++) {
    const origin = axis === 0 ? ax : ay;
    const delta = axis === 0 ? dx : dy;
    const lo = axis === 0 ? r.x : r.y;
    const hi = axis === 0 ? r.x + r.w : r.y + r.h;

    if (Math.abs(delta) < 1e-9) {
      if (origin < lo || origin > hi) return false;
      continue;
    }

    let t1 = (lo - origin) / delta;
    let t2 = (hi - origin) / delta;
    if (t1 > t2) [t1, t2] = [t2, t1];

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }

  return true;
}

/** Smooth 0..1 ramp, used all over the renderer for easing. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}
