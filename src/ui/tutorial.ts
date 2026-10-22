import { clamp } from '../core/math';
import { FONT, PALETTE, rect, type Ui } from './widgets';

/** One lesson as the HUD should show it this frame. */
export interface CoachCard {
  title: string;
  body: string;
  /** 1-based position among the steps, or null for a one-off tip. */
  step: number | null;
  steps: number;
  /** 0..1 fade. */
  alpha: number;
  /** The player just did it: the card turns into a brief confirmation. */
  done: boolean;
}

const BODY_SIZE = 12;
const BODY_LINE = 16;

/** Greedy word wrap at the body's own font — the plate is sized from the result. */
function wrap(ui: Ui, text: string, maxWidth: number): string[] {
  const ctx = ui.ctx;
  ctx.save();
  ctx.font = `${BODY_SIZE}px ${FONT}`;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines;
}

/**
 * The tutorial card, bottom-centre above the boss bar and the form timers.
 *
 * It sits on its own dark plate because it is read mid-fight over busy ground; the
 * old floating line of text vanished against a burning village. The body wraps
 * rather than shrinks — shrunk to fit a phone, a sentence becomes unreadable,
 * and a lesson nobody can read teaches nothing. On touch the right edge belongs
 * to the stick's button column, so the card centres in what is left.
 */
export function drawCoach(ui: Ui, card: CoachCard, touchActive: boolean): void {
  const alpha = clamp(card.alpha, 0, 1);
  if (alpha <= 0) return;

  const rightClearance = touchActive ? 150 : 16;
  const centerX = (16 + (ui.width - rightClearance)) / 2;
  const maxW = Math.min(560, ui.width - rightClearance - 16);
  const lines = wrap(ui, card.body, maxW - 24);
  const h = 40 + lines.length * BODY_LINE;
  const bottom = ui.height - 134;
  const y = bottom - h;
  const accent = card.done ? '#7fe08a' : card.step !== null ? PALETTE.gold : '#a8dcff';

  ui.ctx.save();
  ui.ctx.globalAlpha = alpha;
  ui.panel(rect(centerX - maxW / 2, y, maxW, h), {
    fill: 'rgba(14,11,9,0.78)',
    border: card.done ? 'rgba(127,224,138,0.55)' : 'rgba(216,161,58,0.35)',
    radius: 6,
    shadow: false,
  });
  ui.ctx.restore();

  // The step counter takes the top-right corner; the title keeps clear of it on
  // both sides so it stays centred.
  const counterRoom = card.step !== null ? 34 : 12;
  const title = card.done ? `✓  ${card.title}` : card.title;
  ui.fittedText(title, centerX, y + 20, {
    size: 16,
    color: accent,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 3,
    alpha,
    bold: true,
    maxWidth: maxW - counterRoom * 2,
  });

  lines.forEach((line, i) => {
    ui.text(line, centerX, y + 42 + i * BODY_LINE, {
      size: BODY_SIZE,
      color: PALETTE.ink,
      align: 'center',
      baseline: 'middle',
      alpha: alpha * (card.done ? 0.6 : 1),
    });
  });

  if (card.step !== null) {
    ui.text(`${card.step}/${card.steps}`, centerX + maxW / 2 - 10, y + 12, {
      size: 10,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
      alpha,
    });
  }
}
