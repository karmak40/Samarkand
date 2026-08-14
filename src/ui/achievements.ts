import type { Input } from '../core/input';
import { clamp } from '../core/math';
import { t } from '../i18n';
import {
  ACHIEVEMENTS,
  achievementDescription,
  achievementName,
  achievementProgress,
  type AchievementDef,
} from '../progression/achievements';
import { type MetaProgress } from '../progression/meta';
import { formatNumber, PALETTE, rect, type Ui } from './widgets';

/** Counts read as counts: "3 / 25", not "3.0 / 25". Only huge totals get abbreviated. */
function formatCount(value: number): string {
  return value >= 100_000 ? formatNumber(value) : `${Math.round(value)}`;
}

export type TrialsAction = 'none' | 'back';

/**
 * The trials screen.
 *
 * Locked trials show exactly what they ask for and what they pay — a hidden
 * achievement can't change how anyone plays, and changing how you play is the entire
 * point of the list. Lifetime trials also show how far along you are, because "kill
 * 5000 humans" is only motivating when you can see the number moving.
 */
export function drawAchievements(
  ui: Ui,
  input: Input,
  meta: MetaProgress,
  state: { scroll: number },
): TrialsAction {
  ui.scrim(0.94);

  ui.fittedText(t('trials.title'), ui.width / 2, 50, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('trials.subtitle'), ui.width / 2, 82, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  ui.text(
    t('trials.progress', { owned: meta.achievementCount, total: meta.achievementTotal }),
    ui.width / 2 - 150,
    114,
    { size: 15, color: PALETTE.ink, align: 'right', baseline: 'middle', bold: true },
  );
  ui.text(t('trials.earnedSouls', { n: formatCount(meta.achievementSouls) }), ui.width / 2 + 150, 114, {
    size: 13,
    color: '#cfeaff',
    align: 'left',
    baseline: 'middle',
  });

  // --- grid -----------------------------------------------------------------
  const ctx = meta.achievementContext(null);
  const columns = 2;
  const cellW = Math.max(220, Math.min(430, (ui.width - 160) / columns - 16));
  // Roomy enough for a three-line description: German and Russian run long, and a
  // trial the player can't read is a trial they won't chase.
  const cellH = 84;
  const gap = 10;
  const gridW = columns * cellW + (columns - 1) * gap;
  const gridX = (ui.width - gridW) / 2;
  const gridTop = 148;
  const gridBottom = ui.height - 84;
  const visibleRows = Math.max(1, Math.floor((gridBottom - gridTop) / (cellH + gap)));
  const totalRows = Math.ceil(ACHIEVEMENTS.length / columns);
  const maxScroll = Math.max(0, totalRows - visibleRows);

  if (input.wheel !== 0) state.scroll += input.wheel > 0 ? 1 : -1;
  state.scroll = clamp(state.scroll, 0, maxScroll);

  const firstIndex = state.scroll * columns;
  const lastIndex = Math.min(ACHIEVEMENTS.length, firstIndex + visibleRows * columns);

  for (let i = firstIndex; i < lastIndex; i++) {
    const def = ACHIEVEMENTS[i]!;
    const slot = i - firstIndex;
    const x = gridX + (slot % columns) * (cellW + gap);
    const y = gridTop + Math.floor(slot / columns) * (cellH + gap);

    drawTrialCell(ui, meta, def, ctx, rect(x, y, cellW, cellH));
  }

  if (maxScroll > 0) {
    const trackH = gridBottom - gridTop;
    const thumbH = Math.max(24, (trackH * visibleRows) / totalRows);
    const thumbY = gridTop + (trackH - thumbH) * (state.scroll / maxScroll);
    ui.ctx.fillStyle = 'rgba(148,138,118,0.18)';
    ui.ctx.fillRect(gridX + gridW + 12, gridTop, 4, trackH);
    ui.ctx.fillStyle = 'rgba(216,161,58,0.6)';
    ui.ctx.fillRect(gridX + gridW + 12, thumbY, 4, thumbH);
  }

  let action: TrialsAction = 'none';
  if (
    ui.button(rect(ui.width / 2 - 90, ui.height - 60, 180, 34), t('common.back'), {
      accent: PALETTE.muted,
      size: 13,
    }) ||
    input.consumePress('pause')
  ) {
    action = 'back';
  }

  return action;
}

/** One trial: what it asks, what it pays, and how close you are. */
function drawTrialCell(
  ui: Ui,
  meta: MetaProgress,
  def: AchievementDef,
  ctx: ReturnType<MetaProgress['achievementContext']>,
  bounds: ReturnType<typeof rect>,
): void {
  const earned = meta.hasAchievement(def.id);
  const accent = earned ? PALETTE.good : def.scope === 'run' ? '#c9a0ff' : '#9fd7ff';

  ui.panel(bounds, {
    fill: earned ? 'rgba(18,22,18,0.85)' : 'rgba(14,13,17,0.92)',
    border: earned ? 'rgba(127,224,138,0.45)' : 'rgba(148,138,118,0.28)',
    radius: 6,
    shadow: false,
  });

  ui.text(achievementName(def), bounds.x + 14, bounds.y + 22, {
    size: 15,
    color: earned ? PALETTE.ink : accent,
    baseline: 'middle',
    bold: true,
  });

  ui.paragraph(achievementDescription(def), bounds.x + 14, bounds.y + 44, bounds.w - 92, {
    size: 12,
    color: earned ? PALETTE.muted : 'rgba(139,133,120,0.85)',
    lineHeight: 16,
  });

  if (earned) {
    ui.text(t('trials.earned'), bounds.x + bounds.w - 14, bounds.y + 22, {
      size: 12,
      color: PALETTE.good,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 1,
    });
  } else {
    ui.text(`+${def.reward}`, bounds.x + bounds.w - 14, bounds.y + 24, {
      size: 19,
      color: '#cfeaff',
      align: 'right',
      baseline: 'middle',
      bold: true,
    });
    ui.text(t('hud.soulsLabel'), bounds.x + bounds.w - 14, bounds.y + 44, {
      size: 10,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
    });
  }

  // A bar only means something for something that accumulates; a run-scoped trial
  // is pass or fail on one run, and a half-filled bar would be a lie.
  if (!earned && def.scope === 'life') {
    const progress = achievementProgress(def, ctx);
    if (progress.total > 1) {
      const barRect = rect(bounds.x + 14, bounds.y + bounds.h - 18, bounds.w - 92, 6);
      ui.bar(barRect, progress.total > 0 ? progress.current / progress.total : 0, {
        color: accent,
        radius: 2,
        border: false,
      });
      ui.text(
        `${formatCount(progress.current)} / ${formatCount(progress.total)}`,
        barRect.x + barRect.w + 10,
        barRect.y + 3,
        { size: 11, color: PALETTE.dim, baseline: 'middle' },
      );
    }
  }
}
