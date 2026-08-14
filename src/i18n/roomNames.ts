import { getLocale, type Locale } from './locale';

interface RoomNameSet {
  prefixes: string[];
  roots: Record<string, string[]>;
  /**
   * Appended to the boss room's root, e.g. "Cathedral" + " of the Inquisition".
   * Keyed by boss, so the arena is named after whoever actually holds it.
   */
  bossSuffix: Record<string, string>;
}

const ROOM_NAMES: Record<Locale, RoomNameSet> = {
  ru: {
    prefixes: ['Тихий', 'Серый', 'Старый', 'Дальний', 'Мокрый', 'Кривой', 'Волчий', 'Пепельный', 'Глухой', 'Последний'],
    roots: {
      hamlet: ['Хутор', 'Выселок', 'Двор', 'Займище'],
      village: ['Погост', 'Посад', 'Селище', 'Городище'],
      fortified: ['Острог', 'Застава', 'Крепь', 'Вал'],
      shrine: ['Скит', 'Часовня', 'Обитель', 'Придел'],
      elite: ['Гарнизон', 'Дозор', 'Ставка', 'Караул'],
      boss: ['Собор', 'Оплот', 'Твердыня'],
    },
    bossSuffix: { inquisitor: 'Инквизиции', warlord: 'Воеводы', pyromancer: 'Огнедержицы' },
  },
  en: {
    prefixes: ['Quiet', 'Grey', 'Old', 'Far', 'Wet', 'Crooked', 'Wolf', 'Ashen', 'Deaf', 'Last'],
    roots: {
      hamlet: ['Homestead', 'Outskirt', 'Yard', 'Claim'],
      village: ['Graveyard', 'Township', 'Settlement', 'Hillfort'],
      fortified: ['Stockade', 'Outpost', 'Redoubt', 'Rampart'],
      shrine: ['Hermitage', 'Chapel', 'Cloister', 'Sanctum'],
      elite: ['Garrison', 'Watch', 'Encampment', 'Guardpost'],
      boss: ['Cathedral', 'Bastion', 'Stronghold'],
    },
    bossSuffix: { inquisitor: 'of the Inquisition', warlord: 'of the Warlord', pyromancer: 'of the Pyromancer' },
  },
  de: {
    prefixes: ['Stiller', 'Grauer', 'Alter', 'Ferner', 'Nasser', 'Krummer', 'Wölfischer', 'Aschener', 'Tauber', 'Letzter'],
    roots: {
      hamlet: ['Hof', 'Weiler', 'Anwesen', 'Rodung'],
      village: ['Friedhof', 'Flecken', 'Siedlung', 'Ringwall'],
      fortified: ['Palisadenlager', 'Vorposten', 'Schanze', 'Wall'],
      shrine: ['Klause', 'Kapelle', 'Kloster', 'Heiligtum'],
      elite: ['Garnison', 'Wache', 'Feldlager', 'Wachposten'],
      boss: ['Kathedrale', 'Bastion', 'Feste'],
    },
    bossSuffix: { inquisitor: 'der Inquisition', warlord: 'des Heerführers', pyromancer: 'der Feuerherrin' },
  },
  uk: {
    prefixes: ['Тихий', 'Сірий', 'Старий', 'Далекий', 'Мокрий', 'Кривий', 'Вовчий', 'Попелястий', 'Глухий', 'Останній'],
    roots: {
      hamlet: ['Хутір', 'Виселок', 'Двір', 'Займище'],
      village: ['Погост', 'Посад', 'Селище', 'Городище'],
      fortified: ['Острог', 'Застава', 'Укріплення', 'Вал'],
      shrine: ['Скит', 'Каплиця', 'Обитель', 'Приділ'],
      elite: ['Гарнізон', 'Дозор', 'Ставка', 'Караул'],
      boss: ['Собор', 'Бастіон', 'Твердиня'],
    },
    bossSuffix: { inquisitor: 'Інквізиції', warlord: 'Воєводи', pyromancer: 'Вогнетримачки' },
  },
  fr: {
    prefixes: ['Silencieux', 'Gris', 'Vieux', 'Lointain', 'Humide', 'Tordu', 'Loup', 'Cendré', 'Sourd', 'Dernier'],
    roots: {
      hamlet: ['Hameau', 'Écart', 'Enclos', 'Défriche'],
      village: ['Nécropole', 'Bourg', 'Peuplement', 'Oppidum'],
      fortified: ['Palanque', 'Avant-poste', 'Redoute', 'Rempart'],
      shrine: ['Ermitage', 'Chapelle', 'Cloître', 'Sanctuaire'],
      elite: ['Garnison', 'Guet', 'Campement', 'Corps de garde'],
      boss: ['Cathédrale', 'Bastion', 'Forteresse'],
    },
    bossSuffix: { inquisitor: "de l'Inquisition", warlord: 'du Seigneur de guerre', pyromancer: 'de la Pyromancienne' },
  },
};

export function roomNamePrefixes(): string[] {
  return ROOM_NAMES[getLocale()].prefixes;
}

export function roomNameRoots(kind: string): string[] {
  return ROOM_NAMES[getLocale()].roots[kind] ?? [];
}

export function roomNameBossSuffix(bossId: string): string {
  const set = ROOM_NAMES[getLocale()].bossSuffix;
  return set[bossId] ?? set.inquisitor ?? '';
}
