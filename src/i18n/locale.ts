export type Locale = 'en' | 'de' | 'ru';

export const LOCALES: readonly Locale[] = ['en', 'de', 'ru'];

const STORAGE_KEY = 'samarkand.locale';

/** Best-guess locale from the browser, for a player's very first visit. */
function detectLocale(): Locale {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  const lang = nav.slice(0, 2).toLowerCase();
  if (lang === 'de') return 'de';
  if (lang === 'ru') return 'ru';
  return 'en';
}

function loadLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'de' || saved === 'ru') return saved;
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
