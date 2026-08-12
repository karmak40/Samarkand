import { DAMAGE_INFO, DAMAGE_TYPES, type DamageType } from '../combat/damage';
import type { Input } from '../core/input';
import { clamp, TAU } from '../core/math';
import type { Monster } from '../entities/monster';
import { type Mutation } from '../progression/evolution';
import { META_UPGRADES, type MetaProgress } from '../progression/meta';
import { RARITY, type SkillCard } from '../progression/skills';
import { formatStat, LOWER_IS_BETTER, STAT_LABELS, type StatKey } from '../progression/stats';
import type { RunStats } from '../stats/tracker';
import { formatNumber, formatTime, PALETTE, rect, type Ui } from './widgets';

/** Cards the player can pick from, plus a reroll. */
export interface CardChoiceResult {
  picked: number;
  rerolled: boolean;
}

/**
 * Post-room card draft.
 *
 * Three cards, keyboard shortcuts 1-3, and an optional reroll priced in souls.
 * The whole screen is modal — the simulation is paused behind it.
 */
export function drawCardSelect(
  ui: Ui,
  input: Input,
  cards: readonly SkillCard[],
  context: { title: string; subtitle: string; rerollCost: number; souls: number; canReroll: boolean },
): CardChoiceResult {
  ui.scrim(0.82);

  const result: CardChoiceResult = { picked: -1, rerolled: false };

  ui.text(context.title, ui.width / 2, 78, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
  });
  ui.text(context.subtitle, ui.width / 2, 112, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  // Floors keep the layout sane on very small windows instead of producing
  // negative-sized panels.
  const cardW = Math.max(120, Math.min(280, (ui.width - 120) / Math.max(1, cards.length) - 24));
  const cardH = Math.max(200, Math.min(380, ui.height - 300));
  const gap = 26;
  const totalW = cards.length * cardW + (cards.length - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  const cardY = ui.height / 2 - cardH / 2 + 20;

  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap);
    const zone = ui.hitZone(rect(x, cardY, cardW, cardH));
    const hovered = zone.hovered;
    const style = RARITY[card.rarity];

    // Hovered card lifts slightly — cheap, readable affordance.
    const lift = hovered ? 8 : 0;
    const bounds = rect(x, cardY - lift, cardW, cardH);

    ui.panel(bounds, {
      fill: hovered ? 'rgba(30,26,32,0.97)' : 'rgba(16,15,19,0.95)',
      border: hovered ? style.glow : style.color,
      radius: 8,
    });

    // Rarity glow along the top edge.
    const ctx = ui.ctx;
    ctx.save();
    ui.roundRect(bounds, 8);
    ctx.clip();
    const grad = ctx.createLinearGradient(0, bounds.y, 0, bounds.y + 90);
    grad.addColorStop(0, hexToRgba(style.color, hovered ? 0.4 : 0.22));
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(bounds.x, bounds.y, bounds.w, 90);
    ctx.restore();

    drawCardSigil(ui, card, bounds.x + bounds.w / 2, bounds.y + 74, style.glow, hovered);

    ui.text(style.name.toUpperCase(), bounds.x + bounds.w / 2, bounds.y + 24, {
      size: 11,
      color: style.color,
      align: 'center',
      baseline: 'middle',
      letterSpacing: 3,
      bold: true,
    });

    ui.text(card.name, bounds.x + bounds.w / 2, bounds.y + 140, {
      size: 21,
      color: PALETTE.ink,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    ui.paragraph(card.description, bounds.x + 20, bounds.y + 178, bounds.w - 40, {
      size: 14,
      color: PALETTE.muted,
      align: 'left',
      lineHeight: 20,
    });

    // Tags along the bottom.
    let tagX = bounds.x + 18;
    const tagY = bounds.y + bounds.h - 46;
    for (const tag of card.tags) {
      const w = ui.ctx.measureText(tag).width + 18;
      ui.panel(rect(tagX, tagY, w, 20), {
        fill: 'rgba(255,255,255,0.05)',
        border: 'rgba(148,138,118,0.25)',
        radius: 10,
        shadow: false,
      });
      ui.text(tag, tagX + w / 2, tagY + 10, {
        size: 11,
        color: PALETTE.muted,
        align: 'center',
        baseline: 'middle',
      });
      tagX += w + 6;
    }

    ui.text(`${i + 1}`, bounds.x + bounds.w / 2, bounds.y + bounds.h - 18, {
      size: 13,
      color: hovered ? style.glow : PALETTE.dim,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (zone.clicked) result.picked = i;
  });

  // Keyboard shortcuts.
  if (input.wasPressed('slot1') && cards.length > 0) result.picked = 0;
  if (input.wasPressed('slot2') && cards.length > 1) result.picked = 1;
  if (input.wasPressed('slot3') && cards.length > 2) result.picked = 2;

  // Reroll.
  if (context.canReroll) {
    const buttonRect = rect(ui.width / 2 - 90, cardY + cardH + 30, 180, 42);
    const affordable = context.souls >= context.rerollCost;
    if (
      ui.button(buttonRect, 'Пересдать', {
        disabled: !affordable,
        sub: `${context.rerollCost} душ`,
        accent: '#9fd7ff',
      })
    ) {
      result.rerolled = true;
    }
  }

  return result;
}

/** A generated glyph for each card, so cards are distinguishable at a glance. */
function drawCardSigil(
  ui: Ui,
  card: SkillCard,
  cx: number,
  cy: number,
  color: string,
  hovered: boolean,
): void {
  const ctx = ui.ctx;
  // Hash the id into a stable shape so the same card always looks the same.
  let hash = 0;
  for (let i = 0; i < card.id.length; i++) hash = (hash * 31 + card.id.charCodeAt(i)) >>> 0;

  // At least five points: three or four read as a bare triangle/diamond rather
  // than a sigil, and the cards look unfinished next to their neighbours.
  const spokes = 5 + (hash % 5);
  // Outer is always well clear of inner; when the two converge the "star" collapses
  // into a flat polygon and every card starts to look the same.
  const inner = 11 + (hash % 6);
  const outer = inner * (1.9 + ((hash >> 4) % 5) * 0.18);
  const twist = ((hash >> 6) % 100) / 100;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = hovered ? 1 : 0.75;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  for (let i = 0; i <= spokes * 2; i++) {
    const a = (i / (spokes * 2)) * TAU - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const px = Math.cos(a + twist) * r;
    const py = Math.sin(a + twist) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = hovered ? 0.35 : 0.18;
  ctx.fillStyle = color;
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------

/** Evolution screen — same shape as the card draft but heavier in tone. */
export function drawMutationSelect(
  ui: Ui,
  input: Input,
  mutations: readonly Mutation[],
): number {
  ui.scrim(0.88);

  ui.text('ЭВОЛЮЦИЯ', ui.width / 2, 84, {
    size: 34,
    color: '#b06cff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 12,
  });
  ui.text('Плоть требует новой формы. Выбор необратим.', ui.width / 2, 120, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  const cardW = Math.max(140, Math.min(300, (ui.width - 140) / Math.max(1, mutations.length) - 24));
  const cardH = Math.max(180, Math.min(300, ui.height - 320));
  const gap = 28;
  const totalW = mutations.length * cardW + (mutations.length - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  const y = ui.height / 2 - cardH / 2 + 20;

  let picked = -1;

  mutations.forEach((mutation, i) => {
    const x = startX + i * (cardW + gap);
    const zone = ui.hitZone(rect(x, y, cardW, cardH));
    const hovered = zone.hovered;
    const bounds = rect(x, y - (hovered ? 8 : 0), cardW, cardH);

    ui.panel(bounds, {
      fill: hovered ? 'rgba(34,24,42,0.97)' : 'rgba(18,14,22,0.95)',
      border: hovered ? '#d4a8ff' : '#6b3fa0',
      radius: 8,
    });

    ui.text(mutation.name, bounds.x + bounds.w / 2, bounds.y + 46, {
      size: 22,
      color: '#e0ccff',
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    ui.paragraph(mutation.description, bounds.x + 22, bounds.y + 92, bounds.w - 44, {
      size: 14,
      color: PALETTE.muted,
      lineHeight: 21,
    });

    ui.text(`${i + 1}`, bounds.x + bounds.w / 2, bounds.y + bounds.h - 22, {
      size: 13,
      color: hovered ? '#d4a8ff' : PALETTE.dim,
      align: 'center',
      baseline: 'middle',
      bold: true,
    });

    if (zone.clicked) picked = i;
  });

  if (input.wasPressed('slot1') && mutations.length > 0) picked = 0;
  if (input.wasPressed('slot2') && mutations.length > 1) picked = 1;
  if (input.wasPressed('slot3') && mutations.length > 2) picked = 2;

  return picked;
}

// ---------------------------------------------------------------------------

export type ResultsAction = 'none' | 'again' | 'menu';

/**
 * End-of-run report.
 *
 * Three columns: the headline numbers, how you dealt damage, and what the run
 * consisted of. Everything the tracker recorded surfaces somewhere here.
 */
export function drawResults(
  ui: Ui,
  tracker: RunStats,
  soulsEarned: number,
  meta: MetaProgress,
): ResultsAction {
  ui.scrim(0.93);

  const victory = tracker.outcome === 'victory';
  const title = victory ? 'ЗЕМЛИ ОБЕЗЛЮДЕЛИ' : 'ТЬМА РАССЕЯЛАСЬ';
  const accent = victory ? PALETTE.gold : PALETTE.blood;

  ui.text(title, ui.width / 2, 56, {
    size: 32,
    color: accent,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 9,
  });

  const subtitle = victory
    ? `Ни одна деревня не устояла. ${tracker.roomsCleared} поселений сожжено.`
    : `Тебя остановил: ${tracker.killedBy || 'неизвестно'} — на ${tracker.roomsCleared + 1}-й комнате.`;
  ui.text(subtitle, ui.width / 2, 88, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
  });

  const margin = 40;
  const columnGap = 24;
  const columnW = (ui.width - margin * 2 - columnGap * 2) / 3;
  const top = 124;
  const bodyH = ui.height - top - 96;

  drawResultsOverview(ui, tracker, soulsEarned, rect(margin, top, columnW, bodyH));
  drawResultsDamage(ui, tracker, rect(margin + columnW + columnGap, top, columnW, bodyH));
  drawResultsRun(ui, tracker, rect(margin + (columnW + columnGap) * 2, top, columnW, bodyH));

  // Footer.
  const buttonY = ui.height - 62;
  let action: ResultsAction = 'none';

  if (ui.button(rect(ui.width / 2 - 210, buttonY, 200, 46), 'Снова', { accent: PALETTE.gold })) {
    action = 'again';
  }
  if (ui.button(rect(ui.width / 2 + 10, buttonY, 200, 46), 'В логово', { accent: '#9fd7ff' })) {
    action = 'menu';
  }

  ui.text(
    `Всего душ: ${Math.floor(meta.souls)}`,
    ui.width / 2,
    ui.height - 18,
    { size: 12, color: PALETTE.dim, align: 'center', baseline: 'middle' },
  );

  return action;
}

function drawResultsOverview(ui: Ui, tracker: RunStats, soulsEarned: number, bounds: ReturnType<typeof rect>): void {
  ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading('ИТОГ', x, y, w);
  y += 26;

  const rows: Array<[string, string, string?]> = [
    ['Убито людей', `${tracker.totalKills}`],
    ['Комнат пройдено', `${tracker.roomsCleared}`],
    ['Зданий разрушено', `${tracker.buildingsDestroyed}`],
    ['Время', formatTime(tracker.elapsed)],
    ['Душ собрано', `${Math.floor(soulsEarned)}`, '#9fd7ff'],
    ['Убийств в минуту', tracker.killsPerMinute.toFixed(1)],
    ['Лучшая серия', `${tracker.bestKillStreak}`],
    ['Комнат без урона', `${tracker.perfectRooms}`],
  ];

  for (const [label, value, color] of rows) {
    ui.statRow(label, value, x, y, w, { color: color ?? PALETTE.ink });
    y += 22;
  }

  y += 14;
  ui.heading('ВЫЖИВАНИЕ', x, y, w);
  y += 26;

  const survival: Array<[string, string]> = [
    ['Получено урона', formatNumber(tracker.totalDamageTaken)],
    ['Раз получил удар', `${tracker.timesHit}`],
    ['Уклонений', `${tracker.dodgesPerformed}`],
    ['Вылечено', formatNumber(tracker.healingReceived)],
    ['Из них вампиризмом', formatNumber(tracker.lifestealHealing)],
    ['Минимум здоровья', `${(tracker.lowestHealthFraction * 100).toFixed(0)}%`],
    ['На волоске', `${tracker.closeCalls}`],
    ['Рывков', `${tracker.dashesUsed}`],
  ];

  for (const [label, value] of survival) {
    ui.statRow(label, value, x, y, w, {});
    y += 22;
  }

  y += 10;
  ui.heading('ОПАСНОСТИ', x, y, w);
  y += 24;

  for (const threat of tracker.topThreats.slice(0, 4)) {
    ui.statRow(threat.label, formatNumber(threat.damage), x, y, w, { color: PALETTE.bad, size: 13 });
    y += 20;
  }
}

function drawResultsDamage(ui: Ui, tracker: RunStats, bounds: ReturnType<typeof rect>): void {
  ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading('УРОН', x, y, w);
  y += 26;

  const damageRows: Array<[string, string]> = [
    ['Всего нанесено', formatNumber(tracker.totalDamageDealt)],
    ['Средний DPS', formatNumber(tracker.averageDps)],
    ['Пиковый DPS', formatNumber(tracker.peakDps)],
    ['Крупнейший удар', formatNumber(tracker.largestHit)],
    ['Источник', tracker.largestHitSource],
    ['Крит', `${(tracker.critRate * 100).toFixed(0)}%`],
    ['Точность', `${(tracker.accuracy * 100).toFixed(0)}%`],
    ['Перебор урона', formatNumber(tracker.totalOverkill)],
  ];

  for (const [label, value] of damageRows) {
    ui.statRow(label, value, x, y, w, {});
    y += 22;
  }

  y += 14;
  ui.heading('ПО ТИПАМ', x, y, w);
  y += 22;

  const segments = DAMAGE_TYPES.filter((t) => tracker.damageDealtByType[t] > 0).map((t) => ({
    value: tracker.damageDealtByType[t],
    color: DAMAGE_INFO[t].color,
    type: t,
  }));

  ui.stackedBar(rect(x, y, w, 12), segments);
  y += 24;

  for (const segment of segments.sort((a, b) => b.value - a.value)) {
    const share = tracker.totalDamageDealt > 0 ? segment.value / tracker.totalDamageDealt : 0;
    ui.swatch(x + 5, y, segment.color, 4);
    ui.text(DAMAGE_INFO[segment.type as DamageType].name, x + 16, y, {
      size: 13,
      color: PALETTE.muted,
      baseline: 'middle',
    });
    ui.text(`${formatNumber(segment.value)}  ${(share * 100).toFixed(0)}%`, x + w, y, {
      size: 13,
      color: segment.color,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
    y += 20;
  }

  y += 12;
  ui.heading('DPS ПО ВРЕМЕНИ', x, y, w);
  y += 18;
  ui.lineChart(rect(x, y, w, 76), tracker.dpsSeries.map((s) => s.damage));
  y += 92;

  ui.heading('ИСТОЧНИКИ', x, y, w);
  y += 22;
  for (const source of tracker.topDamageSources.slice(0, 5)) {
    ui.statRow(source.label, formatNumber(source.damage), x, y, w, { size: 13 });
    y += 19;
  }
}

function drawResultsRun(ui: Ui, tracker: RunStats, bounds: ReturnType<typeof rect>): void {
  ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading('ЖЕРТВЫ', x, y, w);
  y += 24;

  const kills = tracker.killList.slice(0, 8);
  const maxKills = kills[0]?.count ?? 1;
  for (const kill of kills) {
    // Inline bar behind the row conveys proportion without a second chart.
    const ctx = ui.ctx;
    ctx.fillStyle = 'rgba(168,35,42,0.18)';
    ctx.fillRect(x, y - 8, w * (kill.count / maxKills), 16);

    ui.statRow(kill.name, `${kill.count}`, x + 4, y, w - 8, { size: 13 });
    y += 20;
  }

  y += 14;
  ui.heading('НАВЫКИ', x, y, w);
  y += 22;

  const skillCounts = new Map<string, { name: string; rarity: string; count: number }>();
  for (const skill of tracker.skillsTaken) {
    const entry = skillCounts.get(skill.id);
    if (entry) entry.count++;
    else skillCounts.set(skill.id, { name: skill.name, rarity: skill.rarity, count: 1 });
  }

  for (const entry of [...skillCounts.values()].slice(0, 10)) {
    const color = RARITY[entry.rarity as keyof typeof RARITY]?.color ?? PALETTE.ink;
    ui.statRow(entry.name, entry.count > 1 ? `×${entry.count}` : '•', x, y, w, {
      size: 13,
      color,
    });
    y += 19;
  }

  if (tracker.mutationsTaken.length > 0) {
    y += 12;
    ui.heading('ФОРМА', x, y, w);
    y += 22;
    for (const mutation of tracker.mutationsTaken) {
      ui.statRow(mutation.name, `комн. ${mutation.room + 1}`, x, y, w, {
        size: 13,
        color: '#c9a0ff',
      });
      y += 19;
    }
  }

  y += 12;
  ui.heading('КОМНАТЫ', x, y, w);
  y += 22;

  const fastest = tracker.fastestRoom;
  for (const room of tracker.rooms.slice(-8)) {
    const label = `${room.index + 1}. ${room.name}`;
    const color = room.perfect ? PALETTE.good : room === fastest ? PALETTE.gold : PALETTE.ink;
    ui.statRow(label, formatTime(room.duration), x, y, w, { size: 12, color });
    y += 18;
  }
}

// ---------------------------------------------------------------------------

export type MenuAction = 'none' | 'start' | 'stats' | 'back' | 'reset';

/** Title screen and soul shop. */
export function drawMainMenu(ui: Ui, meta: MetaProgress, time: number): MenuAction {
  const ctx = ui.ctx;

  // Background: slow drifting embers over a dark field.
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, ui.width, ui.height);
  drawMenuAtmosphere(ui, time);

  ui.text('SAMARKAND', ui.width / 2, ui.height * 0.2, {
    size: 56,
    color: PALETTE.blood,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 18,
  });
  ui.text('они построили города. ты пришёл раньше.', ui.width / 2, ui.height * 0.2 + 44, {
    size: 15,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    letterSpacing: 1,
  });

  let action: MenuAction = 'none';

  const buttonW = 260;
  const bx = ui.width / 2 - buttonW / 2;
  let by = ui.height * 0.38;

  if (ui.button(rect(bx, by, buttonW, 52), 'ОХОТА', { accent: PALETTE.blood, size: 18 })) {
    action = 'start';
  }
  by += 64;

  if (ui.button(rect(bx, by, buttonW, 44), 'Летопись', { accent: '#9fd7ff', size: 15 })) {
    action = 'stats';
  }

  // Soul shop.
  const shopTop = ui.height * 0.38;
  const shopW = Math.min(420, ui.width * 0.3);
  const shopX = ui.width - shopW - 40;

  ui.panel(rect(shopX, shopTop, shopW, ui.height - shopTop - 40), {
    fill: 'rgba(12,11,15,0.9)',
  });

  ui.text('ЛОГОВО', shopX + 20, shopTop + 26, {
    size: 14,
    color: PALETTE.gold,
    letterSpacing: 4,
    bold: true,
    baseline: 'middle',
  });
  ui.text(`${Math.floor(meta.souls)} душ`, shopX + shopW - 20, shopTop + 26, {
    size: 16,
    color: '#cfeaff',
    align: 'right',
    baseline: 'middle',
    bold: true,
  });

  let uy = shopTop + 52;
  const rowH = Math.max(18, Math.min(42, (ui.height - shopTop - 110) / META_UPGRADES.length));

  for (const upgrade of META_UPGRADES) {
    const level = meta.levelOf(upgrade.id);
    const cost = meta.costOf(upgrade.id);
    const maxed = cost === null;
    const affordable = !maxed && meta.souls >= cost;
    const rowRect = rect(shopX + 14, uy, shopW - 28, rowH - 4);
    const zone = ui.hitZone(rowRect);

    if (zone.hovered && !maxed) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(rowRect.x, rowRect.y, rowRect.w, rowRect.h);
    }

    ui.text(upgrade.name, rowRect.x + 8, rowRect.y + rowH / 2 - 8, {
      size: 14,
      color: maxed ? PALETTE.gold : PALETTE.ink,
      baseline: 'middle',
      bold: true,
    });
    ui.text(upgrade.description, rowRect.x + 8, rowRect.y + rowH / 2 + 8, {
      size: 11,
      color: PALETTE.dim,
      baseline: 'middle',
    });

    // Level pips.
    const pipX = rowRect.x + rowRect.w - 92;
    for (let i = 0; i < upgrade.maxLevel; i++) {
      const filled = i < level;
      ctx.fillStyle = filled ? PALETTE.gold : 'rgba(120,112,96,0.25)';
      ctx.fillRect(pipX + i * 5, rowRect.y + rowH / 2 - 8, 3, 8);
    }

    ui.text(
      maxed ? 'МАКС' : `${cost}`,
      rowRect.x + rowRect.w - 8,
      rowRect.y + rowH / 2 + 6,
      {
        size: 13,
        color: maxed ? PALETTE.gold : affordable ? '#9fd7ff' : PALETTE.dim,
        align: 'right',
        baseline: 'middle',
        bold: true,
      },
    );

    if (zone.clicked && affordable) meta.purchase(upgrade.id);
    uy += rowH;
  }

  ui.text('WASD движение · ПРОБЕЛ рывок · TAB статистика · ESC пауза', ui.width / 2, ui.height - 22, {
    size: 12,
    color: PALETTE.dim,
    align: 'center',
    baseline: 'middle',
  });

  return action;
}

function drawMenuAtmosphere(ui: Ui, time: number): void {
  const ctx = ui.ctx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // A deterministic ember field — no allocation, no particle system needed.
  for (let i = 0; i < 60; i++) {
    const seed = i * 12.9898;
    const speed = 8 + (i % 7) * 3;
    const x = ((Math.sin(seed) * 0.5 + 0.5) * ui.width + Math.sin(time * 0.2 + i) * 30) % ui.width;
    const y = (ui.height - ((time * speed + i * 137) % (ui.height + 200))) + 100;
    const alpha = 0.12 + (Math.sin(time * 2 + i) * 0.5 + 0.5) * 0.2;
    const r = 1 + (i % 3);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 5 === 0 ? '#d8a13a' : '#a8232a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------------

/** Lifetime record screen. */
export function drawLifetime(ui: Ui, meta: MetaProgress): MenuAction {
  ui.scrim(0.94);

  ui.text('ЛЕТОПИСЬ', ui.width / 2, 56, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
  });

  const l = meta.lifetime;
  const margin = 60;
  const columnW = (ui.width - margin * 2 - 40) / 2;
  const top = 108;

  // Left column: totals.
  ui.panel(rect(margin, top, columnW, ui.height - top - 110), { fill: 'rgba(12,11,15,0.85)' });
  let y = top + 30;
  const x = margin + 24;
  const w = columnW - 48;

  ui.heading('ВСЕГО', x, y, w);
  y += 26;

  const totals: Array<[string, string]> = [
    ['Забегов', `${l.runs}`],
    ['Побед', `${l.victories}`],
    ['Смертей', `${l.deaths}`],
    ['Убито людей', `${l.totalKills}`],
    ['Разрушено зданий', `${l.totalBuildings}`],
    ['Собрано душ', formatNumber(l.totalSouls)],
    ['Нанесено урона', formatNumber(l.totalDamageDealt)],
    ['Получено урона', formatNumber(l.totalDamageTaken)],
    ['Время в игре', formatTime(l.totalPlaytime)],
  ];
  for (const [label, value] of totals) {
    ui.statRow(label, value, x, y, w, {});
    y += 23;
  }

  y += 16;
  ui.heading('РЕКОРДЫ', x, y, w);
  y += 26;

  const records: Array<[string, string]> = [
    ['Глубже всего', `${l.deepestRoom} комнат`],
    ['Больше всего убийств', `${l.bestKills}`],
    ['Лучший DPS', formatNumber(l.bestDps)],
    ['Крупнейший удар', formatNumber(l.largestHit)],
    ['Больше всего душ', formatNumber(l.bestSoulsInRun)],
    ['Вложено душ', formatNumber(meta.soulsInvested())],
  ];
  for (const [label, value] of records) {
    ui.statRow(label, value, x, y, w, { color: PALETTE.gold });
    y += 23;
  }

  // Right column: preferences.
  const rx = margin + columnW + 40;
  ui.panel(rect(rx, top, columnW, ui.height - top - 110), { fill: 'rgba(12,11,15,0.85)' });
  let ry = top + 30;
  const rxi = rx + 24;
  const rw = columnW - 48;

  ui.heading('СТИХИИ', rxi, ry, rw);
  ry += 24;

  const totalElemental = DAMAGE_TYPES.reduce((sum, t) => sum + l.damageByType[t], 0);
  const segments = DAMAGE_TYPES.filter((t) => l.damageByType[t] > 0).map((t) => ({
    value: l.damageByType[t],
    color: DAMAGE_INFO[t].color,
    type: t,
  }));
  ui.stackedBar(rect(rxi, ry, rw, 12), segments);
  ry += 24;

  for (const segment of segments.sort((a, b) => b.value - a.value).slice(0, 6)) {
    const share = totalElemental > 0 ? segment.value / totalElemental : 0;
    ui.swatch(rxi + 5, ry, segment.color, 4);
    ui.text(DAMAGE_INFO[segment.type].name, rxi + 16, ry, {
      size: 13,
      color: PALETTE.muted,
      baseline: 'middle',
    });
    ui.text(`${(share * 100).toFixed(0)}%`, rxi + rw, ry, {
      size: 13,
      color: segment.color,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
    ry += 20;
  }

  ry += 14;
  ui.heading('ЖЕРТВЫ', rxi, ry, rw);
  ry += 24;

  const kills = Object.entries(l.killsByEnemy).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [id, count] of kills) {
    ui.statRow(enemyName(id), `${count}`, rxi, ry, rw, { size: 13 });
    ry += 20;
  }

  ry += 14;
  ui.heading('ЛЮБИМЫЕ НАВЫКИ', rxi, ry, rw);
  ry += 24;

  const skills = Object.entries(l.skillPicks).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [id, count] of skills) {
    ui.statRow(id, `×${count}`, rxi, ry, rw, { size: 13, color: '#9fd7ff' });
    ry += 20;
  }

  const nemesis = meta.nemesis();
  if (nemesis) {
    ry += 14;
    ui.text(`Заклятый враг: ${nemesis.name} (${nemesis.count})`, rxi, ry, {
      size: 13,
      color: PALETTE.bad,
      baseline: 'middle',
      italic: true,
    });
  }

  let action: MenuAction = 'none';
  if (ui.button(rect(ui.width / 2 - 200, ui.height - 74, 180, 44), 'Назад', { accent: '#9fd7ff' })) {
    action = 'back';
  }
  if (
    ui.button(rect(ui.width / 2 + 20, ui.height - 74, 180, 44), 'Стереть всё', {
      accent: PALETTE.blood,
    })
  ) {
    action = 'reset';
  }

  return action;
}

const ENEMY_NAMES: Record<string, string> = {
  peasant: 'Крестьянин',
  militia: 'Ополченец',
  archer: 'Лучник',
  spearman: 'Копейщик',
  crossbowman: 'Арбалетчик',
  torchbearer: 'Факельщик',
  priest: 'Жрец',
  knight: 'Рыцарь',
  ballista: 'Баллиста',
  inquisitor: 'Инквизитор',
};

function enemyName(id: string): string {
  return ENEMY_NAMES[id] ?? id;
}

// ---------------------------------------------------------------------------

/** Tab overlay: the live build sheet, shown mid-run without leaving the fight. */
export function drawBuildSheet(
  ui: Ui,
  monster: Monster,
  tracker: RunStats,
  skills: Array<{ card: SkillCard; stacks: number }>,
): void {
  ui.scrim(0.86);

  ui.text('ТВОЯ ФОРМА', ui.width / 2, 46, {
    size: 24,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
  });

  const margin = 60;
  const columnW = (ui.width - margin * 2 - 40) / 2;
  const top = 84;
  const height = ui.height - top - 70;

  // Left: stats.
  ui.panel(rect(margin, top, columnW, height), { fill: 'rgba(12,11,15,0.9)' });
  const x = margin + 24;
  const w = columnW - 48;
  let y = top + 30;

  ui.heading('ХАРАКТЕРИСТИКИ', x, y, w);
  y += 26;

  const shown: StatKey[] = [
    'maxHp',
    'damage',
    'attackSpeed',
    'critChance',
    'critDamage',
    'moveSpeed',
    'armor',
    'dodge',
    'lifesteal',
    'projectiles',
    'pierce',
    'bounce',
    'range',
    'armorPen',
    'hpRegen',
    'thorns',
  ];

  const half = Math.ceil(shown.length / 2);
  shown.forEach((key, i) => {
    const col = i < half ? 0 : 1;
    const row = i % half;
    const colX = x + col * (w / 2 + 8);
    const colW = w / 2 - 12;
    const value = monster.stats.get(key);
    const base = monster.stats.getBase(key);
    const better = LOWER_IS_BETTER.has(key) ? value < base : value > base;

    ui.statRow(STAT_LABELS[key] ?? key, formatStat(key, value), colX, y + row * 21, colW, {
      size: 12,
      color: value === base ? PALETTE.ink : better ? PALETTE.good : PALETTE.bad,
    });
  });
  y += half * 21 + 18;

  ui.heading('СТИХИИ', x, y, w);
  y += 24;

  const conversions = monster.stats.conversions();
  if (conversions.length === 0) {
    ui.text('чистая физика', x, y, { size: 13, color: PALETTE.dim, italic: true, baseline: 'middle' });
    y += 20;
  } else {
    for (const conversion of conversions) {
      const info = DAMAGE_INFO[conversion.type];
      ui.swatch(x + 5, y, info.color, 4);
      ui.text(info.name, x + 16, y, { size: 13, color: PALETTE.muted, baseline: 'middle' });
      ui.text(
        `+${(conversion.fraction * 100).toFixed(0)}% · ×${monster.stats.damageMultiplierFor(conversion.type).toFixed(2)}`,
        x + w,
        y,
        { size: 13, color: info.color, align: 'right', baseline: 'middle', bold: true },
      );
      y += 20;
    }
  }

  y += 12;
  ui.heading('ФОРМА', x, y, w);
  y += 22;
  if (tracker.mutationsTaken.length === 0) {
    ui.text('исходное тело', x, y, {
      size: 13,
      color: PALETTE.dim,
      italic: true,
      baseline: 'middle',
    });
    y += 20;
  } else {
    for (const mutation of tracker.mutationsTaken) {
      ui.swatch(x + 5, y, '#b06cff', 4);
      ui.text(mutation.name, x + 16, y, { size: 13, color: '#e0ccff', baseline: 'middle' });
      ui.text(`комн. ${mutation.room + 1}`, x + w, y, {
        size: 12,
        color: PALETTE.dim,
        align: 'right',
        baseline: 'middle',
      });
      y += 20;
    }
  }

  y += 12;
  ui.heading('ОСОБЕННОСТИ', x, y, w);
  y += 22;
  const behaviors = monster.stats.behaviorList();
  if (behaviors.length === 0) {
    ui.text('пока никаких', x, y, { size: 13, color: PALETTE.dim, italic: true, baseline: 'middle' });
  } else {
    ui.paragraph(behaviors.map(behaviorLabel).join(' · '), x, y, w, {
      size: 12,
      color: '#c9a0ff',
      lineHeight: 18,
    });
  }

  // Right: skills and live run numbers.
  const rx = margin + columnW + 40;
  ui.panel(rect(rx, top, columnW, height), { fill: 'rgba(12,11,15,0.9)' });
  const rxi = rx + 24;
  const rw = columnW - 48;
  let ry = top + 30;

  ui.heading('НАВЫКИ', rxi, ry, rw);
  ry += 26;

  if (skills.length === 0) {
    ui.text('ещё ничего не взято', rxi, ry, {
      size: 13,
      color: PALETTE.dim,
      italic: true,
      baseline: 'middle',
    });
    ry += 22;
  } else {
    for (const entry of skills) {
      const style = RARITY[entry.card.rarity];
      ui.swatch(rxi + 5, ry, style.color, 4);
      ui.text(entry.card.name, rxi + 16, ry, {
        size: 13,
        color: PALETTE.ink,
        baseline: 'middle',
      });
      if (entry.stacks > 1) {
        ui.text(`×${entry.stacks}`, rxi + rw, ry, {
          size: 12,
          color: style.color,
          align: 'right',
          baseline: 'middle',
          bold: true,
        });
      }
      ry += 19;
    }
  }

  ry += 16;
  ui.heading('ЭТОТ ЗАБЕГ', rxi, ry, rw);
  ry += 26;

  const live: Array<[string, string]> = [
    ['Убито', `${tracker.totalKills}`],
    ['Урон', formatNumber(tracker.totalDamageDealt)],
    ['DPS', formatNumber(tracker.averageDps)],
    ['Крит', `${(tracker.critRate * 100).toFixed(0)}%`],
    ['Точность', `${(tracker.accuracy * 100).toFixed(0)}%`],
    ['Получено', formatNumber(tracker.totalDamageTaken)],
    ['Душ', `${Math.floor(monster.souls)}`],
    ['Зданий', `${tracker.buildingsDestroyed}`],
  ];
  for (const [label, value] of live) {
    ui.statRow(label, value, rxi, ry, rw, { size: 13 });
    ry += 21;
  }

  ry += 12;
  ui.heading('УРОН ПО ТИПАМ', rxi, ry, rw);
  ry += 20;
  const segments = DAMAGE_TYPES.filter((t) => tracker.damageDealtByType[t] > 0).map((t) => ({
    value: tracker.damageDealtByType[t],
    color: DAMAGE_INFO[t].color,
  }));
  ui.stackedBar(rect(rxi, ry, rw, 10), segments);

  ui.text('TAB — закрыть', ui.width / 2, ui.height - 34, {
    size: 12,
    color: PALETTE.dim,
    align: 'center',
    baseline: 'middle',
  });
}

const BEHAVIOR_LABELS: Record<string, string> = {
  ricochet: 'рикошет',
  homing: 'наведение',
  explodeOnKill: 'взрыв плоти',
  burningGround: 'выжженная земля',
  poisonCloud: 'чумное облако',
  chainLightning: 'цепная гроза',
  frostNova: 'ледяная вспышка',
  soulHarvest: 'жатва душ',
  orbitingSpawn: 'выводок',
  rageAtLowHp: 'берсерк',
  executeWeak: 'добивание',
  bleedOnCrit: 'кровопускание',
  curseOnHit: 'проклятие',
  fearOnKill: 'устрашающий рёв',
  deathBlossom: 'смертный цвет',
  devourCorpses: 'пожиратель',
  razeBuildings: 'разрушитель',
  terrorAura: 'аура ужаса',
  secondWind: 'второе дыхание',
  glassCannon: 'хрупкая ярость',
};

function behaviorLabel(flag: string): string {
  return BEHAVIOR_LABELS[flag] ?? flag;
}

// ---------------------------------------------------------------------------

export type PauseAction = 'none' | 'resume' | 'menu';

export function drawPause(ui: Ui): PauseAction {
  ui.scrim(0.78);

  ui.text('ПАУЗА', ui.width / 2, ui.height / 2 - 90, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
  });

  let action: PauseAction = 'none';
  if (ui.button(rect(ui.width / 2 - 120, ui.height / 2 - 30, 240, 48), 'Продолжить')) {
    action = 'resume';
  }
  if (
    ui.button(rect(ui.width / 2 - 120, ui.height / 2 + 30, 240, 44), 'Бросить забег', {
      accent: PALETTE.blood,
    })
  ) {
    action = 'menu';
  }

  ui.text('ESC — продолжить', ui.width / 2, ui.height / 2 + 100, {
    size: 12,
    color: PALETTE.dim,
    align: 'center',
    baseline: 'middle',
  });

  return action;
}

/** Between-room banner announcing the next settlement. */
export function drawRoomIntro(ui: Ui, name: string, index: number, progress: number): void {
  // Fade in over the first third, hold, fade out over the last third.
  const alpha = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;

  ui.text(`КОМНАТА ${index + 1}`, ui.width / 2, ui.height / 2 - 26, {
    size: 13,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 6,
    alpha: clamp(alpha, 0, 1),
    outline: true,
  });
  ui.text(name.toUpperCase(), ui.width / 2, ui.height / 2 + 6, {
    size: 34,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    alpha: clamp(alpha, 0, 1),
    outline: true,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
