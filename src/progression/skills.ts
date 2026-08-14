import { RNG } from '../core/rng';
import { type ContentGate, OPEN_GATE } from './gate';
import { t } from '../i18n';
import { type BehaviorFlag, type StatKey, type StatSheet } from './stats';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface RarityStyle {
  readonly name: string;
  readonly color: string;
  readonly glow: string;
  /** Base weight in the draw. Modified by run depth. */
  readonly weight: number;
}

export const RARITY: Record<Rarity, RarityStyle> = {
  common: { get name() { return t('rarity.common'); }, color: '#b9b2a2', glow: '#e8e2d4', weight: 100 },
  rare: { get name() { return t('rarity.rare'); }, color: '#5ea8d8', glow: '#a8dcff', weight: 42 },
  epic: { get name() { return t('rarity.epic'); }, color: '#a774e0', glow: '#dcbcff', weight: 14 },
  legendary: { get name() { return t('rarity.legendary'); }, color: '#d8a13a', glow: '#ffe28a', weight: 3.5 },
};

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

/**
 * The card pool.
 *
 * Design rules used throughout:
 *  - commons are pure numbers, always safe to take;
 *  - rares change *how* damage is delivered (elements, projectiles);
 *  - epics add new behaviour that fires on its own;
 *  - legendaries are build-defining and usually carry a real cost.
 */
