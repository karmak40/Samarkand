import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, Input, REBINDABLE } from '../core/input';
import {
  defaultSettings,
  EFFECTS_LEVELS,
  EFFECTS_SCALE,
  sanitizeSettings,
  SHAKE_LEVELS,
  SHAKE_SCALE,
  TOUCH_MODES,
} from './settings';

describe('defaults', () => {
  it('start at full presentation — nobody should have to turn the game on', () => {
    const settings = defaultSettings();
    expect(settings.shake).toBe('full');
    expect(settings.effects).toBe('full');
    expect(settings.damageNumbers).toBe(true);
    expect(settings.showFrameCost).toBe(false);
    // Auto, not on: a laptop with a touchscreen should not be handed a joystick just
    // because the hardware happens to support one.
    expect(settings.touchControls).toBe('auto');
  });

  it('hand out a copy of the bindings, not the shared default object', () => {
    const settings = defaultSettings();
    settings.bindings.KeyW = 'down';

    expect(DEFAULT_BINDINGS.KeyW).toBe('up');
    expect(defaultSettings().bindings.KeyW).toBe('up');
  });

  it('scale every level, with off meaning off and full meaning untouched', () => {
    for (const level of SHAKE_LEVELS) expect(SHAKE_SCALE[level]).toBeGreaterThanOrEqual(0);
    expect(SHAKE_SCALE.off).toBe(0);
    expect(SHAKE_SCALE.full).toBe(1);

    // Never zero: a hit with no particles at all reads as a miss.
    for (const level of EFFECTS_LEVELS) expect(EFFECTS_SCALE[level]).toBeGreaterThan(0);
    expect(EFFECTS_SCALE.full).toBe(1);
  });
});

/**
 * A save file is user-editable text that outlives the build that wrote it, so every
 * field here is treated as hostile. The failure this guards against is silent: a bad
 * value does not throw, it produces a game with no particles or no way to walk left.
 */
describe('sanitizeSettings', () => {
  it('accepts a good object unchanged', () => {
    const settings = defaultSettings();
    settings.shake = 'low';
    settings.effects = 'minimal';
    settings.damageNumbers = false;

    const parsed = sanitizeSettings(JSON.parse(JSON.stringify(settings)));
    expect(parsed.shake).toBe('low');
    expect(parsed.effects).toBe('minimal');
    expect(parsed.damageNumbers).toBe(false);
  });

  it('falls back for anything that is not an object', () => {
    for (const junk of [null, undefined, 7, 'settings', []]) {
      expect(sanitizeSettings(junk).shake).toBe('full');
    }
  });

  it('drops an unknown level rather than storing it', () => {
    const parsed = sanitizeSettings({ shake: 'extreme', effects: 42 });
    expect(parsed.shake).toBe('full');
    expect(parsed.effects).toBe('full');
  });

  it('ignores a non-boolean toggle', () => {
    expect(sanitizeSettings({ damageNumbers: 'yes' }).damageNumbers).toBe(true);
  });

  it('accepts a known touch controls mode', () => {
    for (const mode of TOUCH_MODES) {
      expect(sanitizeSettings({ touchControls: mode }).touchControls).toBe(mode);
    }
  });

  it('falls back to auto for an unknown touch controls value', () => {
    expect(sanitizeSettings({ touchControls: 'joystick' }).touchControls).toBe('auto');
  });

  it('rejects a binding map that leaves an action unreachable', () => {
    // Half a map is not a map with a small problem — it is a game you cannot walk in.
    const parsed = sanitizeSettings({ bindings: { KeyW: 'up' } });
    expect(parsed.bindings).toEqual({ ...DEFAULT_BINDINGS });
  });

  it('rejects a binding map full of nonsense', () => {
    const parsed = sanitizeSettings({ bindings: { KeyW: 'fly', 5: 'up' } });
    expect(parsed.bindings).toEqual({ ...DEFAULT_BINDINGS });
  });

  it('keeps a complete map that merely moved a key', () => {
    const moved = { ...DEFAULT_BINDINGS } as Record<string, string>;
    delete moved.KeyW;
    moved.KeyI = 'up';

    expect(sanitizeSettings({ bindings: moved }).bindings.KeyI).toBe('up');
    expect(sanitizeSettings({ bindings: moved }).bindings.KeyW).toBeUndefined();
  });
});

describe('rebinding', () => {
  const makeInput = (): Input => new Input(document.createElement('canvas'));

  it('starts on the defaults', () => {
    expect(makeInput().codesFor('up')).toEqual(['KeyW', 'ArrowUp']);
  });

  it('replaces an action rather than adding to it', () => {
    const input = makeInput();
    input.rebind('up', 'KeyI');

    expect(input.codesFor('up')).toEqual(['KeyI']);
  });

  it('takes the key away from whatever else held it', () => {
    // Two actions on one key is never what someone meant, and the second would simply
    // never fire.
    const input = makeInput();
    input.rebind('up', 'KeyA');

    expect(input.codesFor('up')).toEqual(['KeyA']);
    expect(input.codesFor('left')).toEqual(['ArrowLeft']);
  });

  it('restores the defaults on reset', () => {
    const input = makeInput();
    input.rebind('up', 'KeyI');
    input.rebind('dash', 'KeyQ');
    input.resetBindings();

    expect(input.bindingMap()).toEqual({ ...DEFAULT_BINDINGS });
  });

  it('hands the next key to the capture instead of the game', () => {
    const input = makeInput();
    let captured: string | null = null;
    input.captureNextKey((code) => {
      captured = code;
    });

    expect(input.capturing).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));

    expect(captured).toBe('KeyP');
    expect(input.capturing).toBe(false);
    // The captured press must not also register as an action.
    expect(input.wasPressed('up')).toBe(false);
    input.destroy();
  });

  it('offers only actions that exist, and never the ones that drive the menus', () => {
    const actions = new Set(Object.values(DEFAULT_BINDINGS));
    for (const action of REBINDABLE) expect(actions.has(action)).toBe(true);

    for (const locked of ['pause', 'confirm', 'slot1', 'slot2', 'slot3']) {
      expect(REBINDABLE).not.toContain(locked);
    }
  });
});
