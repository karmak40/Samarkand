import { type Vec2 } from './math';
import {
  buttonAt,
  dragStickOrigin,
  SCROLL_STEP,
  stickAxis,
  stickKnob,
  TAP_SLOP,
  type TouchButtonId,
  touchLayout,
  type TouchLayout,
  type TouchMode,
} from './touch';

export type ActionName =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'dash'
  | 'ability'
  | 'pause'
  | 'stats'
  | 'confirm'
  | 'slot1'
  | 'slot2'
  | 'slot3';

/**
 * Actions a player may rebind, in the order the settings screen lists them.
 *
 * Not every action: 'confirm' and the three slot keys are how the modal screens are
 * driven, and letting those be moved onto a key the menu also uses would leave a
 * player unable to reach the screen that would let them undo it.
 */
export const REBINDABLE: readonly ActionName[] = [
  'up',
  'down',
  'left',
  'right',
  'dash',
  'ability',
  'stats',
];

export const DEFAULT_BINDINGS: Readonly<Record<string, ActionName>> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dash',
  ShiftLeft: 'dash',
  KeyE: 'ability',
  Escape: 'pause',
  Tab: 'stats',
  Enter: 'confirm',
  Digit1: 'slot1',
  Digit2: 'slot2',
  Digit3: 'slot3',
};

/** Codes the browser would act on itself, and so must be swallowed when bound. */
const SWALLOW = new Set([
  'Tab',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Slash',
  'Quote',
  'Backspace',
]);

/**
 * Keyboard, mouse and touch state.
 *
 * `pressed` is edge-triggered and cleared by `endFrame()`, so consumers must read
 * it during the frame it happened. `held` is level-triggered.
 *
 * Touch is folded into the same three outputs the keyboard and mouse already feed —
 * `moveAxis`, the action sets, and the mouse fields — rather than exposed as a fourth
 * kind of input. That is the whole reason the game runs on a phone without a single
 * change to the simulation or to any screen: a stick is movement, an on-screen button
 * is a pressed action, and a tap is a click.
 */
export class Input {
  private readonly held = new Set<ActionName>();
  private readonly pressed = new Set<ActionName>();
  private readonly released = new Set<ActionName>();

  /** Mouse position in CSS pixels relative to the canvas. */
  readonly mouse: Vec2 = { x: 0, y: 0 };
  mouseDown = false;
  mouseClicked = false;
  /** Accumulated wheel delta for this frame. */
  wheel = 0;

  private readonly target: HTMLElement;
  private readonly listeners: Array<() => void> = [];

  /** Live code -> action map. A copy, so rebinding never edits the defaults. */
  private bindings: Record<string, ActionName> = { ...DEFAULT_BINDINGS };

  /**
   * Set while the settings screen is waiting for a key.
   *
   * Capture lives here rather than in the screen because this class already owns the
   * only keydown listener; a second one would race it and translate the very press
   * the player meant as a binding.
   */
  private capture: ((code: string) => void) | null = null;

  // ---- touch -----------------------------------------------------------------

  /** Latched by the first real touch, so a mouse player is never shown a joystick. */
  private touchSeen = false;
  private touchEnabled = false;
  private touchMode: TouchMode = 'ui';
  private layout: TouchLayout = touchLayout(0, 0);

  /** The touch steering the monster, if any, with where it landed and where it is now. */
  private stickTouch: number | null = null;
  private stickFrom: Vec2 = { x: 0, y: 0 };
  private stickTo: Vec2 = { x: 0, y: 0 };

  /** Which button each finger currently holds down. */
  private readonly buttonTouches = new Map<number, TouchButtonId>();

  /** The touch standing in for the mouse on a menu screen. */
  private uiTouch: number | null = null;
  /** Total travel of that touch, to tell a tap from a scroll. */
  private uiTravel = 0;
  private scrollAccum = 0;

  constructor(target: HTMLElement) {
    this.target = target;
    this.attach();
  }

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      if (this.capture) {
        e.preventDefault();
        const take = this.capture;
        this.capture = null;
        take(e.code);
        return;
      }

