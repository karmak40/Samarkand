import { type ActionName, type Input, REBINDABLE } from '../core/input';
import { clamp, type Rect } from '../core/math';
import { getLocale, LOCALE_LABELS, LOCALE_NAMES, LOCALES, setLocale, t } from '../i18n';
import { type MetaProgress } from '../progression/meta';
import {
  EFFECTS_LEVELS,
  type EffectsLevel,
  SHAKE_LEVELS,
  type ShakeLevel,
  TOUCH_MODES,
  type TouchControlsMode,
} from '../progression/settings';
import { FONT, PALETTE, rect, type Ui } from './widgets';

export type SettingsAction = 'none' | 'back';

/** Which action is waiting for a key, if any. Owned by the caller so it survives frames. */
export interface SettingsView {
  rebinding: ActionName | null;
  /** Whether the language dropdown is expanded. */
  languageOpen: boolean;
}

export function newSettingsView(): SettingsView {
  return { rebinding: null, languageOpen: false };
}

/**
 * Human-readable key name.
 *
 * `KeyboardEvent.code` is a physical position, not a letter — 'KeyW' on a QWERTY
 * board is 'Z' under a French layout. Showing the code trimmed is honest about that
 * without pretending to know the layout, which the web platform will not tell us.
 */
function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  if (code === 'Space') return 'SPACE';
  if (code === 'ShiftLeft') return 'L SHIFT';
  if (code === 'ShiftRight') return 'R SHIFT';
  if (code === 'ControlLeft') return 'L CTRL';
  if (code === 'ControlRight') return 'R CTRL';
  if (code === 'AltLeft') return 'L ALT';
  if (code === 'AltRight') return 'R ALT';
  return code.toUpperCase();
}

/**
 * Settings.
 *
 * Reachable from the title screen and from the pause menu, because the setting most
 * likely to be needed — turning the camera shake down — is one a player only discovers
 * they want after the first fight has already started.
 *
 * Everything applies on the spot and saves on the spot. There is no confirm button:
 * a settings screen that can be left in an unsaved state is a settings screen that
 * loses someone's choices.
 */
