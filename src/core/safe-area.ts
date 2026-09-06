/**
 * The strips of the viewport the system has already claimed.
 *
 * On a desktop browser these are all zero and nothing below matters. On a phone they
 * are the notch or Dynamic Island, the rounded corners, and the home indicator — areas
 * that are still ours to draw into, but not ours to put anything a thumb has to reach
 * or an eye has to read. The arena keeps bleeding into them, because a wider view of
 * the world is only ever a gift; the HUD and the on-screen controls do not.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * `env(safe-area-inset-*)` is readable from CSS and nowhere else — there is no
 * scripting API for it. So a hidden element takes the four values as padding and the
 * computed style hands them back as resolved pixels.
 *
 * It lives here rather than in `index.html` for the same reason the touch button
 * geometry lives next to its hit test: the half that declares the values and the half
 * that reads them have to agree, and they only stay in agreement if changing one puts
 * the other on screen.
 *
 * `--safe-area-inset-*` is tried ahead of `env()` because of one platform that lies.
 * Inside Capacitor's WKWebView the web view is the view controller's root view, and
 * WebKit then reports every `env(safe-area-inset-*)` as `0px` even under
 * `viewport-fit=cover` — while happily drawing the page under the Dynamic Island.
 * `GameViewController` pushes the real numbers in as those variables. Everywhere else
 * the variable is unset, the fallback chain reaches `env()`, and nothing native is
 * involved at all.
 */
let probe: HTMLElement | null = null;

/**
 * The CSS the probe is measured through, for one edge.
 *
 * Exported only so the ordering can be asserted: jsdom refuses to parse the value at
 * all, so a test that went through the element would be measuring jsdom's CSS support
 * rather than this decision.
 */
export function insetExpression(edge: 'top' | 'right' | 'bottom' | 'left'): string {
  return `var(--safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px))`;
}

function ensureProbe(): HTMLElement | null {
  if (probe?.isConnected) return probe;
  if (typeof document === 'undefined' || !document.body) return null;

  probe = document.createElement('div');
  // Zero-sized and invisible, but still laid out — `display: none` would leave the
  // computed padding at zero and quietly report a phone as a desktop.
  probe.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 0',
    'height: 0',
    'visibility: hidden',
    'pointer-events: none',
    `padding-top: ${insetExpression('top')}`,
    `padding-right: ${insetExpression('right')}`,
    `padding-bottom: ${insetExpression('bottom')}`,
    `padding-left: ${insetExpression('left')}`,
  ].join(';');
  document.body.appendChild(probe);
  return probe;
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Read the current insets, in CSS pixels.
 *
 * Cheap enough to call on every resize and no cheaper — it forces a style resolve —
 * so callers cache the result rather than asking per frame.
 *
 * Requires `viewport-fit=cover` on the viewport meta tag for the `env()` path. Without
 * it the browser insets the layout viewport itself and reports zeros here, which is a
 * coherent answer to a different question: there is then nothing to avoid, because
 * nothing is drawn under the notch in the first place.
 */
export function readSafeAreaInsets(): Insets {
  const el = ensureProbe();
  if (!el || typeof getComputedStyle !== 'function') return NO_INSETS;

  const style = getComputedStyle(el);
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
}

export function insetsEqual(a: Insets, b: Insets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}