      const action = this.bindings[e.code];
      if (!action) return;
      // Tab, Space and the arrows would otherwise scroll the page or move focus out
      // of the canvas.
      if (SWALLOW.has(e.code)) e.preventDefault();
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = this.bindings[e.code];
      if (!action) return;
      this.held.delete(action);
      this.released.add(action);
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = this.target.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mouseClicked = true;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.mouseDown = false;
    };

    const onWheel = (e: WheelEvent) => {
      this.wheel += e.deltaY;
    };

    // Losing focus mid-key would otherwise leave the monster walking forever. The same
    // goes for a finger: a touch that never gets its touchend, because the browser took
    // the window away mid-drag, would steer for the rest of the run.
    const onBlur = () => {
      this.held.clear();
      this.mouseDown = false;
      this.stickTouch = null;
      this.uiTouch = null;
      this.buttonTouches.clear();
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    const localOf = (touch: Touch, bounds: DOMRect): Vec2 => ({
      x: touch.clientX - bounds.left,
      y: touch.clientY - bounds.top,
    });

    const onTouchStart = (e: TouchEvent) => {
      // Swallowed whole. The defaults here are page scrolling, pinch zoom, the
      // double-tap zoom that eats the second tap of any quick pair, and the synthetic
      // mouse events that would otherwise deliver every tap to the UI twice — buying
      // two relics where the player asked for one.
      e.preventDefault();
      this.touchSeen = true;

      const bounds = this.target.getBoundingClientRect();
      this.layout = touchLayout(bounds.width, bounds.height);

      for (const touch of Array.from(e.changedTouches)) {
        const at = localOf(touch, bounds);

        if (this.touchEnabled && this.touchMode === 'play') {
          const button = buttonAt(this.layout, at.x, at.y);
          if (button) {
            this.buttonTouches.set(touch.identifier, button);
            if (!this.held.has(button)) this.pressed.add(button);
            this.held.add(button);
            continue;
          }

          // Everything that isn't a button steers. The pad is the whole screen, so
          // there is no small target to find and none to miss in a fight.
          if (this.stickTouch === null) {
            this.stickTouch = touch.identifier;
            this.stickFrom = at;
            this.stickTo = { x: at.x, y: at.y };
          }
          continue;
        }

        if (this.uiTouch === null) {
          this.uiTouch = touch.identifier;
          this.mouse.x = at.x;
          this.mouse.y = at.y;
          this.mouseDown = true;
          this.uiTravel = 0;
          this.scrollAccum = 0;
        }
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const bounds = this.target.getBoundingClientRect();

      for (const touch of Array.from(e.changedTouches)) {
        const at = localOf(touch, bounds);

        if (touch.identifier === this.stickTouch) {
          this.stickFrom = dragStickOrigin(this.stickFrom, at);
          this.stickTo = at;
          continue;
        }
        // A finger keeps the button it landed on until it lifts. Sliding off would
        // otherwise re-arm dash under a thumb that is only shifting its grip.
        if (this.buttonTouches.has(touch.identifier)) continue;
        if (touch.identifier !== this.uiTouch) continue;

        this.uiTravel += Math.hypot(at.x - this.mouse.x, at.y - this.mouse.y);
        this.scrollAccum += at.y - this.mouse.y;
        this.mouse.x = at.x;
        this.mouse.y = at.y;

        // Dragging is how a list scrolls on glass. One notch per step of travel, with
        // the remainder kept so a slow drag still arrives.
        while (Math.abs(this.scrollAccum) >= SCROLL_STEP) {
          const direction = Math.sign(this.scrollAccum);
          this.scrollAccum -= direction * SCROLL_STEP;
          // Pulling the content upward moves further down the list, as it does anywhere
          // else a finger scrolls something.
          this.wheel = -direction;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();

      for (const touch of Array.from(e.changedTouches)) {
        const button = this.buttonTouches.get(touch.identifier);
        if (button !== undefined) {
          this.buttonTouches.delete(touch.identifier);
          // Only release once no other finger is still on the same button.
          if (!this.isTouchButtonHeld(button)) {
            this.held.delete(button);
            this.released.add(button);
          }
          continue;
        }

        if (touch.identifier === this.stickTouch) {
          this.stickTouch = null;
          continue;
        }

        if (touch.identifier === this.uiTouch) {
          this.uiTouch = null;
          this.mouseDown = false;
          // A tap presses; a drag was a scroll, and must not also press whatever it
          // happened to start on top of.
          if (this.uiTravel <= TAP_SLOP) this.mouseClicked = true;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.target.addEventListener('mousemove', onMouseMove);
    this.target.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.target.addEventListener('wheel', onWheel, { passive: true });
    this.target.addEventListener('contextmenu', onContextMenu);
    // Not passive: every one of these calls preventDefault, and a passive listener that
    // does so is ignored with a console warning rather than obeyed.
    this.target.addEventListener('touchstart', onTouchStart, { passive: false });
    this.target.addEventListener('touchmove', onTouchMove, { passive: false });
    this.target.addEventListener('touchend', onTouchEnd, { passive: false });
    this.target.addEventListener('touchcancel', onTouchEnd, { passive: false });

    this.listeners.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.target.removeEventListener('mousemove', onMouseMove),
      () => this.target.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.target.removeEventListener('wheel', onWheel),
      () => this.target.removeEventListener('contextmenu', onContextMenu),
      () => this.target.removeEventListener('touchstart', onTouchStart),
      () => this.target.removeEventListener('touchmove', onTouchMove),
      () => this.target.removeEventListener('touchend', onTouchEnd),
      () => this.target.removeEventListener('touchcancel', onTouchEnd),
    );
  }

  // ---- touch -------------------------------------------------------------------

  /**
   * Tell the input layer what the on-screen controls are for right now.
   *
   * Pushed in by the game once a frame rather than worked out here: whether the pad is
   * live is a player setting, and whether a touch is steering or clicking depends on
   * which screen is open. This class has no business knowing about either.
   */
  setTouchContext(enabled: boolean, mode: TouchMode): void {
    if (mode !== this.touchMode || (this.touchEnabled && !enabled)) {
      // A finger mid-drag when a menu opens must not keep steering behind it — and,
      // worse, must not still be steering when the menu closes, which would leave the
      // monster walking off on its own with nobody touching the screen.
      this.stickTouch = null;
      this.uiTouch = null;
      this.mouseDown = false;
    }
    this.touchEnabled = enabled;
    this.touchMode = mode;
  }

  /** True once the player has actually touched the screen, ever. */
  get touchDetected(): boolean {
    return this.touchSeen;
  }

  /** Where to draw the stick, or null when no finger is steering. */
  stickView(): { origin: Vec2; knob: Vec2 } | null {
    if (this.stickTouch === null) return null;
    return { origin: this.stickFrom, knob: stickKnob(this.stickFrom, this.stickTo) };
  }

  isTouchButtonHeld(id: TouchButtonId): boolean {
    for (const held of this.buttonTouches.values()) {
      if (held === id) return true;
    }
    return false;
  }

  // ---- bindings --------------------------------------------------------------

  /** Replace the whole map. Anything not listed is simply unbound. */
  setBindings(bindings: Record<string, ActionName>): void {
    this.bindings = { ...bindings };
    // A key held when the map changed would stay held forever: its code no longer
    // resolves to the action, so the keyup that should clear it never matches.
    this.held.clear();
  }

  bindingMap(): Record<string, ActionName> {
    return { ...this.bindings };
  }

  /** Every code currently bound to an action, in insertion order. */
  codesFor(action: ActionName): string[] {
    return Object.keys(this.bindings).filter((code) => this.bindings[code] === action);
  }

  /**
   * Point an action at a key.
   *
   * The action's existing codes are dropped first, so rebinding replaces rather than
   * accumulates, and the code is taken off whatever else held it — two actions on one
   * key is never what someone meant, and the second one would simply never fire.
   */
  rebind(action: ActionName, code: string): void {
    for (const existing of this.codesFor(action)) delete this.bindings[existing];
    this.bindings[code] = action;
    this.held.clear();
  }

  resetBindings(): void {
    this.setBindings({ ...DEFAULT_BINDINGS });
  }

  /** Hand the next keypress to `take` instead of translating it. */
  captureNextKey(take: (code: string) => void): void {
    this.capture = take;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  get capturing(): boolean {
    return this.capture !== null;
  }

  // ---- reading -----------------------------------------------------------------

  isHeld(action: ActionName): boolean {
    return this.held.has(action);
  }

  wasPressed(action: ActionName): boolean {
    return this.pressed.has(action);
  }

  /**
   * Read an edge and claim it, so nothing else can act on the same press.
   *
   * A frame updates and *then* draws, which means a screen opened by a key press is
   * drawn while that press is still in the set — the new screen reads it and undoes
   * the transition on the spot. That is precisely why ESC never opened the pause
   * menu: `update` paused, `draw` saw the same press and resumed.
   *
   * Rule of thumb: testing a press is `wasPressed`, acting on one is `consumePress`.
   */
  consumePress(action: ActionName): boolean {
    return this.pressed.delete(action);
  }

  wasReleased(action: ActionName): boolean {
    return this.released.has(action);
  }

  /** Movement intent, normalised so diagonals aren't faster. */
  moveAxis(): Vec2 {
    // A finger on the glass wins outright. Nobody steers with both at once, and summing
    // them would let a key that stuck on blur drag the monster sideways while someone is
    // trying to walk out of a fire.
    if (this.stickTouch !== null) return stickAxis(this.stickFrom, this.stickTo);

    let x = 0;
    let y = 0;
    if (this.isHeld('left')) x -= 1;
    if (this.isHeld('right')) x += 1;
    if (this.isHeld('up')) y -= 1;
    if (this.isHeld('down')) y += 1;

    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  /** Must be called once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mouseClicked = false;
    this.wheel = 0;
  }

  destroy(): void {
    for (const off of this.listeners) off();
    this.listeners.length = 0;
  }
}
