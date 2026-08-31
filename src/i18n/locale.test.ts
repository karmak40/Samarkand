import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module picks a locale once, at import time (`let current = loadLocale()`), so
// each scenario needs the browser and the save mocked *before* a fresh import — hence
// `vi.resetModules()` plus a dynamic `import()` in every test rather than one at the
// top of the file.
const STORAGE_KEY = 'samarkand.locale';

function stubNavigator(languages: string[]): void {
  vi.stubGlobal('navigator', { language: languages[0] ?? '', languages });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('first visit (nothing saved)', () => {
  it('picks German for a German system', async () => {
    stubNavigator(['de-DE']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('de');
  });

  it('picks Russian for a Russian system', async () => {
    stubNavigator(['ru-RU']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('ru');
  });

  it('picks Ukrainian for a Ukrainian system', async () => {
    stubNavigator(['uk-UA']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('uk');
  });

  it('picks French for a French system', async () => {
    stubNavigator(['fr-FR']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('fr');
  });

  it('picks Italian for an Italian system', async () => {
    stubNavigator(['it-IT']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('it');
  });

  it('picks Croatian for a Croatian system', async () => {
    stubNavigator(['hr-HR']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('hr');
  });

  it('falls back to English for a language the game does not have', async () => {
    stubNavigator(['es-ES']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('en');
  });

  it('falls back to English when the system reports no language at all', async () => {
    stubNavigator([]);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('en');
  });

  it('looks past an unsupported first preference to a supported one further down the list', async () => {
    // A system set to Spanish with German as the fallback language should land on
    // German, not skip straight past it to English.
    stubNavigator(['es-ES', 'de-DE']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('de');
  });
});

describe('a returning player', () => {
  it('uses the saved choice over whatever the system reports', async () => {
    localStorage.setItem(STORAGE_KEY, 'ru');
    stubNavigator(['en-US']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('ru');
  });

  it('ignores a corrupted save and detects again', async () => {
    localStorage.setItem(STORAGE_KEY, 'klingon');
    stubNavigator(['de-DE']);
    const { getLocale } = await import('./locale');
    expect(getLocale()).toBe('de');
  });
});

describe('setLocale', () => {
  it('persists the choice and updates the document language', async () => {
    stubNavigator(['en-US']);
    const { getLocale, setLocale } = await import('./locale');

    setLocale('ru');

    expect(getLocale()).toBe('ru');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
  });
});
