import { describe, expect, it } from 'vitest';
import {
  buttonAt,
  dragStickOrigin,
  STICK_DEAD_ZONE,
  STICK_RADIUS,
  stickAxis,
  stickKnob,
  touchLayout,
} from './touch';

describe('touchLayout', () => {
  it('keeps every button inside a normal viewport', () => {
    const layout = touchLayout(390, 844);
    for (const button of layout.buttons) {
      expect(button.x - button.r).toBeGreaterThanOrEqual(0);
      expect(button.x + button.r).toBeLessThanOrEqual(390);
      expect(button.y - button.r).toBeGreaterThanOrEqual(0);
      expect(button.y + button.r).toBeLessThanOrEqual(844);
    }
  });

  it('never lands two buttons on top of each other, even on a very short viewport', () => {
    // A phone in landscape leaves little vertical room — this is the case the manual
    // clamp in the layout exists for.
    const layout = touchLayout(844, 320);
    const byId = (id: string) => layout.buttons.find((b) => b.id === id)!;
    const dash = byId('dash');
    const pause = byId('pause');
    const stats = byId('stats');

    for (const [a, b] of [
      [dash, pause],
      [dash, stats],
      [pause, stats],
    ] as const) {
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      expect(distance).toBeGreaterThanOrEqual(a.r + b.r - 1);
    }
  });
});

describe('the gift button', () => {
  it('is absent unless a gift is held', () => {
    const without = touchLayout(390, 844);
    expect(without.buttons.some((b) => b.id === 'ability')).toBe(false);

    const withGift = touchLayout(390, 844, true);
    expect(withGift.buttons.some((b) => b.id === 'ability')).toBe(true);
  });

  /**
   * Its whole cost is the steering it eats. A button hit-tested where no button is
   * drawn — or drawn under the dash thumb — turns a dodge into a cast.
   */
  it('clears dash and stays on screen, on every shape of viewport', () => {
    for (const [w, h] of [
      [390, 844],
      [844, 390],
      [844, 320],
      [1280, 720],
    ] as const) {
      const layout = touchLayout(w, h, true);
      const gift = layout.buttons.find((b) => b.id === 'ability')!;

      expect(gift.x - gift.r).toBeGreaterThanOrEqual(0);
      expect(gift.x + gift.r).toBeLessThanOrEqual(w);
      expect(gift.y - gift.r).toBeGreaterThanOrEqual(0);
      expect(gift.y + gift.r).toBeLessThanOrEqual(h);

      for (const other of layout.buttons) {
        if (other.id === 'ability') continue;
        const distance = Math.hypot(gift.x - other.x, gift.y - other.y);
        expect(distance).toBeGreaterThanOrEqual(gift.r + other.r - 1);
      }
    }
  });

  it('is what a touch on it resolves to', () => {
    const layout = touchLayout(390, 844, true);
    const gift = layout.buttons.find((b) => b.id === 'ability')!;
    expect(buttonAt(layout, gift.x, gift.y)).toBe('ability');
  });
});

describe('buttonAt', () => {
  it('finds the button under a point, slop included', () => {
    const layout = touchLayout(390, 844);
    const dash = layout.buttons.find((b) => b.id === 'dash')!;

    expect(buttonAt(layout, dash.x, dash.y)).toBe('dash');
    // Just past the drawn radius, inside the hit slop.
    expect(buttonAt(layout, dash.x + dash.r + 5, dash.y)).toBe('dash');
  });

  it('returns null well outside every button', () => {
    const layout = touchLayout(390, 844);
    expect(buttonAt(layout, 10, 10)).toBeNull();
  });
});

describe('stickAxis', () => {
  it('is zero inside the dead zone', () => {
    const origin = { x: 100, y: 100 };
    expect(stickAxis(origin, { x: 100, y: 100 })).toEqual({ x: 0, y: 0 });
    expect(stickAxis(origin, { x: 100 + STICK_DEAD_ZONE * 0.5, y: 100 })).toEqual({ x: 0, y: 0 });
  });

  it('points straight at the finger once past the dead zone', () => {
    const origin = { x: 0, y: 0 };
    const axis = stickAxis(origin, { x: 100, y: 0 });
    expect(axis.x).toBeCloseTo(1, 5);
    expect(axis.y).toBeCloseTo(0, 5);
  });

  it('is always unit length outside the dead zone, in any direction', () => {
    const origin = { x: 0, y: 0 };
    const axis = stickAxis(origin, { x: 30, y: 40 });
    expect(Math.hypot(axis.x, axis.y)).toBeCloseTo(1, 5);
  });
});

describe('stickKnob', () => {
  it('follows the finger inside the ring', () => {
    const origin = { x: 0, y: 0 };
    expect(stickKnob(origin, { x: 10, y: 5 })).toEqual({ x: 10, y: 5 });
  });

  it('clamps to the ring once the finger runs past it', () => {
    const origin = { x: 0, y: 0 };
    const knob = stickKnob(origin, { x: 1000, y: 0 });
    expect(knob.x).toBeCloseTo(STICK_RADIUS, 5);
    expect(knob.y).toBeCloseTo(0, 5);
  });
});

describe('dragStickOrigin', () => {
  it('does not move while the finger is inside the ring', () => {
    const origin = { x: 50, y: 50 };
    expect(dragStickOrigin(origin, { x: 55, y: 50 })).toEqual(origin);
  });

  it('trails a finger that has run past the ring, staying one radius behind it', () => {
    const origin = { x: 0, y: 0 };
    const dragged = dragStickOrigin(origin, { x: 1000, y: 0 });
    const distance = Math.hypot(1000 - dragged.x, 0 - dragged.y);
    expect(distance).toBeCloseTo(STICK_RADIUS, 5);
  });
});
