import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { HORDE_LEVELS } from '../balance';
import { t } from '../i18n';
import { type MetaProgress } from '../progression/meta';
import { formatTime, PALETTE, rect, type Ui } from './widgets';

export interface HordeMenuResult {
  back: boolean;
  /** Level picked this frame, or -1. */
  play: number;
}

/**
 * Horde level-select: a ladder of arenas, one at a time.
 *
 * Gated by `meta.hordeLevelUnlocked` instead of souls — surviving a level is what
 * buys the next one. Locked rows still show their name and target time, same
 * "knowing what is out there is most of the pull" philosophy as the Lair.
 */
export function drawHordeMenu(
  ui: Ui,
  input: Input,
  meta: MetaProgress,
  state: { scroll: number },
): HordeMenuResult {
  ui.scrim(0.94);
  const result: HordeMenuResult = { back: false, play: -1 };

  ui.fittedText(t('horde.title'), ui.width / 2, 50, {
    size: 30,
    color: PALETTE.blood,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('horde.subtitle'), ui.width / 2, 82, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  const unlocked = Math.min(meta.hordeLevelUnlocked, HORDE_LEVELS.length);
  ui.text(t('horde.progress', { level: unlocked, total: HORDE_LEVELS.length }), ui.width / 2, 112, {
    size: 14,
    color: '#cfeaff',
    align: 'center',
    baseline: 'middle',
    bold: true,
  });

  // --- level list -------------------------------------------------------------
  const listW = Math.min(560, ui.width - 48);
  const listX = ui.width / 2 - listW / 2;
  const rowH = 78;
  const gap = 12;
  const top = 150;
  const bottom = ui.height - 84;
  const visibleRows = Math.max(1, Math.floor((bottom - top) / (rowH + gap)));
  const maxScroll = Math.max(0, HORDE_LEVELS.length - visibleRows);

  if (input.wheel !== 0) state.scroll += input.wheel > 0 ? 1 : -1;
  state.scroll = clamp(state.scroll, 0, maxScroll);

  const first = state.scroll;
  const last = Math.min(HORDE_LEVELS.length, first + visibleRows);

  for (let i = first; i < last; i++) {
    const entry = HORDE_LEVELS[i]!;
    const y = top + (i - first) * (rowH + gap);
    const bounds = rect(listX, y, listW, rowH);
    const unlockedRow = entry.level <= meta.hordeLevelUnlocked;
    const beaten = entry.level < meta.hordeLevelUnlocked;
    const zone = unlockedRow ? ui.hitZone(bounds) : { hovered: false, clicked: false };

    ui.panel(bounds, {
      fill: zone.hovered ? 'rgba(30,26,32,0.97)' : 'rgba(16,15,19,0.95)',
      border: unlockedRow ? (zone.hovered ? PALETTE.bloodBright : PALETTE.blood) : 'rgba(110,104,92,0.3)',
      radius: 8,
    });

    ui.text(t('horde.level', { n: entry.level }), bounds.x + 20, bounds.y + 26, {
      size: 18,
      color: unlockedRow ? PALETTE.ink : PALETTE.dim,
      baseline: 'middle',
      bold: true,
    });
    ui.text(t('horde.targetTime', { time: formatTime(entry.targetSeconds) }), bounds.x + 20, bounds.y + 52, {
      size: 13,
      color: unlockedRow ? PALETTE.muted : PALETTE.dim,
      baseline: 'middle',
    });

    if (beaten) {
      ui.text(t('lair.owned'), bounds.x + bounds.w - 20, bounds.y + bounds.h / 2, {
        size: 12,
        color: PALETTE.good,
        align: 'right',
        baseline: 'middle',
        letterSpacing: 1,
      });
    } else if (!unlockedRow) {
      ui.text(t('horde.locked', { n: entry.level - 1 }), bounds.x + bounds.w - 20, bounds.y + bounds.h / 2, {
        size: 11,
        color: PALETTE.dim,
        align: 'right',
        baseline: 'middle',
        maxWidth: 180,
      });
    }

    if (zone.clicked) result.play = entry.level;
  }

  // Scroll affordance.
  if (maxScroll > 0) {
    const trackH = bottom - top;
    const thumbH = Math.max(24, (trackH * visibleRows) / HORDE_LEVELS.length);
    const thumbY = top + (trackH - thumbH) * (state.scroll / maxScroll);
    ui.ctx.fillStyle = 'rgba(148,138,118,0.18)';
    ui.ctx.fillRect(listX + listW + 12, top, 4, trackH);
    ui.ctx.fillStyle = 'rgba(216,161,58,0.6)';
    ui.ctx.fillRect(listX + listW + 12, thumbY, 4, thumbH);
  }

  if (
    ui.button(rect(ui.width / 2 - 90, ui.height - 44, 180, 34), t('common.back'), {
      accent: PALETTE.muted,
      size: 13,
    }) ||
    input.consumePress('pause')
  ) {
    result.back = true;
  }

  return result;
}
