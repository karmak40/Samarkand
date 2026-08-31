export type Locale = 'en' | 'de' | 'ru' | 'uk' | 'fr' | 'it';

export const LOCALES: readonly Locale[] = ['en', 'de', 'ru', 'uk', 'fr', 'it'];

const STORAGE_KEY = 'samarkand.locale';

/**
 * Best-guess locale from the browser, for a player's very first visit.
 *
 * Walks the full preference list (`navigator.languages`), not just the first entry:
 * a system set to French with German as a fallback should still land on German rather
 * than skipping straight past it to English. Whatever isn't one of the game's other
 * locales anywhere in that list falls back to English.
 */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';

  const preferences =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || ''];

  for (const preference of preferences) {
    const lang = preference.slice(0, 2).toLowerCase();
    if (lang === 'de') return 'de';
    if (lang === 'ru') return 'ru';
    if (lang === 'uk') return 'uk';
    if (lang === 'fr') return 'fr';
    if (lang === 'it') return 'it';
  }
  return 'en';
}

function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'de' || saved === 'ru' || saved === 'uk' || saved === 'fr' || saved === 'it') {
      return saved;
    }
  } catch {
    // Private browsing or a disabled store — fall back to detection.
  }
  return detectLocale();
}

let current: Locale = loadLocale();

/**
 * Keep the document's language attribute honest.
 *
 * Nothing on screen depends on it — the game draws its own text — but a screen reader
 * announcing Russian with English phonemes is unusable, and search engines and
 * translation tools read this attribute rather than the canvas.
 */
function syncDocumentLanguage(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

syncDocumentLanguage(current);

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  syncDocumentLanguage(locale);
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // The switch still applies for the rest of the session even if it can't persist.
  }
}
