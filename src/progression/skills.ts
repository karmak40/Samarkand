import { RARITY, SKILL_CARDS } from '../balance';
import { RNG } from '../core/rng';
import { t } from '../i18n';
import { type ContentGate, OPEN_GATE } from './gate';
import { type BehaviorFlag, type StatKey, type StatSheet } from './stats';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface RarityStyle {
  readonly name: string;
  readonly color: string;
  readonly glow: string;
  /** Base weight in the draw. Modified by run depth. */
  readonly weight: number;
}

// The actual per-rarity weights/colours and the card pool live in `../balance` now
// -- re-exporting keeps every existing `from './skills'` import working unchanged.
export { RARITY, SKILL_CARDS };

export type SkillTag =
  | 'damage'
  | 'defense'
  | 'speed'
  | 'projectiles'
  | 'fire'
  | 'poison'
  | 'frost'
  | 'lightning'
  | 'unholy'
  | 'crit'
  | 'lifesteal'
  | 'destruction'
  | 'fear';

/** Display label for a skill tag chip. */
export function tagLabel(tag: SkillTag): string {
  return t(`skillTag.${tag}`);
}

/** Stat change without a source — the source is filled in when the card is taken. */
export interface RawModifier {
  key: StatKey;
  flat?: number;
  mult?: number;
}

export interface SkillCard {
  readonly id: string;
  readonly name: string;
  readonly rarity: Rarity;
  /** Balance-file toggle: false removes this card from the draw pool entirely. */
  readonly enabled: boolean;
  readonly description: string;
  readonly tags: readonly SkillTag[];
  /** How many times this card can be taken in one run. */
  readonly maxStacks: number;
  /** Extra weight multiplier on top of the rarity weight. */
  readonly weight?: number;
  readonly modifiers?: readonly RawModifier[];
  readonly behaviors?: readonly BehaviorFlag[];
  /** Only offered when this returns true. */
  readonly requires?: (context: SkillContext) => boolean;
}

export interface SkillContext {
  /** How many times each card has been taken. */
  readonly taken: ReadonlyMap<string, number>;
  readonly stats: StatSheet;
  readonly depth: number;
}


/** Rarity from weakest to strongest, for floor comparisons. */
const RARITY_ORDER: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];

const CARDS_BY_ID = new Map(SKILL_CARDS.map((c) => [c.id, c]));

export function getCard(id: string): SkillCard | undefined {
  return CARDS_BY_ID.get(id);
}

/**
 * Draws the three cards offered after each room.
 *
 * Two rules keep the offers feeling fair:
 *  - a card at max stacks or with an unmet requirement is never shown;
 *  - the three cards are always distinct, and rarity odds improve with depth.
 */
export class SkillPool {
  private readonly taken = new Map<string, number>();
  /** Cards seen but declined, tracked for the run summary. */
  private readonly seen = new Set<string>();

  /**
   * @param gate decides which cards this profile has unlocked. Locked cards are
   *             never offered, so the pool a player sees grows as they earn souls.
   */
  constructor(
    private readonly rng: RNG,
    private readonly gate: ContentGate = OPEN_GATE,
  ) {}

  takenCount(id: string): number {
    return this.taken.get(id) ?? 0;
  }

  get takenList(): Array<{ card: SkillCard; stacks: number }> {
    const out: Array<{ card: SkillCard; stacks: number }> = [];
    for (const [id, stacks] of this.taken) {
      const card = CARDS_BY_ID.get(id);
      if (card) out.push({ card, stacks });
    }
    return out.sort((a, b) => RARITY[b.card.rarity].weight - RARITY[a.card.rarity].weight);
  }

  private isAvailable(card: SkillCard, context: SkillContext): boolean {
    if (!card.enabled) return false;
    if (!this.gate.has('card', card.id)) return false;
    if (this.takenCount(card.id) >= card.maxStacks) return false;
    if (card.requires && !card.requires(context)) return false;
    return true;
  }

  /**
   * @param luck extra weight pushed toward higher rarities, 0..1
   */
  /**
   * @param luck      extra weight pushed toward higher rarities, 0..1
   * @param minRarity floor on what may be offered. Cursed altars use it: paying a
   *                  permanent debuff for a common card would be a bad joke.
   */
  draw(count: number, context: SkillContext, luck = 0, minRarity?: Rarity): SkillCard[] {
    const floor = minRarity ? RARITY_ORDER.indexOf(minRarity) : 0;
    let available = SKILL_CARDS.filter(
      (c) => this.isAvailable(c, context) && RARITY_ORDER.indexOf(c.rarity) >= floor,
    );
    // Nothing left at that tier: fall back rather than return an empty offer.
    if (available.length < count) {
      available = SKILL_CARDS.filter((c) => this.isAvailable(c, context));
    }
    if (available.length === 0) return [];

    // Depth and luck bend the rarity curve upward without ever guaranteeing a hit.
    const depthBonus = Math.min(1.6, context.depth * 0.09) + luck;
    const rarityBoost: Record<Rarity, number> = {
      common: 1,
      rare: 1 + depthBonus * 0.55,
      epic: 1 + depthBonus * 1.1,
      legendary: 1 + depthBonus * 1.8,
    };

    const picks: SkillCard[] = [];
    const pool = available.slice();

    for (let i = 0; i < count && pool.length > 0; i++) {
      const chosen = this.rng.pickWeighted(pool, (card) => {
        const stacks = this.takenCount(card.id);
        // Diminishing weight per stack keeps one card from dominating a run.
        const stackPenalty = Math.pow(0.62, stacks);
        return RARITY[card.rarity].weight * rarityBoost[card.rarity] * (card.weight ?? 1) * stackPenalty;
      });

      picks.push(chosen);
      this.seen.add(chosen.id);
      pool.splice(pool.indexOf(chosen), 1);
    }

    return picks;
  }

  /** Record a card as taken and apply it to the sheet. */
  acquire(card: SkillCard, stats: StatSheet): void {
    const stacks = this.takenCount(card.id) + 1;
    this.taken.set(card.id, stacks);

    if (card.modifiers) {
      stats.addModifiers(
        card.modifiers.map((m) => ({
          key: m.key,
          flat: m.flat,
          mult: m.mult,
          source: card.id,
        })),
      );
    }

    for (const behavior of card.behaviors ?? []) stats.addBehavior(behavior);
  }
}
