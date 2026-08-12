import { type Rect, TAU } from '../core/math';
import { RNG } from '../core/rng';
import type { RoomPlan } from '../world/roomgen';

/**
 * Bakes the ground for a room into a single offscreen canvas.
 *
 * Terrain never changes during play (decals are a separate layer), so drawing it
 * once and blitting is far cheaper than re-rendering thousands of grass tufts
 * every frame.
 */
export class Terrain {
  private canvas: HTMLCanvasElement | null = null;
  private origin = { x: 0, y: 0 };

  build(plan: RoomPlan): void {
    const bounds = plan.bounds;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(bounds.w);
    canvas.height = Math.ceil(bounds.h);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rng = new RNG(plan.groundSeed);
    this.paintBase(ctx, bounds, plan, rng);
    this.paintPaths(ctx, bounds, plan, rng);
    this.paintScatter(ctx, bounds, rng);
    this.paintBoundary(ctx, bounds, plan, rng);

    this.canvas = canvas;
    this.origin = { x: bounds.x, y: bounds.y };
  }

  private paintBase(
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    plan: RoomPlan,
    rng: RNG,
  ): void {
    // Each room kind gets its own earth tone so biome variety reads instantly.
    const palettes: Record<string, [string, string]> = {
      hamlet: ['#38392c', '#474834'],
      village: ['#35382b', '#454737'],
      fortified: ['#333229', '#403f33'],
      shrine: ['#2f3733', '#3d4641'],
      boss: ['#2c262e', '#3a323f'],
    };
    const [dark, light] = palettes[plan.kind] ?? palettes.village!;

    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, bounds.w, bounds.h);

    // Large soft blotches break up the flat fill.
    for (let i = 0; i < 90; i++) {
      const x = rng.range(0, bounds.w);
      const y = rng.range(0, bounds.h);
      const r = rng.range(60, 240);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, light);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = rng.range(0.12, 0.3);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private paintPaths(
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    plan: RoomPlan,
    rng: RNG,
  ): void {
    const cx = bounds.w / 2;
    const cy = bounds.h / 2;

    // Trodden paths radiate from the plaza toward the arena edges — they give the
    // settlement a legible structure and hint at where to run.
    ctx.lineCap = 'round';
    const spokes = rng.int(3, 5);

    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * TAU + rng.range(-0.3, 0.3);
      const length = Math.max(bounds.w, bounds.h) * 0.6;

      ctx.strokeStyle = 'rgba(92,80,58,0.4)';
      ctx.lineWidth = rng.range(26, 44);
      ctx.beginPath();
      ctx.moveTo(cx, cy);

      // Slight meander so paths don't look laser-straight.
      const steps = 6;
      for (let s = 1; s <= steps; s++) {
        const k = s / steps;
        const wobble = Math.sin(k * 5 + i) * 26;
        ctx.lineTo(
          cx + Math.cos(angle) * length * k + Math.cos(angle + Math.PI / 2) * wobble,
          cy + Math.sin(angle) * length * k + Math.sin(angle + Math.PI / 2) * wobble,
        );
      }
      ctx.stroke();
    }

    // Plaza floor.
    const plazaR = Math.min(bounds.w, bounds.h) * 0.16;
    const grad = ctx.createRadialGradient(cx, cy, plazaR * 0.3, cx, cy, plazaR);
    grad.addColorStop(0, 'rgba(102,89,64,0.5)');
    grad.addColorStop(1, 'rgba(102,89,64,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, plazaR, 0, TAU);
    ctx.fill();

    void plan;
  }