export function drawSettings(
  ui: Ui,
  input: Input,
  meta: MetaProgress,
  view: SettingsView,
): SettingsAction {
  const settings = meta.settings;
  ui.scrim(0.94);

  ui.fittedText(t('settings.title'), ui.width / 2, 50, {
    size: 30,
    color: PALETTE.gold,
    align: 'center',
    baseline: 'middle',
    letterSpacing: 10,
    maxWidth: ui.width - 48,
  });
  ui.fittedText(t('settings.subtitle'), ui.width / 2, 82, {
    size: 13,
    color: PALETTE.muted,
    align: 'center',
    baseline: 'middle',
    italic: true,
    maxWidth: ui.width - 48,
  });

  const panelW = Math.min(560, ui.width - 60);
  const x = (ui.width - panelW) / 2;
  let y = 106;

  const commit = (): void => meta.save();

  // --- comfort and presentation ---------------------------------------------
  y = section(ui, x, y, panelW, t('settings.section.display'));

  y = choiceRow<ShakeLevel>(ui, x, y, panelW, {
    label: t('settings.shake'),
    hint: t('settings.shake.hint'),
    options: SHAKE_LEVELS,
    current: settings.shake,
    labelOf: (value) => t(`settings.shake.${value}`),
    onPick: (value) => {
      settings.shake = value;
      commit();
    },
  });

  y = choiceRow<EffectsLevel>(ui, x, y, panelW, {
    label: t('settings.effects'),
    hint: t('settings.effects.hint'),
    options: EFFECTS_LEVELS,
    current: settings.effects,
    labelOf: (value) => t(`settings.effects.${value}`),
    onPick: (value) => {
      settings.effects = value;
      commit();
    },
  });

  y = choiceRow<boolean>(ui, x, y, panelW, {
    label: t('settings.damageNumbers'),
    hint: t('settings.damageNumbers.hint'),
    options: [true, false],
    current: settings.damageNumbers,
    labelOf: (value) => t(value ? 'common.on' : 'common.off'),
    onPick: (value) => {
      settings.damageNumbers = value;
      commit();
    },
  });

  y = choiceRow<boolean>(ui, x, y, panelW, {
    label: t('settings.frameCost'),
    hint: t('settings.frameCost.hint'),
    options: [false, true],
    current: settings.showFrameCost,
    labelOf: (value) => t(value ? 'common.on' : 'common.off'),
    onPick: (value) => {
      settings.showFrameCost = value;
      commit();
    },
  });

  // --- language ---------------------------------------------------------------
  y = section(ui, x, y + 6, panelW, t('settings.section.language'));
  y = languageDropdown(ui, x, y, panelW, view);

  // The dropdown covers whatever would be drawn below it once it lists every
  // language, so nothing after it may also be drawn or read a click this frame —
  // a button sitting under an open dropdown would still fire on a tap meant for the
  // option above it. Escape closes the dropdown first rather than leaving the whole
  // screen, matching how it already backs out of a key capture below.
  if (view.languageOpen) {
    if (input.consumePress('pause')) view.languageOpen = false;
    return 'none';
  }

  // --- audio -----------------------------------------------------------------
  y = section(ui, x, y + 6, panelW, t('settings.section.audio'));
  y = volumeRow(ui, x, y, panelW, meta);

  // --- controls ---------------------------------------------------------------
  y = section(ui, x, y + 6, panelW, t('settings.section.controls'));
  // Captured before the touch-controls row advances y, so the button below still
  // sits beside the section heading rather than sliding down onto that row.
  const controlsHeaderY = y;

  y = choiceRow<TouchControlsMode>(ui, x, y, panelW, {
    label: t('settings.touchControls'),
    hint: t('settings.touchControls.hint'),
    options: TOUCH_MODES,
    current: settings.touchControls,
    labelOf: (value) => t(`settings.touchControls.${value}`),
    onPick: (value) => {
      settings.touchControls = value;
      commit();
    },
  });

  if (
    ui.button(rect(x + panelW - 130, controlsHeaderY - 34, 130, 22), t('settings.resetKeys'), {
      size: 10,
      accent: PALETTE.muted,
    })
  ) {
    input.resetBindings();
    settings.bindings = input.bindingMap();
    view.rebinding = null;
    commit();
  }

  const columns = panelW >= 460 ? 2 : 1;
  const cellW = (panelW - (columns - 1) * 10) / columns;
  const cellH = 34;

  for (let i = 0; i < REBINDABLE.length; i++) {
    const action = REBINDABLE[i]!;
    const cx = x + (i % columns) * (cellW + 10);
    const cy = y + Math.floor(i / columns) * (cellH + 4);
    bindingRow(ui, input, rect(cx, cy, cellW, cellH), action, view, meta);
  }
  y += Math.ceil(REBINDABLE.length / columns) * (cellH + 4);

  ui.text(fit(ui, t('settings.keyNote'), 10, panelW), x, y + 6, {
    size: 10,
    color: PALETTE.dim,
    baseline: 'middle',
  });

  // --- footer -----------------------------------------------------------------
  let action: SettingsAction = 'none';
  const backRect = rect(ui.width / 2 - 90, ui.height - 44, 180, 34);

  // Escape is how you leave — unless it is the key being rebound, in which case the
  // capture has already swallowed it.
  if (
    ui.button(backRect, t('common.back'), { accent: PALETTE.muted, size: 13 }) ||
    (!view.rebinding && input.consumePress('pause'))
  ) {
    input.cancelCapture();
    view.rebinding = null;
    action = 'back';
  }

  return action;
}

/** Trim a string with an ellipsis until it fits, rather than letting it overlap. */
function fit(ui: Ui, text: string, size: number, maxWidth: number): string {
  const ctx = ui.ctx;
  ctx.save();
  ctx.font = size + "px " + FONT;
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.restore();
    return text;
  }

  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  ctx.restore();
  return trimmed.trimEnd() + '…';
}

/** A heading with a rule under it. Returns the y to carry on from. */
function section(ui: Ui, x: number, y: number, w: number, label: string): number {
  ui.text(label.toUpperCase(), x, y + 10, {
    size: 11,
    color: PALETTE.gold,
    baseline: 'middle',
    letterSpacing: 2,
  });
  ui.ctx.fillStyle = 'rgba(148,138,118,0.22)';
  ui.ctx.fillRect(x, y + 20, w, 1);
  return y + 30;
}

