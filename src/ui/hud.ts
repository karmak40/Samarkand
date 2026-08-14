import { DAMAGE_INFO } from '../combat/damage';
import { STATUS_DEFS } from '../combat/status';
import { clamp, TAU } from '../core/math';
import type { Monster } from '../entities/monster';
import { t } from '../i18n';
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
 * Below this width, the four independent top corners start to overlap: the health
 * cluster's fixed 300px runs to about x=324, the resource column starts around
 * x=width-136, and the room name centred between them needs real room of its own —
 * squeezed enough that even a shrunk title starts to look cramped rather than merely
 * compact. A phone in portrait is comfortably under this, a tablet comfortably over.
 */
const COMPACT_WIDTH = 680;

/**
 * In-game overlay.
 *
 * Layout principle: the four corners carry state you glance at (health, progress,
 * resources, build), and the centre stays clear so nothing hides the fight. Below
 * `COMPACT_WIDTH` there is no room for four independent corners, so the top cluster
 * collapses into a single centred stack instead — same information, read top to
 * bottom rather than glanced at in four places.
 */
export function drawHud(ui: Ui, state: HudState): void {
  const { monster } = state;

  drawHurtVignette(ui, state.hurtFlash);

  if (ui.width < COMPACT_WIDTH) {
    drawCompactCluster(ui, state);
  } else {
    drawHealthCluster(ui, state);
    drawExperience(ui, state);
    drawProgress(ui, state);
    drawResources(ui, state);
  }

  drawDash(ui, monster);
  drawBoons(ui, state);
  drawBuild(ui, state);
  if (state.bossName) drawBossBar(ui, state);
  drawHints(ui, state);
}

/**
 * Health, experience, room progress and the run's headline numbers, stacked as one
 * centred column instead of four corners.
 *
 * The four numbers on the right (kills, time, damage, DPS) are condensed to one line
 * rather than dropped — they are the reason the results screen at the end of a run is
 * worth reading, so the mid-run version should not go dark just because the screen is
 * narrow.
 */