export const SKILL_CARDS: readonly SkillCard[] = [
  // ---- common --------------------------------------------------------------
  {
    id: 'fangs',
    get name() { return t('skill.fangs.name'); },
    rarity: 'common',
    get description() { return t('skill.fangs.description'); },
    tags: ['damage'],
    maxStacks: 6,
    modifiers: [{ key: 'damage', mult: 0.2 }],
  },
  {
    id: 'sinew',
    get name() { return t('skill.sinew.name'); },
    rarity: 'common',
    get description() { return t('skill.sinew.description'); },
    tags: ['speed'],
    maxStacks: 5,
    modifiers: [{ key: 'moveSpeed', mult: 0.1 }],
  },
  {
    id: 'thick-hide',
    get name() { return t('skill.thick-hide.name'); },
    rarity: 'common',
    get description() { return t('skill.thick-hide.description'); },
    tags: ['defense'],
    maxStacks: 6,
    modifiers: [{ key: 'maxHp', flat: 30 }],
  },
  {
    id: 'frenzy',
    get name() { return t('skill.frenzy.name'); },
    rarity: 'common',
    get description() { return t('skill.frenzy.description'); },
    tags: ['speed', 'damage'],
    maxStacks: 6,
    modifiers: [{ key: 'attackSpeed', mult: 0.15 }],
  },
  {
    id: 'long-reach',
    get name() { return t('skill.long-reach.name'); },
    rarity: 'common',
    get description() { return t('skill.long-reach.description'); },
    tags: ['projectiles'],
    maxStacks: 4,
    modifiers: [
      { key: 'range', mult: 0.15 },
      { key: 'projectileSpeed', mult: 0.12 },
    ],
  },
  {
    id: 'bone-plates',
    get name() { return t('skill.bone-plates.name'); },
    rarity: 'common',
    get description() { return t('skill.bone-plates.description'); },
    tags: ['defense'],
    maxStacks: 5,
    modifiers: [{ key: 'armor', flat: 12 }],
  },
  {
    id: 'predator-eye',
    get name() { return t('skill.predator-eye.name'); },
    rarity: 'common',
    get description() { return t('skill.predator-eye.description'); },
    tags: ['crit'],
    maxStacks: 5,
    modifiers: [{ key: 'critChance', flat: 0.08 }],
  },
  {
    id: 'bloodthirst',
    get name() { return t('skill.bloodthirst.name'); },
    rarity: 'common',
    get description() { return t('skill.bloodthirst.description'); },
    tags: ['lifesteal'],
    maxStacks: 5,
    modifiers: [{ key: 'lifesteal', flat: 0.04 }],
  },
  {
    id: 'heavy-paw',
    get name() { return t('skill.heavy-paw.name'); },
    rarity: 'common',
    get description() { return t('skill.heavy-paw.description'); },
    tags: ['damage'],
    maxStacks: 3,
    modifiers: [
      { key: 'knockback', mult: 0.5 },
      { key: 'damage', mult: 0.1 },
    ],
  },
  {
    id: 'regrowth',
    get name() { return t('skill.regrowth.name'); },
    rarity: 'common',
    get description() { return t('skill.regrowth.description'); },
    tags: ['defense'],
    maxStacks: 5,
    modifiers: [{ key: 'hpRegen', flat: 1.5 }],
  },
  {
    id: 'wide-gullet',
    get name() { return t('skill.wide-gullet.name'); },
    rarity: 'common',
    get description() { return t('skill.wide-gullet.description'); },
    tags: ['speed'],
    maxStacks: 3,
    modifiers: [
      { key: 'pickupRadius', mult: 0.5 },
      { key: 'soulGain', mult: 0.2 },
    ],
  },
  {
    id: 'nimble',
    get name() { return t('skill.nimble.name'); },
    rarity: 'common',
    get description() { return t('skill.nimble.description'); },
    tags: ['defense'],
    maxStacks: 4,
    modifiers: [{ key: 'dodge', flat: 0.07 }],
  },

  // ---- rare ----------------------------------------------------------------
  {
    id: 'split-spit',
    get name() { return t('skill.split-spit.name'); },
    rarity: 'rare',
    get description() { return t('skill.split-spit.description'); },
    tags: ['projectiles'],
    maxStacks: 5,
    modifiers: [
      { key: 'projectiles', flat: 1 },
      { key: 'damage', mult: -0.12 },
    ],
  },
  {
    id: 'piercing',
    get name() { return t('skill.piercing.name'); },
    rarity: 'rare',
    get description() { return t('skill.piercing.description'); },
    tags: ['projectiles'],
    maxStacks: 4,
    modifiers: [{ key: 'pierce', flat: 1 }],
  },
  {
    id: 'ricochet',
    get name() { return t('skill.ricochet.name'); },
    rarity: 'rare',
    get description() { return t('skill.ricochet.description'); },
    tags: ['projectiles'],
    maxStacks: 3,
    modifiers: [{ key: 'bounce', flat: 1 }],
    behaviors: ['ricochet'],
  },
  {
    id: 'hunting-instinct',
    get name() { return t('skill.hunting-instinct.name'); },
    rarity: 'rare',
    get description() { return t('skill.hunting-instinct.description'); },
    tags: ['projectiles'],
    maxStacks: 3,
    behaviors: ['homing'],
  },
  {
    id: 'burning-blood',
    get name() { return t('skill.burning-blood.name'); },
    rarity: 'rare',
    get description() { return t('skill.burning-blood.description'); },
    tags: ['fire', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convFire', flat: 0.3 }],
  },
  {
    id: 'venom-glands',
    get name() { return t('skill.venom-glands.name'); },
    rarity: 'rare',
    get description() { return t('skill.venom-glands.description'); },
    tags: ['poison', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convPoison', flat: 0.3 }],
  },
  {
    id: 'frost-breath',
    get name() { return t('skill.frost-breath.name'); },
    rarity: 'rare',
    get description() { return t('skill.frost-breath.description'); },
    tags: ['frost', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convFrost', flat: 0.25 }],
  },
  {
    id: 'storm-hide',
    get name() { return t('skill.storm-hide.name'); },
    rarity: 'rare',
    get description() { return t('skill.storm-hide.description'); },
    tags: ['lightning', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convLightning', flat: 0.25 }],
  },
  {
    id: 'blight-seal',
    get name() { return t('skill.blight-seal.name'); },
    rarity: 'rare',
    get description() { return t('skill.blight-seal.description'); },
    tags: ['unholy', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convUnholy', flat: 0.25 }],
    behaviors: ['curseOnHit'],
  },
  {
    id: 'shadow-step',
    get name() { return t('skill.shadow-step.name'); },
    rarity: 'rare',
    get description() { return t('skill.shadow-step.description'); },
    tags: ['speed'],
    maxStacks: 3,
    modifiers: [
      { key: 'dashCharges', flat: 1 },
      { key: 'dashCooldown', mult: -0.25 },
    ],
  },
  {
    id: 'killer-focus',
    get name() { return t('skill.killer-focus.name'); },
    rarity: 'rare',
    get description() { return t('skill.killer-focus.description'); },
    tags: ['crit'],
    maxStacks: 4,
    modifiers: [
      { key: 'critDamage', flat: 0.3 },
      { key: 'critChance', flat: 0.06 },
    ],
  },
  {
    id: 'armor-shred',
    get name() { return t('skill.armor-shred.name'); },
    rarity: 'rare',
    get description() { return t('skill.armor-shred.description'); },
    tags: ['damage'],
    maxStacks: 3,
    modifiers: [{ key: 'armorPen', flat: 0.25 }],
  },
  {
    id: 'devour',
    get name() { return t('skill.devour.name'); },
    rarity: 'rare',
    get description() { return t('skill.devour.description'); },
    tags: ['lifesteal'],
    maxStacks: 2,
    modifiers: [{ key: 'healingReceived', mult: 0.4 }],
    behaviors: ['devourCorpses'],
  },
  {
    id: 'dread-roar',
    get name() { return t('skill.dread-roar.name'); },
    rarity: 'rare',
    get description() { return t('skill.dread-roar.description'); },
    tags: ['fear'],
    maxStacks: 1,
    behaviors: ['fearOnKill'],
  },
  {
    id: 'potent-venoms',
    get name() { return t('skill.potent-venoms.name'); },
    rarity: 'rare',
    get description() { return t('skill.potent-venoms.description'); },
    tags: ['poison', 'fire'],
    maxStacks: 3,
    modifiers: [
      { key: 'statusPower', mult: 0.4 },
      { key: 'statusDuration', mult: 0.3 },
    ],
    requires: (c) => c.stats.conversions().length > 0,
  },

  // ---- epic ----------------------------------------------------------------
  {
    id: 'flesh-burst',
    get name() { return t('skill.flesh-burst.name'); },
    rarity: 'epic',
    get description() { return t('skill.flesh-burst.description'); },
    tags: ['damage', 'destruction'],
    maxStacks: 3,
    behaviors: ['explodeOnKill'],
  },
  {
    id: 'chain-storm',
    get name() { return t('skill.chain-storm.name'); },
    rarity: 'epic',
    get description() { return t('skill.chain-storm.description'); },
    tags: ['lightning'],
    maxStacks: 3,
    behaviors: ['chainLightning'],
    requires: (c) => c.stats.get('convLightning') > 0,
  },
  {
    id: 'plague-cloud',
    get name() { return t('skill.plague-cloud.name'); },
    rarity: 'epic',
    get description() { return t('skill.plague-cloud.description'); },
    tags: ['poison'],
    maxStacks: 2,
    behaviors: ['poisonCloud'],
    requires: (c) => c.stats.get('convPoison') > 0,
  },
  {
    id: 'scorched-earth',
    get name() { return t('skill.scorched-earth.name'); },
    rarity: 'epic',
    get description() { return t('skill.scorched-earth.description'); },
    tags: ['fire'],
    maxStacks: 2,
    behaviors: ['burningGround'],
    requires: (c) => c.stats.get('convFire') > 0,
  },
  {
    id: 'frost-nova',
    get name() { return t('skill.frost-nova.name'); },
    rarity: 'epic',
    get description() { return t('skill.frost-nova.description'); },
    tags: ['frost'],
    maxStacks: 2,
    behaviors: ['frostNova'],
  },
  {
    id: 'brood',
    get name() { return t('skill.brood.name'); },
    rarity: 'epic',
    get description() { return t('skill.brood.description'); },
    tags: ['damage', 'unholy'],
    maxStacks: 3,
    behaviors: ['orbitingSpawn'],
  },
  {
    id: 'berserk',
    get name() { return t('skill.berserk.name'); },
    rarity: 'epic',
    get description() { return t('skill.berserk.description'); },
    tags: ['damage'],
    maxStacks: 2,
    behaviors: ['rageAtLowHp'],
  },
  {
    id: 'execute',
    get name() { return t('skill.execute.name'); },
    rarity: 'epic',
    get description() { return t('skill.execute.description'); },
    tags: ['damage'],
    maxStacks: 3,
    modifiers: [{ key: 'executeThreshold', flat: 0.12 }],
    behaviors: ['executeWeak'],
  },
  {
    id: 'hemorrhage',
    get name() { return t('skill.hemorrhage.name'); },
    rarity: 'epic',
    get description() { return t('skill.hemorrhage.description'); },
    tags: ['crit', 'damage'],
    maxStacks: 2,
    behaviors: ['bleedOnCrit'],
  },
  {
    id: 'second-wind',
    get name() { return t('skill.second-wind.name'); },
    rarity: 'epic',
    get description() { return t('skill.second-wind.description'); },
    tags: ['defense'],
    maxStacks: 1,
    behaviors: ['secondWind'],
  },
  {
    id: 'iron-carapace',
    get name() { return t('skill.iron-carapace.name'); },
    rarity: 'epic',
    get description() { return t('skill.iron-carapace.description'); },
    tags: ['defense'],
    maxStacks: 2,
    modifiers: [
      { key: 'armor', flat: 30 },
      { key: 'thorns', flat: 0.25 },
    ],
  },

  // ---- legendary -----------------------------------------------------------
  {
    id: 'razer',
    get name() { return t('skill.razer.name'); },
    rarity: 'legendary',
    get description() { return t('skill.razer.description'); },
    tags: ['destruction'],
    maxStacks: 1,
    behaviors: ['razeBuildings'],
  },
  {
    id: 'terror-aura',
    get name() { return t('skill.terror-aura.name'); },
    rarity: 'legendary',
    get description() { return t('skill.terror-aura.description'); },
    tags: ['fear'],
    maxStacks: 1,
    behaviors: ['terrorAura'],
  },
  {
    id: 'glass-cannon',
    get name() { return t('skill.glass-cannon.name'); },
    rarity: 'legendary',
    get description() { return t('skill.glass-cannon.description'); },
    tags: ['damage'],
    maxStacks: 1,
    modifiers: [
      { key: 'damage', mult: 0.9 },
      { key: 'maxHp', mult: -0.45 },
    ],
    behaviors: ['glassCannon'],
  },
  {
    id: 'soul-harvest',
    get name() { return t('skill.soul-harvest.name'); },
    rarity: 'legendary',
    get description() { return t('skill.soul-harvest.description'); },
    tags: ['lifesteal'],
    maxStacks: 1,
    behaviors: ['soulHarvest'],
  },
  {
    id: 'death-blossom',
    get name() { return t('skill.death-blossom.name'); },
    rarity: 'legendary',
    get description() { return t('skill.death-blossom.description'); },
    tags: ['projectiles', 'damage'],
    maxStacks: 1,
    behaviors: ['deathBlossom'],
  },
  {
    id: 'volcano-heart',
    get name() { return t('skill.volcano-heart.name'); },
    rarity: 'legendary',
    get description() { return t('skill.volcano-heart.description'); },
    tags: ['fire'],
    maxStacks: 1,
    modifiers: [{ key: 'dmgFire', flat: 0.6 }],
    behaviors: ['burningGround'],
    requires: (c) => c.stats.get('convFire') > 0,
  },
];

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
