import { type Vec2 } from './math';

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

const BINDINGS: Record<string, ActionName> = {
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

/**
 * Keyboard + mouse state.
 *
 * `pressed` is edge-triggered and cleared by `endFrame()`, so consumers must read
 * it during the frame it happened. `held` is level-triggered.
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

  constructor(target: HTMLElement) {
    this.target = target;
    this.attach();
  }

  private attach(): void {
    const onKeyDown = (e: KeyboardEvent) => {
      const action = BINDINGS[e.code];
      if (!action) return;
      // Tab and Space would otherwise scroll or move focus out of the canvas.
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.held.has(action)) this.pressed.add(action);
      this.held.add(action);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const action = BINDINGS[e.code];
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

    // Losing focus mid-key would otherwise leave the monster walking forever.
    const onBlur = () => {
      this.held.clear();
      this.mouseDown = false;
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.target.addEventListener('mousemove', onMouseMove);
    this.target.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.target.addEventListener('wheel', onWheel, { passive: true });
    this.target.addEventListener('contextmenu', onContextMenu);

    this.listeners.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => this.target.removeEventListener('mousemove', onMouseMove),
      () => this.target.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
      () => this.target.removeEventListener('wheel', onWheel),
      () => this.target.removeEventListener('contextmenu', onContextMenu),
    );
  }

  isHeld(action: ActionName): boolean {
    return this.held.has(action);
  }

  wasPressed(action: ActionName): boolean {
    return this.pressed.has(action);
  }

  wasReleased(action: ActionName): boolean {
    return this.released.has(action);
  }

  /** Movement intent, normalised so diagonals aren't faster. */
  moveAxis(): Vec2 {
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
