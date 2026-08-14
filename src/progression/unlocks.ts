import { BOONS } from './boons';
import { MUTATIONS } from './evolution';
import { type UnlockCategory } from './gate';
import { type Rarity, SKILL_CARDS } from './skills';
import { SPECIES } from './species';

export { type ContentGate, OPEN_GATE, type UnlockCategory } from './gate';

export interface UnlockDef {
  /** Namespaced key, e.g. `card:ricochet`. Ids are unique per category only. */
  readonly id: string;
  readonly category: UnlockCategory;
  /** Id within its own content table. */
  readonly refId: string;
  readonly price: number;
  /** Sort weight inside its category — cheaper and simpler things first. */
  readonly tier: number;
}

export function unlockKey(category: UnlockCategory, refId: string): string {
  return `${category}:${refId}`;
}

const CARD_PRICE: Record<Rarity, number> = {
  common: 0,
  rare: 45,
  epic: 90,
  legendary: 165,
};

const RARITY_TIER: Record<Rarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/**
 * What a fresh profile can already use.
 *
 * The starting pool has to be a playable game on its own: every common, a handful of
 * rares covering each element, two epics so early runs still get a build-defining
 * moment, the plain body mutations, and three temporary forms. Everything else is
 * something to work toward.
 */
const DEFAULT_CARDS = new Set([
  'piercing',
  'ricochet',
  'burning-blood',
  'venom-glands',
  'shadow-step',
  'killer-focus',
  'flesh-burst',
  'second-wind',
]);

const DEFAULT_MUTATIONS = new Set([
  'abyssal-maw',
  'bone-crown',
  'dark-wings',
  'many-eyes',
  'spine-ridge',
  'lash-tails',
  'extra-limbs',
  'bloated-mass',
  'hound-form',
]);

const DEFAULT_BOONS = new Set(['pyre', 'colossus', 'wraith']);

/**
 * The unlock catalogue, derived from the content tables themselves.
 *
 * Nothing is listed by hand: adding a card or a mutation automatically adds its
 * unlock entry at the right price, so the shop can never drift out of sync with what
 * the game actually contains.
 */
export const UNLOCKS: readonly UnlockDef[] = [
  ...SKILL_CARDS.filter((card) => card.rarity !== 'common' && !DEFAULT_CARDS.has(card.id)).map(
    (card) => ({
      id: unlockKey('card', card.id),
      category: 'card' as const,
      refId: card.id,
      price: CARD_PRICE[card.rarity],
      tier: RARITY_TIER[card.rarity],
    }),
  ),
  ...MUTATIONS.filter((mutation) => !DEFAULT_MUTATIONS.has(mutation.id)).map((mutation) => ({
    id: unlockKey('mutation', mutation.id),
    category: 'mutation' as const,
    refId: mutation.id,
    price: 125,
    tier: 1,
  })),
  ...BOONS.filter((boon) => !DEFAULT_BOONS.has(boon.id)).map((boon) => ({
    id: unlockKey('boon', boon.id),
    category: 'boon' as const,
    refId: boon.id,
    price: 70,
    tier: 1,
  })),
  // Bodies carry their own price: they differ far more from each other than two
  // cards of the same rarity do, so a flat per-category price would misprice them.
  ...SPECIES.filter((species) => species.price > 0).map((species) => ({
    id: unlockKey('species', species.id),
    category: 'species' as const,
    refId: species.id,
    price: species.price,
    tier: 1,
  })),
];

const UNLOCKS_BY_ID = new Map(UNLOCKS.map((u) => [u.id, u]));

export function getUnlock(id: string): UnlockDef | undefined {
  return UNLOCKS_BY_ID.get(id);
}

export function unlocksInCategory(category: UnlockCategory): UnlockDef[] {
  return UNLOCKS.filter((u) => u.category === category).sort(
    (a, b) => a.tier - b.tier || a.price - b.price || a.refId.localeCompare(b.refId),
  );
}

/**
 * Whether a piece of content is usable given the owned set.
 *
 * Content with no unlock entry is available to everyone — that is how commons and the
 * starting selection stay free without needing to be listed twice.
 */
export function isContentAvailable(
  owned: ReadonlySet<string>,
  category: UnlockCategory,
  refId: string,
): boolean {
  const key = unlockKey(category, refId);
  if (!UNLOCKS_BY_ID.has(key)) return true;
  return owned.has(key);
}

/** Total price of everything still locked — shown as the long-term goal. */
export function remainingCost(owned: ReadonlySet<string>): number {
  return UNLOCKS.filter((u) => !owned.has(u.id)).reduce((sum, u) => sum + u.price, 0);
}