function drawCompactCluster(ui: Ui, state: HudState): void {
  const { monster, tracker } = state;
  const margin = 14;
  const w = ui.width - margin * 2;
  let y = 12;

  // Health.
  const hpRect = rect(margin, y, w, 18);
  ui.bar(hpRect, monster.healthFraction, {
    color: monster.healthFraction < 0.3 ? PALETTE.bloodBright : PALETTE.blood,
  });
  ui.text(`${Math.ceil(monster.hp)} / ${Math.round(monster.maxHp)}`, ui.width / 2, y + 9, {
    size: 12,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    bold: true,
    outline: true,
  });
  if (monster.shield > 0) {
    const fraction = clamp(monster.shield / monster.maxHp, 0, 1);
    ui.ctx.save();
    ui.roundRect(hpRect, 3);
    ui.ctx.clip();
    ui.ctx.fillStyle = 'rgba(140,190,255,0.55)';
    ui.ctx.fillRect(margin, y, w * fraction, 18);
    ui.ctx.restore();
  }
  y += 22;

  // Status effects — small, and skipped entirely rather than wrapped to a second
  // row if there isn't room; the health bar above already carries the urgency.
  if (monster.statuses.size > 0) {
    let sx = margin;
    for (const status of monster.statuses.list()) {
      if (sx + 18 > ui.width - margin) break;
      const def = STATUS_DEFS[status.id];
      ui.ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ui.ctx.fillRect(sx, y, 18, 18);
      ui.ctx.strokeStyle = def.color;
      ui.ctx.lineWidth = 1.2;
      ui.ctx.strokeRect(sx + 0.5, y + 0.5, 17, 17);
      ui.text(def.name.slice(0, 1), sx + 9, y + 9, {
        size: 11,
        color: def.color,
        align: 'center',
        baseline: 'middle',
        bold: true,
      });
      if (status.stacks > 1) {
        ui.text(`${status.stacks}`, sx + 17, y + 17, {
          size: 9,
          color: PALETTE.ink,
          align: 'right',
          baseline: 'bottom',
          outline: true,
        });
      }
      sx += 22;
    }
    y += 24;
  }

  // Experience.
  ui.bar(rect(margin, y, w, 6), monster.xpFraction, {
    color: '#7fb2ff',
    background: 'rgba(0,0,0,0.55)',
    radius: 2,
  });
  y += 16;

  // Level (left) and souls (right) share the row the desktop layout gives each its
  // own corner for.
  ui.text(t('hud.levelAbbrev', { n: monster.level }), margin, y, {
    size: 11,
    color: PALETTE.muted,
    baseline: 'middle',
    bold: true,
  });
  ui.swatch(ui.width / 2 + 4, y, '#9fd7ff', 4);
  ui.text(`${Math.floor(monster.souls)}`, ui.width - margin, y, {
    size: 13,
    color: '#cfeaff',
    align: 'right',
    baseline: 'middle',
    bold: true,
  });
  y += 18;

  // Room name and progress.
  ui.fittedText(state.roomName.toUpperCase(), ui.width / 2, y, {
    size: 14,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 2,
    outline: true,
    maxWidth: w,
  });
  y += 16;
  ui.text(t('hud.roomProgress', { i: state.roomIndex + 1, n: state.totalRooms }), ui.width / 2, y, {
    size: 10,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 1,
  });
  y += 14;

  const defenderW = Math.min(200, w);
  ui.bar(rect(ui.width / 2 - defenderW / 2, y, defenderW, 5),
    state.humansTotal > 0 ? state.humansAlive / state.humansTotal : 0,
    { color: '#8b2a30', radius: 2 },
  );
  y += 16;

  const label = state.cleared ? t('hud.cleared') : t('hud.remaining', { n: state.humansAlive });
  ui.text(label, ui.width / 2, y, {
    size: 11,
    color: state.cleared ? PALETTE.gold : PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    bold: state.cleared,
  });
  y += 18;

  // The run's headline numbers, condensed to one line rather than a four-row column.
  const line = [
    `${t('hud.killedShort')} ${tracker.totalKills}`,
    formatTime(tracker.elapsed),
    formatNumber(tracker.totalDamageDealt),
    `${formatNumber(tracker.averageDps)} dps`,
  ].join('   ·   ');
  ui.fittedText(line, ui.width / 2, y, {
    size: 10,
    color: PALETTE.dim,
    align: 'center',
    baseline: 'middle',
    maxWidth: w,
  });

  if (monster.isFrenzied) {
    ui.text(t('hud.frenzy'), ui.width / 2, y + 16, {
      size: 11,
      color: '#ffb347',
      align: 'center',
      bold: true,
      letterSpacing: 1,
      baseline: 'middle',
    });
  }
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
    ui.text(t('hud.frenzy'), x, sy + (monster.statuses.size > 0 ? 34 : 8), {
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
 * Sits directly under the health bar because the two are read together. There is no
 * "claim your level" prompt: the draft opens by itself the moment the bar fills, so
 * the only job here is showing how close the next one is.
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

  ui.text(t('hud.levelAbbrev', { n: monster.level }), x, y + 20, {
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
}

function drawProgress(ui: Ui, state: HudState): void {
  const cx = ui.width / 2;

  // The health cluster ends around x=324 and the resource column starts around
  // x=width-136; a long arena name (a boss suffix appended to a settlement name, in a
  // wordier locale) can still reach past either at the narrow end of this layout's
  // range, so it shrinks to whatever room is actually free between them rather than
  // assuming a generous window.
  const centerRoom = Math.max(80, ui.width - 136 - 340);
  ui.fittedText(state.roomName.toUpperCase(), cx, 26, {
    size: 15,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 3,
    outline: true,
    maxWidth: centerRoom,
  });

  ui.text(t('hud.roomProgress', { i: state.roomIndex + 1, n: state.totalRooms }), cx, 46, {
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

  const label = state.cleared ? t('hud.cleared') : t('hud.remaining', { n: state.humansAlive });
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
  ui.text(t('hud.soulsLabel'), x - 86, 26, { size: 12, color: PALETTE.muted, baseline: 'middle' });

  const rows: Array<[string, string]> = [
    [t('hud.killedShort'), `${tracker.totalKills}`],
    [t('hud.timeShort'), formatTime(tracker.elapsed)],
    [t('hud.damageShort'), formatNumber(tracker.totalDamageDealt)],
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

  ui.text(t('hint.dash'), x - 6, y + 22, { size: 11, color: PALETTE.dim, baseline: 'middle' });
}

/**
 * Active temporary forms, bottom-centre.
 *
 * A boon changes how the monster plays as much as how it looks, so its remaining
 * time needs to be readable at a glance — the bar drains and the whole chip flashes
 * over the last three seconds.
 */
function drawBoons(ui: Ui, state: HudState): void {
  const boons = state.monster.activeBoons;
  if (boons.length === 0) return;

  const gap = 8;
  // Shrinks once boons.length would otherwise run the row past the screen edge —
  // rare on a desktop window, routine on a phone where two temporary forms already
  // fill the width.
  const chipW = Math.max(84, Math.min(150, (ui.width - 32 - (boons.length - 1) * gap) / boons.length));
  const chipH = 34;
  const totalW = boons.length * chipW + (boons.length - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  const y = ui.height - 86;

  boons.forEach((boon, i) => {
    const x = startX + i * (chipW + gap);
    const fraction = clamp(boon.remaining / boon.total, 0, 1);
    const expiring = boon.remaining < 3;
    const flash = expiring ? 0.55 + 0.45 * Math.sin(state.elapsed * 12) : 1;

    ui.panel(rect(x, y, chipW, chipH), {
      fill: 'rgba(12,11,15,0.86)',
      border: boon.def.color,
      radius: 4,
      shadow: false,
    });

    ui.fittedText(boon.def.name, x + chipW / 2, y + 12, {
      size: 12,
      color: boon.def.color,
      align: 'center',
      baseline: 'middle',
      bold: true,
      alpha: flash,
      maxWidth: chipW - 28,
    });

    ui.bar(rect(x + 8, y + 22, chipW - 16, 5), fraction, {
      color: boon.def.color,
      background: 'rgba(0,0,0,0.6)',
      radius: 2,
      border: false,
    });

    ui.text(`${Math.ceil(boon.remaining)}`, x + chipW - 6, y + 12, {
      size: 11,
      color: expiring ? PALETTE.bad : PALETTE.dim,
      align: 'right',
      baseline: 'middle',
      alpha: flash,
    });
  });
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

  ui.text(t('hint.buildSheet'), right, bottom - rows * (size + gap) - 12, {
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

  ui.fittedText(state.bossName!.toUpperCase(), ui.width / 2, y - 12, {
    size: 15,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 4,
    outline: true,
    maxWidth: ui.width - 32,
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

  const maxWidth = ui.width - 32;
  ui.fittedText(t('hint.autoAttackTitle'), ui.width / 2, ui.height - 120, {
    size: 16,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 3,
    alpha: clamp(alpha, 0, 1),
    outline: true,
    maxWidth,
  });
  ui.fittedText(t('hint.autoAttackSub'), ui.width / 2, ui.height - 98, {
    size: 12,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    alpha: clamp(alpha, 0, 1),
    maxWidth,
  });
}

/** Colour for a damage type, exported for other screens. */
export function typeColor(type: keyof typeof DAMAGE_INFO): string {
  return DAMAGE_INFO[type].color;
}
