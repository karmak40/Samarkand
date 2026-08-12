import { DAMAGE_INFO } from '../combat/damage';
import { STATUS_DEFS } from '../combat/status';
import { clamp, TAU } from '../core/math';
import type { Monster } from '../entities/monster';
import { RARITY, type SkillCard } from '../progression/skills';
import type { RunStats } from '../stats/tracker';
import { formatNumber, formatTime, PALETTE, rect, type Ui } from './widgets';

export interface HudState {
  monster: Monster;
  tracker: RunStats;
  roomIndex: number;
  totalRooms: number;
  roomName: string;
  humansAlive: number;
  humansTotal: number;
  cleared: boolean;
  skills: Array<{ card: SkillCard; stacks: number }>;
  /** 0..1, drives the red screen edge when hurt. */
  hurtFlash: number;
  /** Seconds since the run started, for the tutorial hint. */
  elapsed: number;
  bossName: string | null;
  bossHealth: number;
}

/**
 * In-game overlay.
 *
 * Layout principle: the four corners carry state you glance at (health, progress,
 * resources, build), and the centre stays clear so nothing hides the fight.
 */
export function drawHud(ui: Ui, state: HudState): void {
  const { monster } = state;

  drawHurtVignette(ui, state.hurtFlash);
  drawHealthCluster(ui, state);
  drawExperience(ui, state);
  drawProgress(ui, state);
  drawResources(ui, state);
  drawDash(ui, monster);
  drawBuild(ui, state);
  if (state.bossName) drawBossBar(ui, state);
  drawHints(ui, state);
}

// ---------------------------------------------------------------------------

