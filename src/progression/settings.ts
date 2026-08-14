import { type ActionName, DEFAULT_BINDINGS } from '../core/input';

/**
 * Player settings.
 *
 * Deliberately small and deliberately not balance: everything here changes how the
 * game is presented or driven, never how hard it is. That keeps a settings screen
 * from quietly becoming a difficulty menu.
 *
 * Comfort is the reason most of it exists. The camera shakes on every hit, and for
 * some people that is not a flourish but a reason to stop playing.
 */

export type ShakeLevel = 'off' | 'low' | 'full';
export type EffectsLevel = 'minimal' | 'reduced' | 'full';

/**
 * Whether the screen doubles as a gamepad.
 *
 * 'auto' is the honest default: a laptop with a touchscreen should not be handed a
 * joystick over its arena because the hardware happens to support one, so the pad
 * appears only once the player has actually touched the glass. The two explicit values
 * exist for the machines that guess wrong in either direction.
 */
export type TouchControlsMode = 'auto' | 'on' | 'off';

export interface Settings {
  shake: ShakeLevel;
  /** Particle density. Also the lever for a machine that cannot keep up. */
  effects: EffectsLevel;
  damageNumbers: boolean;
  /** Frame cost in the corner, for anyone diagnosing a stutter. */
  showFrameCost: boolean;
  /** On-screen stick and buttons. Menus stay tappable whatever this says. */
  touchControls: TouchControlsMode;
  /** Code -> action. Only the rebindable actions ever differ from the defaults. */
  bindings: Record<string, ActionName>;
}

export const SHAKE_LEVELS: readonly ShakeLevel[] = ['off', 'low', 'full'];
export const EFFECTS_LEVELS: readonly EffectsLevel[] = ['minimal', 'reduced', 'full'];
export const TOUCH_MODES: readonly TouchControlsMode[] = ['auto', 'on', 'off'];

/** Multiplier applied to every shake the game asks for. */
export const SHAKE_SCALE: Record<ShakeLevel, number> = { off: 0, low: 0.45, full: 1 };

/**
 * Multiplier on particle counts.
 *
 * 'minimal' is a quarter rather than nothing: a hit with no feedback at all reads as
 * an attack that missed, and that is a worse experience than a slow one.
 */
export const EFFECTS_SCALE: Record<EffectsLevel, number> = {
  minimal: 0.25,
  reduced: 0.6,
  full: 1,
};

export function defaultSettings(): Settings {
  return {
    shake: 'full',
    effects: 'full',
    damageNumbers: true,
    showFrameCost: false,
    touchControls: 'auto',
    bindings: { ...DEFAULT_BINDINGS },
  };
}

/**
 * Rebuild a settings object from whatever was in the save file.
 *
 * Written defensively on purpose. A save is user-editable text that survives across
 * versions, and a bad value here does not throw — it silently produces a game with no
 * particles, or one where nothing is bound to 'left'.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const settings = defaultSettings();
  if (!raw || typeof raw !== 'object') return settings;

  const data = raw as Partial<Record<keyof Settings, unknown>>;

  if (isShakeLevel(data.shake)) settings.shake = data.shake;
  if (isEffectsLevel(data.effects)) settings.effects = data.effects;
  if (typeof data.damageNumbers === 'boolean') settings.damageNumbers = data.damageNumbers;
  if (typeof data.showFrameCost === 'boolean') settings.showFrameCost = data.showFrameCost;
  if (isTouchMode(data.touchControls)) settings.touchControls = data.touchControls;

  const bindings = sanitizeBindings(data.bindings);
  if (bindings) settings.bindings = bindings;

  return settings;
}

function isShakeLevel(value: unknown): value is ShakeLevel {
  return typeof value === 'string' && (SHAKE_LEVELS as readonly string[]).includes(value);
}

function isEffectsLevel(value: unknown): value is EffectsLevel {
  return typeof value === 'string' && (EFFECTS_LEVELS as readonly string[]).includes(value);
}

function isTouchMode(value: unknown): value is TouchControlsMode {
  return typeof value === 'string' && (TOUCH_MODES as readonly string[]).includes(value);
}

const KNOWN_ACTIONS = new Set<string>(Object.values(DEFAULT_BINDINGS));

/**
 * Validate a saved binding map, or reject it whole.
 *
 * Rejecting rather than repairing: a map missing 'left' is not a map with a small
 * problem, it is a game the player cannot walk in, and there is no honest guess at
 * what they meant. Falling back to the defaults at least leaves them able to play and
 * rebind again.
 */
function sanitizeBindings(raw: unknown): Record<string, ActionName> | null {
  if (!raw || typeof raw !== 'object') return null;

  const bindings: Record<string, ActionName> = {};
  for (const [code, action] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof code !== 'string' || code.length === 0) continue;
    if (typeof action !== 'string' || !KNOWN_ACTIONS.has(action)) continue;
    bindings[code] = action as ActionName;
  }

  const bound = new Set(Object.values(bindings));
  for (const action of Object.values(DEFAULT_BINDINGS)) {
    if (!bound.has(action)) return null;
  }
  return bindings;
}