  private paintScatter(ctx: CanvasRenderingContext2D, bounds: Rect, rng: RNG): void {
    // Grass tufts.
    for (let i = 0; i < 900; i++) {
      const x = rng.range(0, bounds.w);
      const y = rng.range(0, bounds.h);
      const h = rng.range(3, 8);
      ctx.strokeStyle = rng.bool(0.5) ? 'rgba(74,84,48,0.55)' : 'rgba(58,66,40,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(-2, 2), y - h);
      ctx.stroke();
    }

    // Pebbles.
    for (let i = 0; i < 260; i++) {
      const x = rng.range(0, bounds.w);
      const y = rng.range(0, bounds.h);
      ctx.fillStyle = `rgba(120,112,96,${rng.range(0.1, 0.3).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, rng.range(1.5, 4), rng.range(1, 2.6), rng.next() * TAU, 0, TAU);
      ctx.fill();
    }
  }

  /**
   * Physical border around the settlement.
   *
   * The arena used to end at an invisible line, which read as "the screen stopped".
   * Now the boundary is a band of boulders (or dressed stone for fortified places)
   * sitting in the outer `thickness` pixels, with the playable area clamped inside
   * it — so bumping the edge means bumping into something you can see.
   */
  private paintBoundary(
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    plan: RoomPlan,
    rng: RNG,
  ): void {
    const thickness = plan.wallThickness;
    const dressed = plan.kind === 'fortified' || plan.kind === 'boss';

    // Soft shadow cast inward by the barrier.
    const inner = thickness + 46;
    for (const [x, y, w, h, dir] of [
      [0, 0, bounds.w, inner, 'v'],
      [0, bounds.h - inner, bounds.w, inner, 'V'],
      [0, 0, inner, bounds.h, 'h'],
      [bounds.w - inner, 0, inner, bounds.h, 'H'],
    ] as Array<[number, number, number, number, string]>) {
      const vertical = dir === 'v' || dir === 'V';
      const flip = dir === 'V' || dir === 'H';
      const grad = vertical
        ? ctx.createLinearGradient(0, flip ? y + h : y, 0, flip ? y : y + h)
        : ctx.createLinearGradient(flip ? x + w : x, 0, flip ? x : x + w, 0);
      grad.addColorStop(0, 'rgba(6,5,8,0.55)');
      grad.addColorStop(1, 'rgba(6,5,8,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }

    if (dressed) this.paintStoneWall(ctx, bounds, thickness, rng);
    else this.paintBoulderRing(ctx, bounds, thickness, rng);
  }

  private paintBoulderRing(
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    thickness: number,
    rng: RNG,
  ): void {
    const step = thickness * 0.72;
    const centre = thickness * 0.48;

    // Walk the perimeter, dropping overlapping rocks so there are no visual gaps.
    const positions: Array<{ x: number; y: number }> = [];
    for (let x = -step; x < bounds.w + step; x += step) {
      positions.push({ x, y: centre });
      positions.push({ x: x + step * 0.5, y: bounds.h - centre });
    }
    for (let y = -step; y < bounds.h + step; y += step) {
      positions.push({ x: centre, y });
      positions.push({ x: bounds.w - centre, y: y + step * 0.5 });
    }

    for (const pos of positions) {
      const radius = thickness * rng.range(0.52, 0.82);
      const x = pos.x + rng.range(-6, 6);
      const y = pos.y + rng.range(-6, 6);

      // Base shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(x, y + radius * 0.4, radius * 0.95, radius * 0.42, 0, 0, TAU);
      ctx.fill();

      // Rock body: a jagged polygon, never a circle.
      const facets = rng.int(6, 9);
      const wobble = rng.next() * TAU;
      ctx.beginPath();
      for (let i = 0; i <= facets; i++) {
        const a = (i / facets) * TAU;
        const r = radius * (0.72 + 0.34 * Math.abs(Math.sin(wobble + i * 1.9)));
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r * 0.88;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = rng.bool(0.5) ? '#605a50' : '#6d665a';
      ctx.fill();
      // A dark outline separates neighbouring rocks; without it a run of boulders
      // merges into one grey smear against the edge shading.
      ctx.strokeStyle = 'rgba(18,16,14,0.75)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // Lit top face, so the rocks read as volume rather than flat blobs.
      ctx.beginPath();
      ctx.ellipse(
        x - radius * 0.14,
        y - radius * 0.26,
        radius * 0.5,
        radius * 0.3,
        rng.range(-0.4, 0.4),
        0,
        TAU,
      );
      ctx.fillStyle = 'rgba(168,160,142,0.34)';
      ctx.fill();
    }
  }

  private paintStoneWall(
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    thickness: number,
    rng: RNG,
  ): void {
    const blockW = 42;
    const courses = 2;
    const courseH = thickness / courses;

    const drawRun = (
      length: number,
      place: (along: number, depth: number, w: number, h: number) => void,
    ): void => {
      for (let course = 0; course < courses; course++) {
        // Offset alternate courses so the joints stagger like real masonry.
        const offset = course % 2 === 0 ? 0 : blockW / 2;
        for (let along = -offset; along < length; along += blockW) {
          place(along, course * courseH, blockW - 3, courseH - 3);
        }
      }
    };

    const block = (x: number, y: number, w: number, h: number): void => {
      ctx.fillStyle = rng.bool(0.5) ? '#585349' : '#615b50';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y, w, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x, y + h - 2, w, 2);
    };

    drawRun(bounds.w, (along, depth, w, h) => block(along, depth, w, h));
    drawRun(bounds.w, (along, depth, w, h) => block(along, bounds.h - thickness + depth, w, h));
    drawRun(bounds.h, (along, depth, w, h) => block(depth, along, h, w));
    drawRun(bounds.h, (along, depth, w, h) => block(bounds.w - thickness + depth, along, h, w));

    // Merlons along the inner lip give the wall a recognisable fortified profile.
    ctx.fillStyle = '#4b463d';
    for (let x = 0; x < bounds.w; x += 34) {
      ctx.fillRect(x, thickness, 18, 7);
      ctx.fillRect(x + 17, bounds.h - thickness - 7, 18, 7);
    }
    for (let y = 0; y < bounds.h; y += 34) {
      ctx.fillRect(thickness, y, 7, 18);
      ctx.fillRect(bounds.w - thickness - 7, y + 17, 7, 18);
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.canvas) return;
    ctx.drawImage(this.canvas, this.origin.x, this.origin.y);
  }
}
