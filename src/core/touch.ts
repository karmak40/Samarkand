import { clamp, dist2, type Vec2 } from './math';

/**
 * Geometry and thresholds for the on-screen controls.
 *
 * Kept apart from both the class that reads touches and the screen that draws them,
 * because those two have to agree to the pixel. A button drawn anywhere other than
 * where it is hit-tested is a button that silently does not work, and nothing in the
 * code of either side looks wrong.
 */

/** Distance from the stick centre at which the knob sits against the ring, in CSS px. */
export const STICK_RADIUS = 46;

/**
 * Slack around the touch-down point that reads as standing still.
 *
 * A thumb resting on glass drifts by a couple of pixels, and this game attacks by
 * itself while you stand — so drift that registers as walking would quietly cost
 * accuracy in every fight.
 */
export const STICK_DEAD_ZONE = 8;

/** Buttons are hit-tested this much larger than they are drawn. */
export const HIT_SLOP = 10;

/** Total travel below which a touch counts as a tap rather than a drag. */
export const TAP_SLOP = 12;

/** Vertical drag that equals one wheel notch on a scrollable screen. */
export const SCROLL_STEP = 42;

export type TouchButtonId = 'dash' | 'pause' | 'stats' | 'ability';

/**
 * What a touch currently means.
 *
 * 'play' is the arena: the screen is a steering pad with three buttons on it. 'ui' is
 * every menu, where a touch is simply a mouse — which is what makes the existing
 * screens work on glass without knowing that touch exists.
 */
export type TouchMode = 'play' | 'ui';

export interface TouchButton {
  id: TouchButtonId;
  /** Centre, in CSS pixels relative to the canvas. */
  x: number;
  y: number;
  r: number;
}

export interface TouchLayout {
  buttons: readonly TouchButton[];
}

/**
 * Where the buttons go, for a given viewport.
 *
 * Every position here is dodging something the HUD already draws. The bottom strip
 * carries the build row and the boss bar, the top-left the health cluster, the
 * top-right the resource readout — so the buttons take the one column nothing else
 * claims: the right edge, below the numbers and above the boss's health.
 *
 * Thumbs are the other constraint. Dash sits bottom-right where the right thumb
 * already rests, and the two rarely-used buttons sit high enough that neither thumb
 * brushes them while steering.
 */
export function touchLayout(width: number, height: number, hasAbility = false): TouchLayout {
  const dashR = 36;
  const smallR = 20;
  const margin = 14;

  const dash: TouchButton = {
    id: 'dash',
    x: clamp(width - 72, dashR + margin, width - dashR - margin),
    y: clamp(height - 116, dashR + margin, height - dashR - margin),
    r: dashR,
  };

  // Never overlapping dash, whatever the viewport does. On a phone in landscape there
  // is room to spare; on something absurdly short the stack gives way instead of
  // landing on top of the button the player needs mid-dodge.
  const highest = smallR + margin;
  const lowest = Math.max(highest, dash.y - dashR - 8 - smallR);
  const x = clamp(width - 42, smallR + margin, width - smallR - margin);

  // Pause and stats keep their 48px gap and slide down together rather than being
  // clamped independently — clamping each to the same [highest, lowest] band would let
  // a short viewport pull both toward its bottom edge and land one on top of the other.
  let pauseY = 136;
  let statsY = 184;
  if (statsY > lowest) {
    const shift = statsY - lowest;
    pauseY -= shift;
    statsY -= shift;
  }
  if (pauseY < highest) {
    const shift = highest - pauseY;
    pauseY += shift;
    statsY += shift;
  }

  const buttons: TouchButton[] = [
    dash,
    { id: 'pause', x, y: pauseY, r: smallR },
    { id: 'stats', x, y: statsY, r: smallR },
  ];

  // Only while a gift is actually held. An always-present button would sit there
  // doing nothing for most of a run — and, worse, would keep swallowing the touches
  // that land on it, which in the arena means swallowing steering.
  if (hasAbility) {
    const abilityR = 28;
    buttons.push({
      id: 'ability',
      x: clamp(dash.x - dashR - 12 - abilityR, abilityR + margin, width - abilityR - margin),
      y: clamp(dash.y + 6, abilityR + margin, height - abilityR - margin),
      r: abilityR,
    });
  }

  return { buttons };
}

/** Which button a point lands on, if any. */
export function buttonAt(layout: TouchLayout, x: number, y: number): TouchButtonId | null {
  for (const button of layout.buttons) {
    const reach = button.r + HIT_SLOP;
    if (dist2(x, y, button.x, button.y) <= reach * reach) return button.id;
  }
  return null;
}

/**
 * Movement intent from a stick, as a direction and nothing else.
 *
 * Deliberately not analogue. Deflection could scale speed, but a thumb that lands
 * fifteen pixels off centre would then crawl, and crawling out of a fireball is the
 * same as standing in it. Full speed in the chosen direction also matches exactly
 * what the keyboard produces, which is the only input the balance was ever tuned
 * against.
 */
export function stickAxis(origin: Vec2, current: Vec2): Vec2 {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_DEAD_ZONE) return { x: 0, y: 0 };
  return { x: dx / distance, y: dy / distance };
}

/** Knob position for drawing: the finger, pulled back onto the ring. */
export function stickKnob(origin: Vec2, current: Vec2): Vec2 {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_RADIUS) return { x: current.x, y: current.y };
  const scale = STICK_RADIUS / distance;
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

/**
 * Let the origin trail a finger that has run past the ring.
 *
 * With a pinned origin, a player who has dragged far to the right has to drag all the
 * way back before the monster turns left, and the delay is exactly long enough to be
 * hit. Keeping the origin within one radius of the finger makes a reversal cost the
 * width of the dead zone instead.
 */
export function dragStickOrigin(origin: Vec2, current: Vec2): Vec2 {
  const dx = current.x - origin.x;
  const dy = current.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= STICK_RADIUS) return origin;
  const excess = (distance - STICK_RADIUS) / distance;
  return { x: origin.x + dx * excess, y: origin.y + dy * excess };
}