interface ChoiceRow<T> {
  label: string;
  hint: string;
  options: readonly T[];
  current: T;
  labelOf: (value: T) => string;
  onPick: (value: T) => void;
}

/**
 * A label on the left and a row of mutually exclusive chips on the right.
 *
 * Chips rather than a cycling button: the whole range is visible, so a player can see
 * that 'off' exists without clicking through to find it.
 */
function choiceRow<T>(ui: Ui, x: number, y: number, w: number, row: ChoiceRow<T>): number {
  const height = 38;

  const chipW = Math.min(84, (w * 0.46) / row.options.length - 6);
  const chipsW = row.options.length * chipW + (row.options.length - 1) * 6;
  let chipX = x + w - chipsW;

  ui.text(row.label, x, y + 13, { size: 14, color: PALETTE.ink, baseline: 'middle' });
  // Trimmed, not squashed: the chips sit to the right, and a hint drawn under them is
  // unreadable whichever way it gets there.
  ui.text(fit(ui, row.hint, 10, chipsW > 0 ? w - chipsW - 14 : w), x, y + 29, {
    size: 10,
    color: PALETTE.dim,
    baseline: 'middle',
  });

  for (const option of row.options) {
    const active = option === row.current;
    if (
      ui.button(rect(chipX, y + 4, chipW, 26), row.labelOf(option), {
        size: 11,
        accent: active ? PALETTE.gold : PALETTE.muted,
        active,
      })
    ) {
      row.onPick(option);
    }
    chipX += chipW + 6;
  }

  return y + height;
}

/**
 * Language, as a dropdown rather than a permanent list.
 *
 * The trigger alone costs one row; the full list — five languages today, more later
 * — only exists while it is actually being chosen, in place of the fixed height a
 * standing list would spend on every visit to this screen regardless of whether
 * anyone came here to touch it.
 *
 * The caller must stop drawing anything else once `view.languageOpen` is true: the
 * list is drawn where the sections after it would otherwise go, and a button under
 * it would still register a click meant for the option sitting on top of it.
 */
function languageDropdown(ui: Ui, x: number, y: number, w: number, view: SettingsView): number {
  const rowH = 34;
  const active = getLocale();

  const trigger = rect(x, y, w, rowH);
  const zone = ui.hitZone(trigger);

  ui.panel(trigger, {
    fill: zone.hovered ? 'rgba(28,26,32,0.95)' : 'rgba(14,13,17,0.9)',
    border: view.languageOpen ? '#9fd7ff' : 'rgba(148,138,118,0.3)',
    radius: 5,
    shadow: false,
  });

  ui.text(LOCALE_NAMES[active], trigger.x + 14, trigger.y + rowH / 2, {
    size: 14,
    color: PALETTE.ink,
    baseline: 'middle',
    bold: true,
  });
  ui.text(LOCALE_LABELS[active], trigger.x + w - 34, trigger.y + rowH / 2, {
    size: 11,
    color: PALETTE.dim,
    align: 'right',
    baseline: 'middle',
    letterSpacing: 1,
  });
  ui.text(view.languageOpen ? '▲' : '▼', trigger.x + w - 16, trigger.y + rowH / 2, {
    size: 10,
    color: '#9fd7ff',
    align: 'center',
    baseline: 'middle',
  });

  if (zone.clicked) view.languageOpen = !view.languageOpen;

  y += rowH + 4;
  if (!view.languageOpen) return y;

  for (let i = 0; i < LOCALES.length; i++) {
    const locale = LOCALES[i]!;
    const bounds = rect(x, y, w, rowH);
    const selected = locale === active;
    const optZone = ui.hitZone(bounds);

    ui.panel(bounds, {
      fill: selected
        ? 'rgba(30,34,42,0.95)'
        : optZone.hovered
          ? 'rgba(28,26,32,0.95)'
          : 'rgba(10,9,12,0.9)',
      border: selected ? '#9fd7ff' : 'rgba(148,138,118,0.28)',
      radius: 5,
      shadow: false,
    });

    // A tick rather than colour alone: the difference between two dark panels is not
    // something everyone can see.
    ui.text(selected ? '✓' : '', bounds.x + 14, bounds.y + rowH / 2, {
      size: 13,
      color: '#9fd7ff',
      baseline: 'middle',
    });
    ui.text(LOCALE_NAMES[locale], bounds.x + 34, bounds.y + rowH / 2, {
      size: 13,
      color: selected ? PALETTE.ink : PALETTE.muted,
      baseline: 'middle',
      bold: selected,
    });
    ui.text(LOCALE_LABELS[locale], bounds.x + w - 14, bounds.y + rowH / 2, {
      size: 11,
      color: PALETTE.dim,
      align: 'right',
      baseline: 'middle',
      letterSpacing: 1,
    });

    if (optZone.clicked) {
      if (!selected) setLocale(locale);
      view.languageOpen = false;
    }

    y += rowH + 4;
  }

  return y + 2;
}

