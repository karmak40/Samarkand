import { t } from '../i18n';
import { PALETTE, rect, type Ui } from './widgets';

export type ReviveAction = 'none' | 'watch' | 'decline';

/** Owned by the caller so it survives frames; the ad promise's callback flips it. */
export interface ReviveView {
  phase: 'offer' | 'watching';
}

export function newReviveView(): ReviveView {
  return { phase: 'offer' };
}

/**
 * Offered once, the moment a killing blow would otherwise end the run.
 *
 * Two phases rather than one screen with a disabled button: once the player commits
 * to watching, the choice is gone — there is nothing left to decide, only a wait for
 * the ad to hand back control. Showing a decline button through that wait would be a
 * lie about what pressing it could still do.
 */
export function drawReviveOffer(ui: Ui, view: ReviveView, elapsed: number): ReviveAction {
  ui.scrim(0.82);

  ui.fittedText(t('revive.title'), ui.width / 2, ui.height / 2 - 90, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 8,
    maxWidth: ui.width - 48,
  });

  if (view.phase === 'watching') {
    // Pulses rather than sitting static, so a wait with no progress bar still reads
    // as "working" rather than "stuck" — the ad's own duration isn't something this
    // screen can know ahead of time.
    const alpha = 0.55 + 0.45 * Math.sin(elapsed * 4);
    ui.fittedText(t('revive.watching'), ui.width / 2, ui.height / 2, {
      size: 16,
      color: PALETTE.muted,
      align: 'center',
      baseline: 'middle',
      alpha,
      maxWidth: ui.width - 48,
    });
    return 'none';
  }

  ui.fittedText(t('revive.subtitle'), ui.width / 2, ui.height / 2 - 46, {
    size: 14,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  let action: ReviveAction = 'none';
  if (
    ui.button(rect(ui.width / 2 - 130, ui.height / 2 - 4, 260, 48), t('revive.watch'), {
      accent: PALETTE.gold,
    })
  ) {
    action = 'watch';
  }
  if (
    ui.button(rect(ui.width / 2 - 130, ui.height / 2 + 52, 260, 40), t('revive.decline'), {
      accent: PALETTE.blood,
      size: 14,
    })
  ) {
    action = 'decline';
  }

  return action;
}
