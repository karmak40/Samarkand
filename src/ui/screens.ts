import { DAMAGE_INFO, DAMAGE_TYPES } from '../combat/damage';
import type { Input } from '../core/input';
import { clamp, TAU } from '../core/math';
import { HUMAN_ARCHETYPES } from '../entities/human';
import type { Monster } from '../entities/monster';
import { t } from '../i18n';
import { type AbilityDef } from '../progression/abilities';
import {
  achievementName,
  type AchievementDef,
} from '../progression/achievements';
import { type Curse, getCurse } from '../progression/curses';
import { dailySeed, formatCountdown, secondsUntilNextDaily, seedLabel } from '../progression/daily';
import { type Mutation } from '../progression/evolution';
import { type MetaProgress } from '../progression/meta';
import { RARITY, tagLabel, type SkillCard } from '../progression/skills';
import { formatStat, LOWER_IS_BETTER, statLabel, type StatKey } from '../progression/stats';
import type { RunStats } from '../stats/tracker';
import { drawCurseList } from './run-screens';
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

  ui.fittedText(context.title, ui.width / 2, 78, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(context.subtitle, ui.width / 2, 112, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  // Below this, three cards can't hold a floor width wide enough to read a
  // description in without the row running off both edges of the screen — they
  // stack into one column instead, each full width.
  const stacked = ui.width < 640;
  let cardsBottom: number;

  if (!stacked) {
    // Floors keep the layout sane on very small windows instead of producing
    // negative-sized panels.
    const cardW = Math.max(120, Math.min(280, (ui.width - 120) / Math.max(1, cards.length) - 24));
    const cardH = Math.max(200, Math.min(380, ui.height - 300));
    const gap = 26;
    const totalW = cards.length * cardW + (cards.length - 1) * gap;
    const startX = (ui.width - totalW) / 2;
    const cardY = ui.height / 2 - cardH / 2 + 20;
    cardsBottom = cardY + cardH;

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
        const label = tagLabel(tag);
        const w = ui.ctx.measureText(label).width + 18;
        ui.panel(rect(tagX, tagY, w, 20), {
          fill: 'rgba(255,255,255,0.05)',
          border: 'rgba(148,138,118,0.25)',
          radius: 10,
          shadow: false,
        });
        ui.text(label, tagX + w / 2, tagY + 10, {
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
  } else {
    cardsBottom = drawStackedCards(ui, cards, 140, ui.height - (context.canReroll ? 110 : 50), (i, clicked) => {
      if (clicked) result.picked = i;
    });
  }

  // Keyboard shortcuts.
  if (input.wasPressed('slot1') && cards.length > 0) result.picked = 0;
  if (input.wasPressed('slot2') && cards.length > 1) result.picked = 1;
  if (input.wasPressed('slot3') && cards.length > 2) result.picked = 2;

  // Reroll.
  if (context.canReroll) {
    const buttonRect = rect(ui.width / 2 - 90, cardsBottom + 22, 180, 42);
    const affordable = context.souls >= context.rerollCost;
    if (
      ui.button(buttonRect, t('cardDraft.reroll'), {
        disabled: !affordable,
        sub: t('unit.souls', { n: context.rerollCost }),
        accent: '#9fd7ff',
      })
    ) {
      result.rerolled = true;
    }
  }

  return result;
}

/**
 * Cards stacked full-width, for windows too narrow to hold three side by side.
 *
 * Same information as the wide layout — sigil, rarity, name, description, index —
 * in a row instead of a card, sized to fit whatever vertical room is actually
 * available rather than a fixed height that would either overflow a short window or
 * waste a tall one.
 *
 * Returns the y just past the last row, so the caller can place what comes next
 * (the reroll button) without duplicating this layout's numbers.
 */
function drawStackedCards(
  ui: Ui,
  cards: readonly SkillCard[],
  top: number,
  bottom: number,
  onCard: (index: number, clicked: boolean) => void,
): number {
  const margin = 20;
  const w = ui.width - margin * 2;
  const gap = 10;
  const n = Math.max(1, cards.length);
  const rowH = clamp((bottom - top - gap * (n - 1)) / n, 76, 128);

  cards.forEach((card, i) => {
    const y = top + i * (rowH + gap);
    const bounds = rect(margin, y, w, rowH);
    const zone = ui.hitZone(bounds);
    const hovered = zone.hovered;
    const style = RARITY[card.rarity];

    ui.panel(bounds, {
      fill: hovered ? 'rgba(30,26,32,0.97)' : 'rgba(16,15,19,0.95)',
      border: hovered ? style.glow : style.color,
      radius: 8,
    });

    const sigilX = bounds.x + 32;
    drawCardSigil(ui, card, sigilX, bounds.y + bounds.h / 2, style.glow, hovered);

    const textX = bounds.x + 62;
    ui.fittedText(card.name, textX, bounds.y + 20, {
      size: 16,
      color: PALETTE.ink,
      baseline: 'middle',
      bold: true,
      maxWidth: bounds.w - (textX - bounds.x) - 70,
    });
    ui.text(style.name.toUpperCase(), bounds.x + bounds.w - 14, bounds.y + 20, {
      size: 10,
      color: style.color,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 2,
      bold: true,
    });

    ui.paragraph(card.description, textX, bounds.y + 40, bounds.w - (textX - bounds.x) - 16, {
      size: 12,
      color: PALETTE.muted,
      lineHeight: 15,
    });

    ui.text(`${i + 1}`, bounds.x + bounds.w - 14, bounds.y + bounds.h - 14, {
      size: 11,
      color: hovered ? style.glow : PALETTE.dim,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });

    onCard(i, zone.clicked);
  });

  return top + n * rowH + (n - 1) * gap;
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

  ui.fittedText(t('evolution.title'), ui.width / 2, 84, {
    size: 34,
    color: '#b06cff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 12,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('evolution.subtitle'), ui.width / 2, 120, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  let picked = -1;

  // Same overflow as the card draft, same fix: below this width three cards can't
  // stay wide enough to read, so they stack into one column instead.
  if (ui.width < 640) {
    const margin = 20;
    const w = ui.width - margin * 2;
    const gap = 10;
    const n = Math.max(1, mutations.length);
    const top = 150;
    const rowH = clamp((ui.height - 50 - top - gap * (n - 1)) / n, 84, 150);

    mutations.forEach((mutation, i) => {
      const y = top + i * (rowH + gap);
      const bounds = rect(margin, y, w, rowH);
      const zone = ui.hitZone(bounds);
      const hovered = zone.hovered;

      ui.panel(bounds, {
        fill: hovered ? 'rgba(34,24,42,0.97)' : 'rgba(18,14,22,0.95)',
        border: hovered ? '#d4a8ff' : '#6b3fa0',
        radius: 8,
      });

      ui.fittedText(mutation.name, bounds.x + 18, bounds.y + 22, {
        size: 17,
        color: '#e0ccff',
        baseline: 'middle',
        bold: true,
        maxWidth: bounds.w - 50,
      });

      ui.paragraph(mutation.description, bounds.x + 18, bounds.y + 44, bounds.w - 36, {
        size: 12.5,
        color: PALETTE.muted,
        lineHeight: 16,
      });

      ui.text(`${i + 1}`, bounds.x + bounds.w - 14, bounds.y + 20, {
        size: 12,
        color: hovered ? '#d4a8ff' : PALETTE.dim,
        align: 'right',
        baseline: 'middle',
        bold: true,
      });

      if (zone.clicked) picked = i;
    });
  } else {
    const cardW = Math.max(140, Math.min(300, (ui.width - 140) / Math.max(1, mutations.length) - 24));
    const cardH = Math.max(180, Math.min(300, ui.height - 320));
    const gap = 28;
    const totalW = mutations.length * cardW + (mutations.length - 1) * gap;
    const startX = (ui.width - totalW) / 2;
    const y = ui.height / 2 - cardH / 2 + 20;

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
  }

  if (input.wasPressed('slot1') && mutations.length > 0) picked = 0;
  if (input.wasPressed('slot2') && mutations.length > 1) picked = 1;
  if (input.wasPressed('slot3') && mutations.length > 2) picked = 2;

  return picked;
}

// ---------------------------------------------------------------------------

export interface GiftChoiceResult {
  picked: number;
  left: boolean;
}

/**
 * The gift of the abyss — the choice made at a sigil.
 *
 * Each card is in its gift's own colour and states its two numbers plainly, because
 * the whole decision is a trade between them: a long cooldown that hits hard, a
 * shorter one that denies ground, or a leap that repositions you. Walking away is
 * offered as well; a screen you cannot decline turns a stray step into a mistake.
 */
export function drawGiftSelect(
  ui: Ui,
  input: Input,
  gifts: readonly AbilityDef[],
): GiftChoiceResult {
  ui.scrim(0.88);

  const result: GiftChoiceResult = { picked: -1, left: false };

  ui.fittedText(t('gift.title'), ui.width / 2, 74, {
    size: 32,
    color: '#b06cff',
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('gift.subtitle'), ui.width / 2, 110, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  const stacked = ui.width < 640;
  const bottom = ui.height - 84;

  gifts.forEach((gift, i) => {
    const bounds = stacked
      ? giftRowBounds(ui, i, gifts.length, 146, bottom)
      : giftCardBounds(ui, i, gifts.length);

    const zone = ui.hitZone(bounds);
    const hovered = zone.hovered;

    ui.panel(bounds, {
      fill: hovered ? 'rgba(30,24,38,0.97)' : 'rgba(16,14,20,0.95)',
      border: hovered ? gift.color : 'rgba(148,138,118,0.35)',
      radius: 8,
    });

    const pad = stacked ? 18 : 20;
    ui.fittedText(gift.name, bounds.x + pad, bounds.y + 24, {
      size: stacked ? 17 : 19,
      color: gift.color,
      baseline: 'middle',
      bold: true,
      maxWidth: bounds.w - pad * 2 - 24,
    });

    ui.paragraph(gift.description, bounds.x + pad, bounds.y + 48, bounds.w - pad * 2, {
      size: stacked ? 12.5 : 13.5,
      color: PALETTE.muted,
      lineHeight: 17,
    });

    // The two numbers that decide it, on the bottom edge where they line up across
    // all three cards and can be compared at a glance.
    ui.statRow(
      t('gift.cooldown'),
      `${gift.cooldown}${t('unit.secondsAbbrev')}`,
      bounds.x + pad,
      bounds.y + bounds.h - 38,
      bounds.w - pad * 2,
      { size: 12, color: gift.color },
    );
    ui.statRow(
      t('gift.duration'),
      `${gift.duration}${t('unit.secondsAbbrev')}`,
      bounds.x + pad,
      bounds.y + bounds.h - 20,
      bounds.w - pad * 2,
      { size: 12 },
    );

    ui.text(`${i + 1}`, bounds.x + bounds.w - 14, bounds.y + 22, {
      size: 12,
      color: hovered ? gift.color : PALETTE.dim,
      align: 'right',
      baseline: 'middle',
      bold: true,
    });

    if (zone.clicked) result.picked = i;
  });

  if (input.wasPressed('slot1') && gifts.length > 0) result.picked = 0;
  if (input.wasPressed('slot2') && gifts.length > 1) result.picked = 1;
  if (input.wasPressed('slot3') && gifts.length > 2) result.picked = 2;

  if (
    ui.button(rect(ui.width / 2 - 90, ui.height - 62, 180, 38), t('gift.leave'), {
      accent: PALETTE.muted,
      size: 13,
    }) ||
    input.consumePress('pause')
  ) {
    result.left = true;
  }

  return result;
}

function giftCardBounds(ui: Ui, index: number, count: number): ReturnType<typeof rect> {
  const cardW = Math.max(160, Math.min(300, (ui.width - 140) / Math.max(1, count) - 24));
  // Tight to its contents: a card sized to the window leaves a hole between the
  // description and the two numbers, which reads as something failing to render.
  const cardH = clamp(ui.height - 300, 172, 214);
  const gap = 26;
  const totalW = count * cardW + (count - 1) * gap;
  const startX = (ui.width - totalW) / 2;
  return rect(startX + index * (cardW + gap), ui.height / 2 - cardH / 2 + 10, cardW, cardH);
}

function giftRowBounds(
  ui: Ui,
  index: number,
  count: number,
  top: number,
  bottom: number,
): ReturnType<typeof rect> {
  const margin = 20;
  const gap = 10;
  const rowH = clamp((bottom - top - gap * (count - 1)) / Math.max(1, count), 96, 150);
  return rect(margin, top + index * (rowH + gap), ui.width - margin * 2, rowH);
}

// ---------------------------------------------------------------------------

export type ResultsAction = 'none' | 'again' | 'menu';

/** Persisted between frames so scrolling the narrow report survives a redraw. */
export interface ResultsView {
  scroll: number;
}

export function newResultsView(): ResultsView {
  return { scroll: 0 };
}

/** Below this, three columns no longer have enough width each to read comfortably. */
const RESULTS_STACK_WIDTH = 720;

/**
 * End-of-run report.
 *
 * Three columns on a wide window: the headline numbers, how you dealt damage, and
 * what the run consisted of. Below `RESULTS_STACK_WIDTH` there isn't room for three,
 * so they stack into one scrollable column instead — same content, read top to
 * bottom. Everything the tracker recorded surfaces somewhere here either way.
 */
export function drawResults(
  ui: Ui,
  input: Input,
  tracker: RunStats,
  soulsEarned: number,
  meta: MetaProgress,
  context: { daily: boolean; earned: readonly AchievementDef[] } = { daily: false, earned: [] },
  view: ResultsView = newResultsView(),
): ResultsAction {
  ui.scrim(0.93);

  const victory = tracker.outcome === 'victory';
  const title = victory ? t('results.victoryTitle') : t('results.defeatTitle');
  const accent = victory ? PALETTE.gold : PALETTE.blood;

  ui.fittedText(title, ui.width / 2, 56, {
    size: 32,
    color: accent,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 9,
    maxWidth: ui.width - 48,
  });

  const subtitle = victory
    ? t('results.victorySubtitle', { n: tracker.roomsCleared })
    : t('results.defeatSubtitle', { killer: tracker.killedBy || t('results.unknown'), room: tracker.roomsCleared + 1 });
  ui.fittedText(subtitle, ui.width / 2, 88, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  // The seed, so a run worth talking about can be handed to someone else.
  ui.fittedText(
    context.daily
      ? t('results.dailySeed', { seed: seedLabel(tracker.seed) })
      : t('results.seed', { seed: seedLabel(tracker.seed) }),
    ui.width / 2,
    108,
    {
      size: 12,
      color: context.daily ? '#8fd6a8' : PALETTE.dim,
      align: 'center',
      baseline: 'middle',
      letterSpacing: 1,
      maxWidth: ui.width - 48,
    },
  );

  const top = 124;
  const buttonY = ui.height - 62;

  if (ui.width >= RESULTS_STACK_WIDTH) {
    const margin = 40;
    const columnGap = 24;
    const columnW = (ui.width - margin * 2 - columnGap * 2) / 3;
    // Freshly earned trials claim a strip above the buttons; the columns give it up.
    const stripH = context.earned.length > 0 ? 40 : 0;
    const bodyH = ui.height - top - 96 - stripH;

    drawResultsOverview(ui, tracker, soulsEarned, rect(margin, top, columnW, bodyH));
    drawResultsDamage(ui, tracker, rect(margin + columnW + columnGap, top, columnW, bodyH));
    drawResultsRun(ui, tracker, rect(margin + (columnW + columnGap) * 2, top, columnW, bodyH));

    if (stripH > 0) {
      drawEarnedTrials(ui, context.earned, rect(margin, top + bodyH + 4, ui.width - margin * 2, stripH - 8));
    }
  } else {
    drawResultsStacked(ui, input, tracker, soulsEarned, context, view, top, buttonY - 24);
  }

  let action: ResultsAction = 'none';

  if (ui.button(rect(ui.width / 2 - 210, buttonY, 200, 46), t('results.again'), { accent: PALETTE.gold })) {
    action = 'again';
  }
  if (ui.button(rect(ui.width / 2 + 10, buttonY, 200, 46), t('results.toLair'), { accent: '#9fd7ff' })) {
    action = 'menu';
  }

  ui.text(
    t('results.totalSouls', { n: Math.floor(meta.souls) }),
    ui.width / 2,
    ui.height - 18,
    { size: 12, color: PALETTE.dim, align: 'center', baseline: 'middle' },
  );

  return action;
}

/**
 * The narrow layout: one scrollable column instead of three side by side.
 *
 * The three section functions already know how to draw at any width; what they
 * don't know is how tall they turned out, since that depends on how many kill types,
 * skills and rooms this particular run produced. They now return it, which is what
 * makes stacking them possible without either guessing a height or measuring twice.
 */
function drawResultsStacked(
  ui: Ui,
  input: Input,
  tracker: RunStats,
  soulsEarned: number,
  context: { daily: boolean; earned: readonly AchievementDef[] },
  view: ResultsView,
  viewTop: number,
  viewBottomIn: number,
): void {
  const margin = 20;
  const x = margin;
  const w = ui.width - margin * 2;
  const ctx = ui.ctx;

  // Freshly earned trials get a fixed strip just above the scroll area rather than
  // scrolling with it — it is the one thing on this screen worth seeing without
  // having to go looking for it.
  const stripH = context.earned.length > 0 ? 40 : 0;
  const viewBottom = viewBottomIn - stripH;
  const viewH = Math.max(60, viewBottom - viewTop);
  const gap = 16;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, viewTop, ui.width, viewH);
  ctx.clip();

  let cursorY = viewTop - view.scroll;
  const h1 = drawResultsOverview(ui, tracker, soulsEarned, rect(x, cursorY, w, 0), { panel: false });
  cursorY += h1 + gap;
  const h2 = drawResultsDamage(ui, tracker, rect(x, cursorY, w, 0), { panel: false });
  cursorY += h2 + gap;
  const h3 = drawResultsRun(ui, tracker, rect(x, cursorY, w, 0), { panel: false });
  cursorY += h3;

  ctx.restore();

  const totalHeight = h1 + gap + h2 + gap + h3;
  const maxScroll = Math.max(0, totalHeight - viewH);

  // Sign only, like the lair's grid: a mouse wheel and a converted touch-drag report
  // wildly different magnitudes for "one step", so only the direction is trustworthy.
  if (input.wheel !== 0) view.scroll += (input.wheel > 0 ? 1 : -1) * 72;
  view.scroll = clamp(view.scroll, 0, maxScroll);

  if (maxScroll > 0) {
    const thumbH = Math.max(24, (viewH * viewH) / totalHeight);
    const thumbY = viewTop + (viewH - thumbH) * (view.scroll / maxScroll);
    ctx.fillStyle = 'rgba(148,138,118,0.18)';
    ctx.fillRect(ui.width - 9, viewTop, 4, viewH);
    ctx.fillStyle = 'rgba(216,161,58,0.6)';
    ctx.fillRect(ui.width - 9, thumbY, 4, thumbH);
  }

  if (stripH > 0) {
    drawEarnedTrials(ui, context.earned, rect(margin, viewBottomIn - stripH + 6, w, stripH - 6));
  }
}

/**
 * Trials earned by the run that just ended.
 *
 * One line, listing as many as fit and counting the rest — the report behind it is
 * the point of the screen, and a wall of gold banners would bury it.
 */
function drawEarnedTrials(
  ui: Ui,
  earned: readonly AchievementDef[],
  bounds: ReturnType<typeof rect>,
): void {
  ui.panel(bounds, { fill: 'rgba(28,23,12,0.9)', border: PALETTE.borderStrong, radius: 5, shadow: false });

  const shown = earned.slice(0, 3);
  const rest = earned.length - shown.length;
  const souls = earned.reduce((sum, def) => sum + def.reward, 0);

  const label = shown.map(achievementName).join(' · ');
  const suffix = rest > 0 ? t('trials.andMore', { n: rest }) : '';
  const midY = bounds.y + bounds.h / 2;

  // The side labels are measured rather than assumed, so the middle text gets
  // whatever is actually left over instead of a margin sized for a wide desktop
  // panel — on a narrow one that fixed margin used to eat the entire strip.
  const leftW = ui.text(t('trials.newlyEarned'), bounds.x + 16, midY, {
    size: 12,
    color: PALETTE.gold,
    baseline: 'middle',
    letterSpacing: 2,
    bold: true,
  });
  const rightW = ui.text(t('trials.reward', { n: souls }), bounds.x + bounds.w - 16, midY, {
    size: 14,
    color: '#cfeaff',
    align: 'right',
    baseline: 'middle',
    bold: true,
  });

  ui.fittedText(`${label}${suffix}`, bounds.x + bounds.w / 2, midY, {
    size: 14,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    maxWidth: Math.max(40, bounds.w - leftW - rightW - 64),
    minScale: 0.7,
  });
}

/**
 * One results column.
 *
 * Returns the height it actually drew, in pixels from `bounds.y` — the desktop
 * three-column layout ignores it (columns share one fixed height there), but the
 * narrow stacked layout needs it to know where the next section starts, since none
 * of these row counts are known outside the function that draws them.
 */
function drawResultsOverview(
  ui: Ui,
  tracker: RunStats,
  soulsEarned: number,
  bounds: ReturnType<typeof rect>,
  options: { panel?: boolean } = {},
): number {
  if (options.panel !== false) ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading(t('heading.summary'), x, y, w);
  y += 26;

  const rows: Array<[string, string, string?]> = [
    [t('resultStat.killedHumans'), `${tracker.totalKills}`],
    [t('resultStat.roomsCleared'), `${tracker.roomsCleared}`],
    [t('resultStat.buildingsDestroyed'), `${tracker.buildingsDestroyed}`],
    [t('resultStat.time'), formatTime(tracker.elapsed)],
    [t('resultStat.soulsCollected'), `${Math.floor(soulsEarned)}`, '#9fd7ff'],
    [t('resultStat.killsPerMinute'), tracker.killsPerMinute.toFixed(1)],
    [t('resultStat.bestStreak'), `${tracker.bestKillStreak}`],
    [t('resultStat.perfectRooms'), `${tracker.perfectRooms}`],
  ];

  for (const [label, value, color] of rows) {
    ui.statRow(label, value, x, y, w, { color: color ?? PALETTE.ink });
    y += 22;
  }

  y += 14;
  ui.heading(t('heading.survival'), x, y, w);
  y += 26;

  const survival: Array<[string, string]> = [
    [t('resultStat.damageTaken'), formatNumber(tracker.totalDamageTaken)],
    [t('resultStat.timesHit'), `${tracker.timesHit}`],
    [t('resultStat.dodges'), `${tracker.dodgesPerformed}`],
    [t('resultStat.healed'), formatNumber(tracker.healingReceived)],
    [t('resultStat.lifestealHealed'), formatNumber(tracker.lifestealHealing)],
    [t('resultStat.lowestHealth'), `${(tracker.lowestHealthFraction * 100).toFixed(0)}%`],
    [t('resultStat.closeCalls'), `${tracker.closeCalls}`],
    [t('resultStat.dashesUsed'), `${tracker.dashesUsed}`],
  ];

  for (const [label, value] of survival) {
    ui.statRow(label, value, x, y, w, {});
    y += 22;
  }

  y += 10;
  ui.heading(t('heading.threats'), x, y, w);
  y += 24;

  for (const threat of tracker.topThreats.slice(0, 4)) {
    ui.statRow(threat.label, formatNumber(threat.damage), x, y, w, { color: PALETTE.bad, size: 13 });
    y += 20;
  }

  return y - bounds.y;
}

function drawResultsDamage(
  ui: Ui,
  tracker: RunStats,
  bounds: ReturnType<typeof rect>,
  options: { panel?: boolean } = {},
): number {
  if (options.panel !== false) ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading(t('heading.damage'), x, y, w);
  y += 26;

  const damageRows: Array<[string, string]> = [
    [t('resultStat.totalDealt'), formatNumber(tracker.totalDamageDealt)],
    [t('resultStat.avgDps'), formatNumber(tracker.averageDps)],
    [t('resultStat.peakDps'), formatNumber(tracker.peakDps)],
    [t('resultStat.biggestHit'), formatNumber(tracker.largestHit)],
    [t('resultStat.source'), tracker.largestHitSource],
    [t('resultStat.crit'), `${(tracker.critRate * 100).toFixed(0)}%`],
    [t('resultStat.accuracy'), `${(tracker.accuracy * 100).toFixed(0)}%`],
    [t('resultStat.overkill'), formatNumber(tracker.totalOverkill)],
  ];

  for (const [label, value] of damageRows) {
    ui.statRow(label, value, x, y, w, {});
    y += 22;
  }

  y += 14;
  ui.heading(t('heading.byType'), x, y, w);
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
    ui.text(DAMAGE_INFO[segment.type].name, x + 16, y, {
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
  ui.heading(t('heading.dpsOverTime'), x, y, w);
  y += 18;
  ui.lineChart(rect(x, y, w, 76), tracker.dpsSeries.map((s) => s.damage));
  y += 92;

  ui.heading(t('heading.sources'), x, y, w);
  y += 22;
  for (const source of tracker.topDamageSources.slice(0, 5)) {
    ui.statRow(source.label, formatNumber(source.damage), x, y, w, { size: 13 });
    y += 19;
  }

  return y - bounds.y;
}

function drawResultsRun(
  ui: Ui,
  tracker: RunStats,
  bounds: ReturnType<typeof rect>,
  options: { panel?: boolean } = {},
): number {
  if (options.panel !== false) ui.panel(bounds, { fill: 'rgba(12,11,15,0.85)' });
  const x = bounds.x + 20;
  const w = bounds.w - 40;
  let y = bounds.y + 28;

  ui.heading(t('heading.victims'), x, y, w);
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
  ui.heading(t('heading.skills'), x, y, w);
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
    ui.heading(t('heading.form'), x, y, w);
    y += 22;
    for (const mutation of tracker.mutationsTaken) {
      ui.statRow(mutation.name, t('buildSheet.roomShort', { n: mutation.room + 1 }), x, y, w, {
        size: 13,
        color: '#c9a0ff',
      });
      y += 19;
    }
  }

  y += 12;
  ui.heading(t('heading.rooms'), x, y, w);
  y += 22;

  const fastest = tracker.fastestRoom;
  for (const room of tracker.rooms.slice(-8)) {
    const label = `${room.index + 1}. ${room.name}`;
    const color = room.perfect ? PALETTE.good : room === fastest ? PALETTE.gold : PALETTE.ink;
    ui.statRow(label, formatTime(room.duration), x, y, w, { size: 12, color });
    y += 18;
  }

  return y - bounds.y;
}

// ---------------------------------------------------------------------------

export type MenuAction =
  | 'none'
  | 'start'
  | 'daily'
  | 'stats'
  | 'lair'
  | 'trials'
  | 'settings'
  | 'back'
  | 'reset';

/** Title screen and soul shop. */
export function drawMainMenu(ui: Ui, meta: MetaProgress, time: number, touchActive: boolean): MenuAction {
  const ctx = ui.ctx;

  // Background: slow drifting embers over a dark field.
  ctx.fillStyle = '#07070a';
  ctx.fillRect(0, 0, ui.width, ui.height);
  drawMenuAtmosphere(ui, time);

  ui.fittedText('SAMARKAND', ui.width / 2, ui.height * 0.2, {
    size: 56,
    color: PALETTE.blood,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 18,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('menu.tagline'), ui.width / 2, ui.height * 0.2 + 44, {
    size: 15,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    letterSpacing: 1,
    maxWidth: ui.width - 48,
  });

  let action: MenuAction = 'none';

  const buttonW = 260;
  const bx = ui.width / 2 - buttonW / 2;
  let by = ui.height * 0.36;

  // The body is named on the hunt button itself, so the choice is visible from the
  // title screen even though it is made in the lair.
  if (
    ui.button(rect(bx, by, buttonW, 52), t('menu.hunt'), {
      accent: PALETTE.blood,
      size: 18,
      sub: t('menu.huntAs', { name: meta.species.name }),
    })
  ) {
    action = 'start';
  }
  by += 60;

  if (ui.button(rect(bx, by, buttonW, 42), t('menu.daily'), { accent: '#8fd6a8', size: 15, sub: dailySubtitle(meta) })) {
    action = 'daily';
  }
  by += 54;

  if (
    ui.button(rect(bx, by, buttonW, 42), t('menu.lair'), {
      accent: PALETTE.gold,
      size: 15,
      sub: t('lair.progress', { owned: meta.unlockedCount, total: meta.unlockableCount }),
    })
  ) {
    action = 'lair';
  }
  by += 52;

  // The last two are side by side: they are places to look at what you have done,
  // not things to do, and giving each a full-width slot would bury the hunt button.
  const halfW = (buttonW - 10) / 2;
  if (ui.button(rect(bx, by, halfW, 40), t('menu.chronicle'), { accent: '#9fd7ff', size: 13 })) {
    action = 'stats';
  }
  if (
    ui.button(rect(bx + halfW + 10, by, halfW, 40), t('menu.trials'), {
      accent: PALETTE.gold,
      size: 13,
      sub: `${meta.achievementCount} / ${meta.achievementTotal}`,
    })
  ) {
    action = 'trials';
  }
  by += 48;

  if (ui.button(rect(bx, by, buttonW, 34), t('menu.settings'), { accent: PALETTE.muted, size: 13 })) {
    action = 'settings';
  }

  // Banked souls, shown where the shop panel used to be — the shop is its own
  // screen now, since content unlocks need far more room than stat rows did.
  ui.text(t('unit.souls', { n: Math.floor(meta.souls) }), ui.width / 2, by + 56, {
    size: 16,
    color: '#cfeaff',
    align: 'center',
    baseline: 'middle',
    bold: true,
  });

  drawAudioControl(ui, meta);

  // Nothing here to hint at on a screen with no keyboard behind it.
  if (!touchActive) {
    ui.text(t('menu.controlsFooter'), ui.width / 2, ui.height - 22, {
      size: 12,
      color: PALETTE.dim,
      align: 'center',
      baseline: 'middle',
    });
  }

  return action;
}

/**
 * One line under the daily button.
 *
 * Before you have played it, the seed and the time left — the two things that make
 * it a shared event. Afterwards, the score to beat, since the run can be replayed.
 */
function dailySubtitle(meta: MetaProgress): string {
  const today = meta.todaysDaily();
  if (today.runs === 0) {
    return t('daily.subFresh', {
      seed: seedLabel(dailySeed()),
      time: formatCountdown(secondsUntilNextDaily()),
    });
  }
  if (today.victory) return t('daily.subVictory', { kills: today.bestKills });
  return t('daily.subPlayed', { rooms: today.bestRooms, kills: today.bestKills });
}

/**
 * Volume control.
 *
 * Mutates `meta` in place and lets the game push the value into the audio engine
 * each frame — that keeps the widget stateless and means the setting is already
 * saved by the time the player starts a run.
 */
function drawAudioControl(ui: Ui, meta: MetaProgress): void {
  const x = 40;
  const y = ui.height - 62;
  const barW = 150;

  const muteRect = rect(x, y - 11, 60, 24);
  if (ui.button(muteRect, meta.muted ? t('audio.unmute') : t('audio.mute'), { size: 11, accent: '#9fd7ff' })) {
    meta.muted = !meta.muted;
    meta.save();
  }

  const barRect = rect(x + 74, y - 5, barW, 10);
  const zone = ui.hitZone(barRect);
  ui.bar(barRect, meta.muted ? 0 : meta.volume, {
    color: zone.hovered ? '#cfeaff' : '#7fb2ff',
    background: 'rgba(0,0,0,0.55)',
    radius: 3,
  });

  // Click anywhere on the bar to jump to that level, drag to scrub.
  if (zone.hovered && (zone.clicked || ui.isMouseDown)) {
    meta.volume = clamp((ui.mouseX - barRect.x) / barRect.w, 0, 1);
    meta.muted = false;
    if (zone.clicked) meta.save();
  }

  ui.text(`${Math.round(meta.volume * 100)}%`, x + 74 + barW + 10, y, {
    size: 11,
    color: PALETTE.dim,
    baseline: 'middle',
  });
}

/**
 * Language switch.
 *
 * Each label is always shown in its own language (never translated), so a player
 * who can't read the current locale can still find their way to one they can.
 */
/**
 * Drifting embers behind the title and the overlay screens.
 *
 * Exported so screens like the lair can reuse the backdrop without drawing the menu
 * itself — a menu drawn underneath keeps registering click zones that steal clicks
 * aimed at the screen on top.
 */
export function drawMenuBackdrop(ui: Ui, time: number): void {
  ui.ctx.fillStyle = '#07070a';
  ui.ctx.fillRect(0, 0, ui.width, ui.height);
  drawMenuAtmosphere(ui, time);
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

  ui.fittedText(t('menu.chronicle').toUpperCase(), ui.width / 2, 56, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
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

  ui.heading(t('heading.total'), x, y, w);
  y += 26;

  const totals: Array<[string, string]> = [
    [t('lifetime.runs'), `${l.runs}`],
    [t('lifetime.victories'), `${l.victories}`],
    [t('lifetime.deaths'), `${l.deaths}`],
    [t('resultStat.killedHumans'), `${l.totalKills}`],
    [t('lifetime.buildingsDestroyed'), `${l.totalBuildings}`],
    [t('lifetime.soulsCollected'), formatNumber(l.totalSouls)],
    [t('lifetime.damageDealt'), formatNumber(l.totalDamageDealt)],
    [t('resultStat.damageTaken'), formatNumber(l.totalDamageTaken)],
    [t('lifetime.playtime'), formatTime(l.totalPlaytime)],
  ];
  for (const [label, value] of totals) {
    ui.statRow(label, value, x, y, w, {});
    y += 23;
  }

  y += 16;
  ui.heading(t('heading.records'), x, y, w);
  y += 26;

  const records: Array<[string, string]> = [
    [t('lifetime.deepestRoom'), t('unit.rooms', { n: l.deepestRoom })],
    [t('lifetime.mostKills'), `${l.bestKills}`],
    [t('lifetime.bestDps'), formatNumber(l.bestDps)],
    [t('resultStat.biggestHit'), formatNumber(l.largestHit)],
    [t('lifetime.mostSouls'), formatNumber(l.bestSoulsInRun)],
    [t('lifetime.soulsInvested'), formatNumber(meta.soulsInvested())],
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

  ui.heading(t('heading.elements'), rxi, ry, rw);
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
  ui.heading(t('heading.victims'), rxi, ry, rw);
  ry += 24;

  const kills = Object.entries(l.killsByEnemy).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [id, count] of kills) {
    ui.statRow(enemyName(id), `${count}`, rxi, ry, rw, { size: 13 });
    ry += 20;
  }

  ry += 14;
  ui.heading(t('heading.favoriteSkills'), rxi, ry, rw);
  ry += 24;

  const skills = Object.entries(l.skillPicks).sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [id, count] of skills) {
    ui.statRow(id, `×${count}`, rxi, ry, rw, { size: 13, color: '#9fd7ff' });
    ry += 20;
  }

  const nemesis = meta.nemesis();
  if (nemesis) {
    ry += 14;
    ui.text(t('lifetime.nemesis', { name: nemesis.name, count: nemesis.count }), rxi, ry, {
      size: 13,
      color: PALETTE.bad,
      baseline: 'middle',
      italic: true,
    });
  }

  let action: MenuAction = 'none';
  if (ui.button(rect(ui.width / 2 - 200, ui.height - 74, 180, 44), t('lifetime.back'), { accent: '#9fd7ff' })) {
    action = 'back';
  }
  if (
    ui.button(rect(ui.width / 2 + 20, ui.height - 74, 180, 44), t('lifetime.resetAll'), {
      accent: PALETTE.blood,
    })
  ) {
    action = 'reset';
  }

  return action;
}

function enemyName(id: string): string {
  return HUMAN_ARCHETYPES[id as keyof typeof HUMAN_ARCHETYPES]?.name ?? id;
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

  ui.fittedText(t('buildSheet.title'), ui.width / 2, 46, {
    size: 24,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    maxWidth: ui.width - 48,
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

  ui.heading(t('heading.stats'), x, y, w);
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

    ui.statRow(statLabel(key), formatStat(key, value), colX, y + row * 21, colW, {
      size: 12,
      color: value === base ? PALETTE.ink : better ? PALETTE.good : PALETTE.bad,
    });
  });
  y += half * 21 + 18;

  ui.heading(t('heading.elements'), x, y, w);
  y += 24;

  const conversions = monster.stats.conversions();
  if (conversions.length === 0) {
    ui.text(t('buildSheet.purePhysical'), x, y, { size: 13, color: PALETTE.dim, italic: true, baseline: 'middle' });
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
  ui.heading(t('heading.form'), x, y, w);
  y += 22;
  if (tracker.mutationsTaken.length === 0) {
    ui.text(t('buildSheet.baseForm'), x, y, {
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
      ui.text(t('buildSheet.roomShort', { n: mutation.room + 1 }), x + w, y, {
        size: 12,
        color: PALETTE.dim,
        align: 'right',
        baseline: 'middle',
      });
      y += 20;
    }
  }

  // Curses sit right under the form: they are as permanent as a mutation and the
  // player needs to weigh them together when reading their build.
  y += 12;
  const carried = [...monster.curses].map(getCurse).filter((c): c is Curse => c !== undefined);
  y = drawCurseList(ui, carried, x, y, w);

  y += 12;
  ui.heading(t('heading.traits'), x, y, w);
  y += 22;
  const behaviors = monster.stats.behaviorList();
  if (behaviors.length === 0) {
    ui.text(t('buildSheet.noTraits'), x, y, { size: 13, color: PALETTE.dim, italic: true, baseline: 'middle' });
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

  ui.heading(t('heading.skills'), rxi, ry, rw);
  ry += 26;

  if (skills.length === 0) {
    ui.text(t('buildSheet.noSkills'), rxi, ry, {
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
  ui.heading(t('heading.thisRun'), rxi, ry, rw);
  ry += 26;

  const live: Array<[string, string]> = [
    [t('resultStat.killedShort'), `${tracker.totalKills}`],
    [t('resultStat.damageShort'), formatNumber(tracker.totalDamageDealt)],
    ['DPS', formatNumber(tracker.averageDps)],
    [t('resultStat.crit'), `${(tracker.critRate * 100).toFixed(0)}%`],
    [t('resultStat.accuracy'), `${(tracker.accuracy * 100).toFixed(0)}%`],
    [t('resultStat.receivedShort'), formatNumber(tracker.totalDamageTaken)],
    [t('resultStat.soulsShort'), `${Math.floor(monster.souls)}`],
    [t('resultStat.buildingsShort'), `${tracker.buildingsDestroyed}`],
  ];
  for (const [label, value] of live) {
    ui.statRow(label, value, rxi, ry, rw, { size: 13 });
    ry += 21;
  }

  ry += 12;
  ui.heading(t('heading.damageByType'), rxi, ry, rw);
  ry += 20;
  const segments = DAMAGE_TYPES.filter((t) => tracker.damageDealtByType[t] > 0).map((t) => ({
    value: tracker.damageDealtByType[t],
    color: DAMAGE_INFO[t].color,
  }));
  ui.stackedBar(rect(rxi, ry, rw, 10), segments);

  ui.text(t('buildSheet.close'), ui.width / 2, ui.height - 34, {
    size: 12,
    color: PALETTE.dim,
    align: 'center',
    baseline: 'middle',
  });
}

function behaviorLabel(flag: string): string {
  return t(`behavior.${flag}`);
}

// ---------------------------------------------------------------------------

export type PauseAction = 'none' | 'resume' | 'menu' | 'settings';

export function drawPause(ui: Ui, touchActive: boolean): PauseAction {
  ui.scrim(0.78);

  ui.fittedText(t('pause.title'), ui.width / 2, ui.height / 2 - 90, {
    size: 30,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
  });

  let action: PauseAction = 'none';
  if (ui.button(rect(ui.width / 2 - 120, ui.height / 2 - 30, 240, 48), t('pause.resume'))) {
    action = 'resume';
  }
  // Settings sit above 'abandon' on purpose. The reason to open this menu mid-run is
  // usually to turn the camera shake down, and that button must not be next to the
  // one that throws the run away.
  if (
    ui.button(rect(ui.width / 2 - 120, ui.height / 2 + 26, 240, 34), t('menu.settings'), {
      accent: PALETTE.gold,
      size: 14,
    })
  ) {
    action = 'settings';
  }
  if (
    ui.button(rect(ui.width / 2 - 120, ui.height / 2 + 68, 240, 40), t('pause.abandon'), {
      accent: PALETTE.blood,
      size: 14,
    })
  ) {
    action = 'menu';
  }

  // The Resume button above is already the tap target; ESC doesn't exist to hint at.
  if (!touchActive) {
    ui.text(t('pause.hint'), ui.width / 2, ui.height / 2 + 126, {
      size: 12,
      color: PALETTE.dim,
      align: 'center',
      baseline: 'middle',
    });
  }

  return action;
}

/** Between-room banner announcing the next settlement. */
export function drawRoomIntro(ui: Ui, name: string, index: number, progress: number): void {
  // Fade in over the first third, hold, fade out over the last third.
  const alpha = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;

  ui.text(t('roomIntro.label', { n: index + 1 }), ui.width / 2, ui.height / 2 - 26, {
    size: 13,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 6,
    alpha: clamp(alpha, 0, 1),
    outline: true,
  });
  ui.fittedText(name.toUpperCase(), ui.width / 2, ui.height / 2 + 6, {
    size: 34,
    color: PALETTE.ink,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    alpha: clamp(alpha, 0, 1),
    outline: true,
    maxWidth: ui.width - 48,
  });
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