/** Master volume: the same control the title screen has, in its proper home. */
function volumeRow(ui: Ui, x: number, y: number, w: number, meta: MetaProgress): number {
  ui.text(t('settings.volume'), x, y + 13, { size: 14, color: PALETTE.ink, baseline: 'middle' });

  const muteW = 74;
  const barW = Math.min(220, w * 0.4);
  const barRect = rect(x + w - barW - muteW - 10, y + 8, barW, 10);

  const zone = ui.hitZone(barRect);
  ui.bar(barRect, meta.muted ? 0 : meta.volume, {
    color: zone.hovered ? '#cfeaff' : '#7fb2ff',
    background: 'rgba(0,0,0,0.55)',
    radius: 3,
  });
  if (zone.hovered && (zone.clicked || ui.isMouseDown)) {
    meta.volume = clamp((ui.mouseX - barRect.x) / barRect.w, 0, 1);
    meta.muted = false;
    if (zone.clicked) meta.save();
  }

  ui.text(`${Math.round(meta.volume * 100)}%`, barRect.x - 8, y + 13, {
    size: 11,
    color: PALETTE.dim,
    align: 'right',
    baseline: 'middle',
  });

  if (
    ui.button(rect(x + w - muteW, y + 1, muteW, 24), meta.muted ? t('audio.unmute') : t('audio.mute'), {
      size: 11,
      accent: '#9fd7ff',
      active: meta.muted,
    })
  ) {
    meta.muted = !meta.muted;
    meta.save();
  }

  return y + 40;
}

/** One rebindable action: its name, and the key it sits on. */
function bindingRow(
  ui: Ui,
  input: Input,
  bounds: Rect,
  action: ActionName,
  view: SettingsView,
  meta: MetaProgress,
): void {
  const waiting = view.rebinding === action;
  const codes = input.codesFor(action);
  const zone = ui.hitZone(bounds);

  ui.panel(bounds, {
    fill: waiting ? 'rgba(40,32,20,0.95)' : zone.hovered ? 'rgba(30,28,34,0.95)' : 'rgba(14,13,17,0.9)',
    border: waiting ? PALETTE.gold : 'rgba(148,138,118,0.3)',
    radius: 5,
    shadow: false,
  });

  ui.text(t(`action.${action}`), bounds.x + 12, bounds.y + bounds.h / 2, {
    size: 12,
    color: PALETTE.muted,
    baseline: 'middle',
  });

  ui.text(
    waiting ? t('settings.pressKey') : codes.map(keyLabel).join(' / '),
    bounds.x + bounds.w - 12,
    bounds.y + bounds.h / 2,
    {
      size: 12,
      color: waiting ? PALETTE.gold : PALETTE.ink,
      align: 'right',
      baseline: 'middle',
      bold: true,
    },
  );

  if (!zone.clicked || waiting) return;

  view.rebinding = action;
  input.captureNextKey((code) => {
    view.rebinding = null;
    // Escape backs out instead of becoming a movement key. It is the only way off a
    // screen for someone who has just unbound something they needed.
    if (code === 'Escape') return;
    input.rebind(action, code);
    meta.settings.bindings = input.bindingMap();
    meta.save();
  });
}
