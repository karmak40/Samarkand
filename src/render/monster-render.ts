import { clamp, TAU } from '../core/math';
import type { Monster } from '../entities/monster';
import type { MonsterBody } from '../progression/evolution';
import type { World } from '../world/world';

/**
 * Draws the monster entirely from its `MonsterBody` description.
 *
 * There are no sprites: every horn, wing and eye a mutation grants is a real change
 * to the silhouette. Animation is driven by three signals — age (idle breathing),
 * velocity (squash, stretch, lean) and attackAnim (lunge and maw opening).
 */
export function drawMonster(ctx: CanvasRenderingContext2D, monster: Monster, world: World): void {
  // Read the *current* appearance, not the permanent body: temporary forms live
  // entirely in this struct, so a boon changes the drawing with no extra branches.
  const body = monster.appearance;
  const t = monster.age;
  const speed = Math.hypot(monster.vx, monster.vy);
  const scale = body.bulk;
  const r = body.coreRadius * scale;

  // Motion signals.
  const speedNorm = clamp(speed / 320, 0, 1.3);
  const breathe = Math.sin(t * 2.4) * 0.035;
  const stretch = 1 + speedNorm * 0.16 + monster.attackAnim * 0.1;
  const squash = 1 - speedNorm * 0.1 - monster.attackAnim * 0.06 + breathe;
  const lean = monster.attackAnim * 0.22;
  const travelAngle = speed > 12 ? Math.atan2(monster.vy, monster.vx) : monster.aim;

  ctx.save();
  // Spectral forms fade the whole creature; the shadow fades with it.
  if (body.alpha < 1) ctx.globalAlpha = body.alpha;

  // --- ground shadow --------------------------------------------------------
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(monster.x, monster.y + r * 0.75, r * 1.05, r * 0.4, 0, 0, TAU);
  ctx.fill();

  // --- aura -----------------------------------------------------------------
  if (body.aura !== 'none' || body.glowStrength > 0.6) {
    ctx.globalCompositeOperation = 'lighter';
    const auraR = r * (3 + Math.sin(t * 3) * 0.18);
    const grad = ctx.createRadialGradient(monster.x, monster.y, r * 0.4, monster.x, monster.y, auraR);
    grad.addColorStop(0, hexAlpha(body.glowColor, 0.35 * body.glowStrength));
    grad.addColorStop(0.5, hexAlpha(body.glowColor, 0.12 * body.glowStrength));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(monster.x, monster.y, auraR, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.translate(monster.x, monster.y);

  // --- behind-body parts ----------------------------------------------------
  ctx.save();
  ctx.rotate(travelAngle);
  drawWings(ctx, body, r, monster.wingPhase, speedNorm);
  drawTails(ctx, body, r, t, speedNorm);
  ctx.restore();

  drawLimbs(ctx, body, r, monster.gaitPhase, monster.vx, monster.vy);

  // --- main mass ------------------------------------------------------------
  ctx.save();
  ctx.rotate(monster.aim);
  ctx.translate(lean * r, 0);
  ctx.rotate(-monster.aim);
  ctx.rotate(travelAngle);
  ctx.scale(stretch, squash);
  ctx.rotate(-travelAngle);

  drawBlob(ctx, body, r, t);
  drawSpikes(ctx, body, r, t);
  drawHorns(ctx, body, r, monster.aim);
  drawMaw(ctx, body, r, monster.aim, monster.attackAnim, t);
  drawEyes(ctx, body, r, monster.aim, t, monster.attackAnim);

  // Damage flash over the whole mass.
  if (monster.hitFlash > 0) {
    ctx.globalAlpha = monster.hitFlash * 0.75 * body.alpha;
    ctx.fillStyle = monster.hitFlashColor;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.15, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = body.alpha;
  }

  const tint = monster.statuses.tint();
  if (tint) {
    ctx.globalAlpha = 0.25 * body.alpha;
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.1, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = body.alpha;
  }

  ctx.restore();

  // --- shield ---------------------------------------------------------------
  if (monster.shield > 0) {
    ctx.strokeStyle = 'rgba(160,200,255,0.65)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.6 + Math.sin(t * 5) * 2, 0, TAU);
    ctx.stroke();
  }

  // --- dash afterglow -------------------------------------------------------
  if (monster.dashActive > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = monster.dashActive * 3 * body.alpha;
    ctx.fillStyle = body.glowColor;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = body.alpha;
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();

  drawOrbitals(ctx, monster, t);
  void world;
}

/**
 * The same creature, drawn from a bare body description with no entity behind it.
 *
 * Used by menu screens that need to show a body the player does not currently have.
 * It idles rather than animates: no velocity, no attack, just the breathing wobble,
 * so the portrait reads as a specimen and not as a frozen frame of combat.
 *
 * `size` is the radius the portrait should fit into; bodies of different bulk are
 * scaled to fill it equally, which is what makes a row of them comparable.
 */
export function drawBodyPortrait(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  cx: number,
  cy: number,
  size: number,
  t: number,
): void {
  // Everything hanging off the body — wings, horns, tails — reaches well past the
  // core, so the core has to sit at a fraction of the box or the silhouette clips.
  const r = size * 0.46;
  const aim = -Math.PI / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, 1 + Math.sin(t * 2.4) * 0.03);

  if (body.aura !== 'none' || body.glowStrength > 0.6) {
    ctx.globalCompositeOperation = 'lighter';
    const auraR = r * (2.4 + Math.sin(t * 3) * 0.12);
    const grad = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, auraR);
    grad.addColorStop(0, hexAlpha(body.glowColor, 0.3 * body.glowStrength));
    grad.addColorStop(0.5, hexAlpha(body.glowColor, 0.1 * body.glowStrength));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, auraR, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  ctx.rotate(aim);
  drawWings(ctx, body, r, t * 3, 0.15);
  drawTails(ctx, body, r, t, 0.15);
  ctx.restore();

  drawLimbs(ctx, body, r, t * 2, 0, 0);
  drawBlob(ctx, body, r, t);
  drawSpikes(ctx, body, r, t);
  drawHorns(ctx, body, r, aim);
  drawMaw(ctx, body, r, aim, 0, t);
  drawEyes(ctx, body, r, aim, t, 0);

  ctx.restore();
}

// ---------------------------------------------------------------------------

/** Irregular blob outline. Lobes wobble over time so the body never looks static. */
function drawBlob(ctx: CanvasRenderingContext2D, body: MonsterBody, r: number, t: number): void {
  const points = Math.max(10, body.lobes * 3);
  ctx.beginPath();

  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    // Two out-of-phase sine terms give an organic, non-repeating outline.
    const wobble =
      1 +
      Math.sin(a * body.lobes + t * 1.6) * 0.09 +
      Math.sin(a * (body.lobes * 2 + 1) - t * 2.3) * 0.045;
    const radius = r * wobble;
    const px = Math.cos(a) * radius;
    const py = Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r * 1.2);
  grad.addColorStop(0, body.accentColor);
  grad.addColorStop(0.55, body.bodyColor);
  grad.addColorStop(1, shade(body.bodyColor, -0.35));
  ctx.fillStyle = grad;
  ctx.fill();

  // Rim light on the upper-left, so the shape reads against dark ground.
  ctx.strokeStyle = hexAlpha(body.glowColor, 0.35);
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

function drawSpikes(ctx: CanvasRenderingContext2D, body: MonsterBody, r: number, t: number): void {
  if (body.spikes <= 0) return;

  ctx.fillStyle = '#d9d2c2';
  for (let i = 0; i < body.spikes; i++) {
    // Spikes ride the upper half of the body only.
    const a = -Math.PI + (i / Math.max(1, body.spikes - 1)) * Math.PI;
    const jitter = Math.sin(t * 2 + i) * 0.03;
    const baseR = r * 0.92;
    const len = r * (0.42 + (i % 3) * 0.09);
    const ca = Math.cos(a + jitter);
    const sa = Math.sin(a + jitter);

    ctx.beginPath();
    ctx.moveTo(ca * baseR - sa * 3.2, sa * baseR + ca * 3.2);
    ctx.lineTo(ca * (baseR + len), sa * (baseR + len));
    ctx.lineTo(ca * baseR + sa * 3.2, sa * baseR - ca * 3.2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHorns(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  aim: number,
): void {
  if (body.horns <= 0) return;

  ctx.save();
  ctx.rotate(aim);
  ctx.fillStyle = '#e2dccb';
  ctx.strokeStyle = '#8f8873';
  ctx.lineWidth = 1;

  const pairs = Math.ceil(body.horns / 2);
  for (let p = 0; p < pairs; p++) {
    for (const side of [-1, 1]) {
      if (p * 2 + (side < 0 ? 0 : 1) >= body.horns) continue;

      const spread = 0.5 + p * 0.32;
      const length = r * (1.05 - p * 0.16);
      const baseX = Math.cos(spread * side) * r * 0.78;
      const baseY = Math.sin(spread * side) * r * 0.78;

      // Curved horn: base -> control point swept back -> sharp tip.
      ctx.beginPath();
      ctx.moveTo(baseX, baseY - side * 4);
      ctx.quadraticCurveTo(
        baseX + length * 0.55,
        baseY + side * length * 0.55,
        baseX + length * 0.35,
        baseY + side * length,
      );
      ctx.quadraticCurveTo(baseX + length * 0.2, baseY + side * length * 0.5, baseX, baseY + side * 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawMaw(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  aim: number,
  attackAnim: number,
  t: number,
): void {
  if (body.maw <= 0.05) return;

  ctx.save();
  ctx.rotate(aim);

  // The maw gapes on attack and idles with a slow chew.
  const open = body.maw * (0.55 + attackAnim * 0.75 + Math.sin(t * 1.7) * 0.06);
  // Kept narrow so the eyes have room to flank it instead of rendering inside it.
  const width = r * body.maw * 1.1;
  const depth = r * open;

  ctx.fillStyle = '#0a0508';
  ctx.beginPath();
  ctx.moveTo(r * 0.35, -width);
  ctx.quadraticCurveTo(r * 0.35 + depth * 1.5, 0, r * 0.35, width);
  ctx.quadraticCurveTo(r * 0.1, 0, r * 0.35, -width);
  ctx.closePath();
  ctx.fill();

  // Teeth: alternating triangles along both jaw lines.
  const teeth = Math.max(3, Math.round(body.maw * 12));
  ctx.fillStyle = '#efe9d8';
  for (let i = 0; i < teeth; i++) {
    const k = i / (teeth - 1);
    const y = -width + k * width * 2;
    const jaw = Math.abs(y) / width;
    const x = r * 0.35 + depth * 1.2 * (1 - jaw * jaw);
    const size = 2.6 * (1 - jaw * 0.5);
    const dir = i % 2 === 0 ? 1 : -1;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * 2, y + size * dir);
    ctx.lineTo(x - size * 0.4, y + size * 2 * dir);
    ctx.closePath();
    ctx.fill();
  }

  // Inner glow — light from inside the throat.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.3 + attackAnim * 0.5;
  const throat = ctx.createRadialGradient(r * 0.5, 0, 0, r * 0.5, 0, depth * 1.4 + 4);
  throat.addColorStop(0, body.glowColor);
  throat.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = throat;
  ctx.beginPath();
  ctx.arc(r * 0.5, 0, depth * 1.4 + 4, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.restore();
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  aim: number,
  t: number,
  attackAnim: number,
): void {
  if (body.eyes <= 0) return;

  ctx.save();
  ctx.rotate(aim);

  // Blink: a shared timer with a per-eye offset so they don't blink in lockstep.
  const blinkPhase = (t * 0.42) % 1;
  const blinking = blinkPhase > 0.96;

  for (let i = 0; i < body.eyes; i++) {
    // First pair flanks the maw at the front; extra eyes scatter over the flanks
    // and back, which is what makes "Многоглазие" read as a real change.
    const isPrimary = i < 2;
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);

    const angle = isPrimary
      ? side * 1.02
      : side * (1.5 + rank * 0.5) + Math.sin(rank * 2.3) * 0.2;
    const dist = isPrimary ? r * 0.66 : r * (0.5 + ((rank * 7) % 5) * 0.09);
    const size = (isPrimary ? r * 0.23 : r * 0.12) * (blinking ? 0.15 : 1);

    const ex = Math.cos(angle) * dist;
    const ey = Math.sin(angle) * dist;

    // Sclera.
    ctx.fillStyle = '#0d0a0c';
    ctx.beginPath();
    ctx.ellipse(ex, ey, size * 1.35, size, 0, 0, TAU);
    ctx.fill();

    // Glowing iris, brighter mid-attack.
    ctx.globalCompositeOperation = 'lighter';
    const intensity = 0.75 + attackAnim * 0.25;
    const irisGrad = ctx.createRadialGradient(ex, ey, 0, ex, ey, size * 1.6);
    irisGrad.addColorStop(0, hexAlpha('#ffffff', intensity));
    irisGrad.addColorStop(0.35, hexAlpha(body.glowColor, intensity));
    irisGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(ex, ey, size * 1.6, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // Slit pupil.
    if (!blinking) {
      ctx.fillStyle = '#120a10';
      ctx.beginPath();
      ctx.ellipse(ex + size * 0.25, ey, size * 0.22, size * 0.72, 0, 0, TAU);
      ctx.fill();
    }
  }

  ctx.restore();
}

function drawTails(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  t: number,
  speedNorm: number,
): void {
  if (body.tails <= 0) return;

  ctx.strokeStyle = shade(body.bodyColor, -0.15);
  ctx.lineCap = 'round';

  for (let i = 0; i < body.tails; i++) {
    const offset = (i - (body.tails - 1) / 2) * 0.5;
    const length = r * (1.8 + (i % 2) * 0.4);
    const segments = 7;

    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.7, offset * r * 0.35);

    for (let s = 1; s <= segments; s++) {
      const k = s / segments;
      // Whip motion: the wave amplitude grows toward the tip and with speed.
      const wave = Math.sin(t * 5 - k * 4 + i * 1.7) * r * 0.42 * k * (0.6 + speedNorm);
      ctx.lineTo(-r * 0.7 - length * k, offset * r * 0.35 + wave);
      ctx.lineWidth = r * 0.3 * (1 - k * 0.8);
    }
    ctx.stroke();

    // Barbed tip.
    const tipWave = Math.sin(t * 5 - 4 + i * 1.7) * r * 0.42 * (0.6 + speedNorm);
    ctx.fillStyle = '#d9d2c2';
    ctx.beginPath();
    ctx.arc(-r * 0.7 - length, offset * r * 0.35 + tipWave, r * 0.09, 0, TAU);
    ctx.fill();
  }
}

function drawWings(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  phase: number,
  speedNorm: number,
): void {
  if (body.wings <= 0) return;

  // Wings beat faster the faster you move; the rate lives in the integrated phase.
  const beat = Math.sin(phase);
  const span = r * (2.1 + speedNorm * 0.4);

  for (let i = 0; i < body.wings; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const rank = Math.floor(i / 2);
    const fold = 0.55 + beat * 0.3 - rank * 0.12;

    ctx.save();
    ctx.scale(1, side);
    ctx.rotate(-0.35 - rank * 0.3);

    ctx.fillStyle = hexAlpha(shade(body.bodyColor, -0.2), 0.88);
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, 0);
    ctx.quadraticCurveTo(-span * 0.5, span * fold * 0.9, -span, span * fold * 0.35);
    ctx.quadraticCurveTo(-span * 0.6, span * fold * 0.15, -r * 0.2, r * 0.15);
    ctx.closePath();
    ctx.fill();

    // Finger bones.
    ctx.strokeStyle = hexAlpha(body.glowColor, 0.3);
    ctx.lineWidth = 1.4;
    for (let f = 1; f <= 3; f++) {
      const k = f / 4;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, r * 0.05);
      ctx.quadraticCurveTo(
        -span * 0.5 * k - r * 0.2,
        span * fold * 0.55 * k,
        -span * k - r * 0.1,
        span * fold * 0.4 * k,
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Tendril legs with a simple procedural gait: each limb plants a foot, the body
 * moves past it, then the foot snaps to a new position ahead.
 */
function drawLimbs(
  ctx: CanvasRenderingContext2D,
  body: MonsterBody,
  r: number,
  gaitPhase: number,
  vx: number,
  vy: number,
): void {
  if (body.limbs <= 0) return;

  const speed = Math.hypot(vx, vy);
  const moveAngle = speed > 8 ? Math.atan2(vy, vx) : 0;

  ctx.strokeStyle = shade(body.bodyColor, -0.28);
  ctx.lineCap = 'round';

  for (let i = 0; i < body.limbs; i++) {
    const base = (i / body.limbs) * TAU + Math.PI / body.limbs;
    // Alternating phase produces a natural-looking crawl rather than a hop.
    const phase = gaitPhase + (i % 2) * Math.PI;
    const lift = Math.max(0, Math.sin(phase));
    const swing = Math.cos(phase) * 0.32;

    const hipX = Math.cos(base) * r * 0.82;
    const hipY = Math.sin(base) * r * 0.82;

    const reach = r * (1.5 + lift * 0.25);
    const footAngle = base + swing + moveAngle * 0.06;
    const footX = Math.cos(footAngle) * reach;
    const footY = Math.sin(footAngle) * reach - lift * r * 0.35;

    // Knee bulges outward, away from the body centre.
    const kneeX = (hipX + footX) * 0.5 + Math.cos(base) * r * 0.4;
    const kneeY = (hipY + footY) * 0.5 + Math.sin(base) * r * 0.4 - lift * r * 0.3;

    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.quadraticCurveTo(kneeX, kneeY, footX, footY);
    ctx.stroke();

    // Claw tip.
    ctx.fillStyle = '#d9d2c2';
    ctx.beginPath();
    ctx.arc(footX, footY, r * 0.07, 0, TAU);
    ctx.fill();
  }
}

function drawOrbitals(ctx: CanvasRenderingContext2D, monster: Monster, t: number): void {
  const positions = monster.orbitalPositions();
  if (positions.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const pos of positions) {
    const pulse = 7 + Math.sin(t * 8 + pos.x * 0.05) * 1.6;
    const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, pulse * 2.4);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, monster.appearance.glowColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, pulse * 2.4, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------

/** #rrggbb + alpha -> rgba() string. */
export function hexAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
export function shade(hex: string, amount: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const adjust = (channel: number): number => {
    const target = amount > 0 ? 255 : 0;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  };
  const r = adjust(parseInt(hex.slice(1, 3), 16));
  const g = adjust(parseInt(hex.slice(3, 5), 16));
  const b = adjust(parseInt(hex.slice(5, 7), 16));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
