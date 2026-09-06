import { beforeEach, describe, expect, it } from 'vitest';
import { insetExpression, insetsEqual, NO_INSETS, readSafeAreaInsets } from './safe-area';

/** The hidden element the module measures, once it has been created. */
function probeElement(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('div[style*="visibility: hidden"]');
}

describe('readSafeAreaInsets', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('reports no insets where the platform declares none', () => {
    // jsdom has no notion of `env()`, which is the same situation as every desktop
    // browser: the property resolves to nothing and there is nothing to avoid.
    expect(readSafeAreaInsets()).toEqual(NO_INSETS);
  });

  it('reads the four edges off the probe', () => {
    readSafeAreaInsets();
    const probe = probeElement();
    expect(probe).not.toBeNull();

    probe!.style.paddingTop = '59px';
    probe!.style.paddingRight = '14px';
    probe!.style.paddingBottom = '34px';
    probe!.style.paddingLeft = '0px';

    expect(readSafeAreaInsets()).toEqual({ top: 59, right: 14, bottom: 34, left: 0 });
  });

  it('keeps one probe however often it is asked', () => {
    // Called on every resize, and a phone being rotated fires a burst of them. A probe
    // per call would grow the document without bound.
    for (let i = 0; i < 5; i++) readSafeAreaInsets();
    expect(document.body.children).toHaveLength(1);
  });

  it('rebuilds a probe that was taken out of the document', () => {
    readSafeAreaInsets();
    document.body.replaceChildren();
    readSafeAreaInsets();
    expect(probeElement()).not.toBeNull();
  });

  it('treats a negative or unparseable edge as zero', () => {
    readSafeAreaInsets();
    const probe = probeElement()!;
    probe.style.paddingTop = 'not-a-length';
    expect(readSafeAreaInsets().top).toBe(0);
  });
});

describe('insetExpression', () => {
  it('asks for the native variable ahead of env(), and zero ahead of nothing', () => {
    // The order is the whole point inside Capacitor's WKWebView, where `env()` reports
    // zeros regardless of the notch and `GameViewController` supplies the real numbers.
    expect(insetExpression('left')).toBe(
      'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
    );
  });
});

describe('insetsEqual', () => {
  it('is true only when all four edges match', () => {
    const base = { top: 1, right: 2, bottom: 3, left: 4 };
    expect(insetsEqual(base, { ...base })).toBe(true);
    expect(insetsEqual(base, { ...base, left: 5 })).toBe(false);
    expect(insetsEqual(NO_INSETS, NO_INSETS)).toBe(true);
  });
});
