import { EN } from './dict.en';
import { DE } from './dict.de';
import { RU } from './dict.ru';
import { UK } from './dict.uk';
import { FR } from './dict.fr';
import { IT } from './dict.it';
import { HR } from './dict.hr';
import { getLocale, type Locale } from './locale';

export { getLocale, setLocale, LOCALES, type Locale } from './locale';
export { roomNamePrefixes, roomNameRoots, roomNameBossSuffix } from './roomNames';

const DICTS: Record<Locale, Record<string, string>> = { en: EN, de: DE, ru: RU, uk: UK, fr: FR, it: IT, hr: HR };

/** Human-readable name for each selectable language, always shown in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  de: 'DE',
  ru: 'RU',
  uk: 'UA',
  fr: 'FR',
  it: 'IT',
  hr: 'HR',
};

/**
 * Each language named in itself, never translated.
 *
 * A player who cannot read the current language still has to be able to find one they
 * can, and 'Russisch' is no help to someone who only reads Russian.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  ru: 'Русский',
  uk: 'Українська',
  fr: 'Français',
  it: 'Italiano',
  hr: 'Hrvatski',
};

/** Translate a flat dot-path key, optionally interpolating `{name}`-style placeholders. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[getLocale()];
  let value = dict[key] ?? EN[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${name}\\}`, 'g'), String(replacement));
    }
  }
  return value;
}