function drawHurtVignette(ui: Ui, amount: number): void {
  if (amount <= 0.01) return;
  const ctx = ui.ctx;
  const grad = ctx.createRadialGradient(
    ui.width / 2,
    ui.height / 2,
    Math.min(ui.width, ui.height) * 0.3,
    ui.width / 2,
    ui.height / 2,
    Math.max(ui.width, ui.height) * 0.7,
  );
  grad.addColorStop(0, 'rgba(160,20,26,0)');
  grad.addColorStop(1, `rgba(160,20,26,${(amount * 0.55).toFixed(3)})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, ui.width, ui.height);
}

function drawHealthCluster(ui: Ui, state: HudState): void {
  const { monster } = state;
  const x = 24;
  const y = 24;
  const w = 300;

  // Health.
  const hpRect = rect(x, y, w, 20);
  ui.bar(hpRect, monster.healthFraction, {
    color: monster.healthFraction < 0.3 ? PALETTE.bloodBright : PALETTE.blood,
  });

  ui.text(
    `${Math.ceil(monster.hp)} / ${Math.round(monster.maxHp)}`,
    x + w / 2,
    y + 10,
    { size: 13, color: PALETTE.ink, align: 'center', baseline: 'middle', bold: true, outline: true },
  );

  // Shield rides on top of the health bar as a blue overlay.
  if (monster.shield > 0) {
    const fraction = clamp(monster.shield / monster.maxHp, 0, 1);
    ui.ctx.save();
    ui.roundRect(hpRect, 3);
    ui.ctx.clip();
    ui.ctx.fillStyle = 'rgba(140,190,255,0.55)';
    ui.ctx.fillRect(x, y, w * fraction, 20);
    ui.ctx.restore();
    ui.text(`+${Math.ceil(monster.shield)}`, x + w + 8, y + 10, {
      size: 12,
      color: '#a8caff',
      baseline: 'middle',
      bold: true,
    });
  }

  // Status effects.
  let sx = x;
  const sy = y + 30;
  for (const status of monster.statuses.list()) {
    const def = STATUS_DEFS[status.id];
    ui.ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ui.ctx.fillRect(sx, sy, 22, 22);
    ui.ctx.strokeStyle = def.color;
    ui.ctx.lineWidth = 1.5;
    ui.ctx.strokeRect(sx + 0.5, sy + 0.5, 21, 21);

    ui.text(def.name.slice(0, 1), sx + 11, sy + 11, {
      size: 13,
      color: def.color,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (status.stacks > 1) {
      ui.text(`${status.stacks}`, sx + 20, sy + 21, {
        size: 10,
        color: PALETTE.ink,
        align: 'right',
        baseline: 'bottom',
        outline: true,
      });
    }
    sx += 26;
  }

  // Frenzy indicator.
  if (monster.isFrenzied) {
    ui.text('НЕИСТОВСТВО', x, sy + (monster.statuses.size > 0 ? 34 : 8), {
      size: 12,
      color: '#ffb347',
      bold: true,
      letterSpacing: 1.5,
      baseline: 'middle',
    });
  }
}

/**
 * Level and experience.
 *
 * Sits directly under the health bar because the two are read together, and the
 * "level ready" prompt has to be impossible to miss — banked levels are useless if
 * the player forgets they are holding them.
 */
function drawExperience(ui: Ui, state: HudState): void {
  const { monster } = state;
  const x = 24;
  const y = 24 + 24 + (monster.statuses.size > 0 ? 30 : 0);
  const w = 300;

  ui.bar(rect(x, y, w, 9), monster.xpFraction, {
    color: '#7fb2ff',
    background: 'rgba(0,0,0,0.55)',
    radius: 2,
  });

  ui.text(`ур. ${monster.level}`, x, y + 20, {
    size: 12,
    color: PALETTE.muted,
    baseline: 'middle',
    bold: true,
  });
  ui.text(
    `${Math.floor(monster.xpIntoLevel)} / ${monster.xpForNextLevel}`,
    x + w,
    y + 20,
    { size: 11, color: PALETTE.dim, align: 'right', baseline: 'middle' },
  );

  if (monster.pendingLevels <= 0) return;

  // Pulsing call to action. Position is fixed so muscle memory can find it.
  const pulse = 0.65 + 0.35 * Math.sin(state.elapsed * 5);
  const label =
    monster.pendingLevels > 1
      ? `ENTER — развитие ×${monster.pendingLevels}`
      : 'ENTER — развитие';

  const badge = rect(x, y + 32, 214, 26);
  ui.panel(badge, {
    fill: `rgba(60,44,18,${(0.55 + pulse * 0.3).toFixed(2)})`,
    border: PALETTE.gold,
    radius: 4,
    shadow: false,
  });
  ui.text(label, badge.x + badge.w / 2, badge.y + badge.h / 2, {
    size: 13,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    bold: true,
    alpha: 0.75 + pulse * 0.25,
  });
}

function drawProgress(ui: Ui, state: HudState): void {
  const cx = ui.width / 2;

  ui.text(state.roomName.toUpperCase(), cx, 26, {
    size: 15,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 3,
    outline: true,
  });

  ui.text(`комната ${state.roomIndex + 1} / ${state.totalRooms}`, cx, 46, {
    size: 11,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 1.5,
  });

  // Remaining defenders.
  const w = 240;
  const barRect = rect(cx - w / 2, 58, w, 6);
  const fraction = state.humansTotal > 0 ? state.humansAlive / state.humansTotal : 0;
  ui.bar(barRect, fraction, { color: '#8b2a30', radius: 2 });

  const label = state.cleared ? 'ЗАЧИЩЕНО — ИДИ К ПОРТАЛУ' : `осталось ${state.humansAlive}`;
  ui.text(label, cx, 76, {
    size: 12,
    color: state.cleared ? PALETTE.gold : PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    bold: state.cleared,
    letterSpacing: state.cleared ? 1.5 : 0,
  });
}

function drawResources(ui: Ui, state: HudState): void {
  const x = ui.width - 24;
  const { tracker, monster } = state;

  // Souls.
  ui.swatch(x - 96, 26, '#9fd7ff', 5);
  ui.text(`${Math.floor(monster.souls)}`, x, 26, {
    size: 18,
    color: '#cfeaff',
    align: 'right',
    baseline: 'middle',
    bold: true,
  });
  ui.text('душ', x - 86, 26, { size: 12, color: PALETTE.muted, baseline: 'middle' });

  const rows: Array<[string, string]> = [
    ['убито', `${tracker.totalKills}`],
    ['время', formatTime(tracker.elapsed)],
    ['урон', formatNumber(tracker.totalDamageDealt)],
    ['DPS', formatNumber(tracker.averageDps)],
  ];

  rows.forEach(([label, value], i) => {
    const y = 52 + i * 17;
    ui.text(label, x - 78, y, { size: 11, color: PALETTE.dim, baseline: 'middle' });
    ui.text(value, x, y, {
      size: 12,
      color: PALETTE.muted,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
  });
}

function drawDash(ui: Ui, monster: Monster): void {
  const y = ui.height - 34;
  const x = 28;
  const max = monster.stats.getInt('dashCharges');

  for (let i = 0; i < max; i++) {
    const cx = x + i * 26;
    const filled = i < monster.dashChargesAvailable;

    ui.ctx.save();
    ui.ctx.beginPath();
    ui.ctx.arc(cx, y, 9, 0, TAU);
    ui.ctx.fillStyle = filled ? 'rgba(190,120,255,0.75)' : 'rgba(40,36,46,0.8)';
    ui.ctx.fill();
    ui.ctx.strokeStyle = filled ? '#c9a0ff' : 'rgba(120,110,130,0.4)';
    ui.ctx.lineWidth = 1.4;
    ui.ctx.stroke();

    // The recharging pip fills clockwise.
    if (!filled && i === monster.dashChargesAvailable) {
      ui.ctx.beginPath();
      ui.ctx.moveTo(cx, y);
      ui.ctx.arc(cx, y, 9, -Math.PI / 2, -Math.PI / 2 + TAU * monster.dashCooldownFraction);
      ui.ctx.closePath();
      ui.ctx.fillStyle = 'rgba(150,100,210,0.45)';
      ui.ctx.fill();
    }
    ui.ctx.restore();
  }

  ui.text('ПРОБЕЛ — рывок', x - 6, y + 22, { size: 11, color: PALETTE.dim, baseline: 'middle' });
}

function drawBuild(ui: Ui, state: HudState): void {
  if (state.skills.length === 0) return;

  const right = ui.width - 24;
  const bottom = ui.height - 24;
  const perRow = 10;
  const size = 22;
  const gap = 4;

  const rows = Math.ceil(state.skills.length / perRow);

  state.skills.forEach((entry, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const countInRow = Math.min(perRow, state.skills.length - row * perRow);
    const rowWidth = countInRow * size + (countInRow - 1) * gap;

    const x = right - rowWidth + col * (size + gap);
    const y = bottom - (rows - row) * (size + gap);

    const style = RARITY[entry.card.rarity];
    ui.ctx.fillStyle = 'rgba(12,11,15,0.85)';
    ui.ctx.fillRect(x, y, size, size);
    ui.ctx.strokeStyle = style.color;
    ui.ctx.lineWidth = 1.4;
    ui.ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);

    ui.text(entry.card.name.slice(0, 1), x + size / 2, y + size / 2, {
      size: 13,
      color: style.glow,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (entry.stacks > 1) {
      ui.text(`${entry.stacks}`, x + size - 2, y + size - 1, {
        size: 9,
        color: PALETTE.ink,
        align: 'right',
        baseline: 'bottom',
        outline: true,
      });
    }

    // Tooltip on hover.
    const zone = ui.hitZone(rect(x, y, size, size));
    if (zone.hovered) drawSkillTooltip(ui, entry.card, entry.stacks, x + size / 2, y - 8);
  });

  ui.text('TAB — статистика', right, bottom - rows * (size + gap) - 12, {
    size: 11,
    color: PALETTE.dim,
    align: 'right',
    baseline: 'middle',
  });
}

function drawSkillTooltip(
  ui: Ui,
  card: SkillCard,
  stacks: number,
  anchorX: number,
  anchorY: number,
): void {
  const width = 250;
  const padding = 12;
  const ctx = ui.ctx;

  ctx.save();
  ctx.font = `13px Georgia, serif`;
  const bodyHeight = estimateWrappedHeight(ctx, card.description, width - padding * 2, 13 * 1.4);
  ctx.restore();

  const height = 46 + bodyHeight;
  const x = clamp(anchorX - width / 2, 8, ui.width - width - 8);
  const y = anchorY - height;

  ui.panel(rect(x, y, width, height), { border: RARITY[card.rarity].color });

  ui.text(card.name, x + padding, y + 20, { size: 15, color: RARITY[card.rarity].glow, bold: true });
  ui.text(
    stacks > 1 ? `${RARITY[card.rarity].name} ×${stacks}` : RARITY[card.rarity].name,
    x + width - padding,
    y + 20,
    { size: 11, color: PALETTE.muted, align: 'right' },
  );
  ui.paragraph(card.description, x + padding, y + 42, width - padding * 2, {
    size: 13,
    color: PALETTE.muted,
  });
}

function estimateWrappedHeight(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  lineHeight: number,
): number {
  const words = text.split(' ');
  let lines = 1;
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines++;
      line = word;
    } else {
      line = candidate;
    }
  }
  return lines * lineHeight;
}

function drawBossBar(ui: Ui, state: HudState): void {
  const w = Math.min(560, ui.width - 120);
  const x = (ui.width - w) / 2;
  const y = ui.height - 74;

  ui.text(state.bossName!.toUpperCase(), ui.width / 2, y - 12, {
    size: 15,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 4,
    outline: true,
  });

  ui.bar(rect(x, y, w, 14), state.bossHealth, {
    color: '#b5252d',
    background: 'rgba(0,0,0,0.7)',
  });
}

function drawHints(ui: Ui, state: HudState): void {
  // The core mechanic needs saying exactly once, early.
  if (state.elapsed > 14 || state.roomIndex > 0) return;

  const alpha = state.elapsed < 2 ? state.elapsed / 2 : state.elapsed > 11 ? (14 - state.elapsed) / 3 : 1;

  ui.text('ТЫ БЬЁШЬ САМ — ДАЖЕ НА БЕГУ', ui.width / 2, ui.height - 120, {
    size: 16,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 3,
    alpha: clamp(alpha, 0, 1),
    outline: true,
  });
  ui.text('WASD — движение · остановишься — бьёшь точнее', ui.width / 2, ui.height - 98, {
    size: 12,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    alpha: clamp(alpha, 0, 1),
  });
}

/** Colour for a damage type, exported for other screens. */
export function typeColor(type: keyof typeof DAMAGE_INFO): string {
  return DAMAGE_INFO[type].color;
}
