import type { Input } from '../core/input';
import { STICK_RADIUS, touchLayout, type TouchButtonId } from '../core/touch';
import { t } from '../i18n';
import { type TouchControlsMode } from '../progression/settings';
import { PALETTE, type Ui } from './widgets';

const BUTTON_LABEL: Record<TouchButtonId, string> = {
  dash: 'touch.dash',
  pause: 'touch.pause',
  stats: 'touch.stats',
};

/**
 * The on-screen stick and buttons, drawn over the arena.
 *
 * Semi-transparent and drawn last, on top of the HUD: on a phone this is the one part
 * of the screen a thumb actually covers, and it needs to be legible without also being
 * the first thing a screenshot shows on a desktop nobody asked it to appear on. `off`
 * and an undetected `auto` both mean drawing nothing at all — `Input` already ignored
 * every touch as a stick or button in that case, so a control drawn here would be one
 * that doesn't work.
 */
export function drawTouchControls(ui: Ui, input: Input, mode: TouchControlsMode): void {
  if (mode === 'off') return;
  if (mode === 'auto' && !input.touchDetected) return;

  const ctx = ui.ctx;
  const layout = touchLayout(ui.width, ui.height);

  const stick = input.stickView();
  if (stick) {
    ctx.save();
    ctx.strokeStyle = 'rgba(232,226,212,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.origin.x, stick.origin.y, STICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(232,226,212,0.7)';
    ctx.beginPath();
    ctx.arc(stick.knob.x, stick.knob.y, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,9,12,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  for (const button of layout.buttons) {
    const held = input.isTouchButtonHeld(button.id);

    ctx.save();
    ctx.beginPath();
    ctx.arc(button.x, button.y, button.r, 0, Math.PI * 2);
    ctx.fillStyle = held ? 'rgba(168,35,42,0.7)' : 'rgba(20,19,23,0.55)';
    ctx.fill();
    ctx.strokeStyle = held ? PALETTE.bloodBright : 'rgba(232,226,212,0.45)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ui.text(t(BUTTON_LABEL[button.id]), button.x, button.y, {
      size: button.id === 'dash' ? 12 : 9,
      color: PALETTE.ink,
      align: 'center',
      baseline: 'middle',
      bold: true,
      outline: true,
      letterSpacing: button.id === 'dash' ? 0 : 0.5,
    });
  }
}
