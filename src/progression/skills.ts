import { RNG } from '../core/rng';
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
  common: { name: 'Обычный', color: '#b9b2a2', glow: '#e8e2d4', weight: 100 },
  rare: { name: 'Редкий', color: '#5ea8d8', glow: '#a8dcff', weight: 42 },
  epic: { name: 'Эпический', color: '#a774e0', glow: '#dcbcff', weight: 14 },
  legendary: { name: 'Легендарный', color: '#d8a13a', glow: '#ffe28a', weight: 3.5 },
};

export type SkillTag =
  | 'урон'
  | 'защита'
  | 'скорость'
  | 'снаряды'
  | 'огонь'
  | 'яд'
  | 'мороз'
  | 'молния'
  | 'скверна'
  | 'крит'
  | 'вампиризм'
  | 'разрушение'
  | 'страх';

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
    name: 'Клыки',
    rarity: 'common',
    description: '+20% урона.',
    tags: ['урон'],
    maxStacks: 6,
    modifiers: [{ key: 'damage', mult: 0.2 }],
  },
  {
    id: 'sinew',
    name: 'Жилистые лапы',
    rarity: 'common',
    description: '+10% скорости передвижения.',
    tags: ['скорость'],
    maxStacks: 5,
    modifiers: [{ key: 'moveSpeed', mult: 0.1 }],
  },
  {
    id: 'thick-hide',
    name: 'Толстая шкура',
    rarity: 'common',
    description: '+30 к максимуму здоровья.',
    tags: ['защита'],
    maxStacks: 6,
    modifiers: [{ key: 'maxHp', flat: 30 }],
  },
  {
    id: 'frenzy',
    name: 'Исступление',
    rarity: 'common',
    description: '+15% скорости атаки.',
    tags: ['скорость', 'урон'],
    maxStacks: 6,
    modifiers: [{ key: 'attackSpeed', mult: 0.15 }],
  },
  {
    id: 'long-reach',
    name: 'Дальний бросок',
    rarity: 'common',
    description: '+15% дальности и +12% скорости снарядов.',
    tags: ['снаряды'],
    maxStacks: 4,
    modifiers: [
      { key: 'range', mult: 0.15 },
      { key: 'projectileSpeed', mult: 0.12 },
    ],
  },
  {
    id: 'bone-plates',
    name: 'Костяные пластины',
    rarity: 'common',
    description: '+12 брони.',
    tags: ['защита'],
    maxStacks: 5,
    modifiers: [{ key: 'armor', flat: 12 }],
  },
  {
    id: 'predator-eye',
    name: 'Глаз хищника',
    rarity: 'common',
    description: '+8% шанса крита.',
    tags: ['крит'],
    maxStacks: 5,
    modifiers: [{ key: 'critChance', flat: 0.08 }],
  },
  {
    id: 'bloodthirst',
    name: 'Жажда крови',
    rarity: 'common',
    description: '+4% вампиризма.',
    tags: ['вампиризм'],
    maxStacks: 5,
    modifiers: [{ key: 'lifesteal', flat: 0.04 }],
  },
  {
    id: 'heavy-paw',
    name: 'Тяжёлая длань',
    rarity: 'common',
    description: '+50% отбрасывания и +10% урона.',
    tags: ['урон'],
    maxStacks: 3,
    modifiers: [
      { key: 'knockback', mult: 0.5 },
      { key: 'damage', mult: 0.1 },
    ],
  },
  {
    id: 'regrowth',
    name: 'Регенерация',
    rarity: 'common',
    description: '+1.5 здоровья в секунду.',
    tags: ['защита'],
    maxStacks: 5,
    modifiers: [{ key: 'hpRegen', flat: 1.5 }],
  },
  {
    id: 'wide-gullet',
    name: 'Широкая пасть',
    rarity: 'common',
    description: '+50% радиуса подбора и +20% добычи душ.',
    tags: ['скорость'],
    maxStacks: 3,
    modifiers: [
      { key: 'pickupRadius', mult: 0.5 },
      { key: 'soulGain', mult: 0.2 },
    ],
  },
  {
    id: 'nimble',
    name: 'Скользкая тень',
    rarity: 'common',
    description: '+7% уклонения.',
    tags: ['защита'],
    maxStacks: 4,
    modifiers: [{ key: 'dodge', flat: 0.07 }],
  },

  // ---- rare ----------------------------------------------------------------
  {
    id: 'split-spit',
    name: 'Раздвоенный плевок',
    rarity: 'rare',
    description: '+1 снаряд, но -12% урона каждого.',
    tags: ['снаряды'],
    maxStacks: 5,
    modifiers: [
      { key: 'projectiles', flat: 1 },
      { key: 'damage', mult: -0.12 },
    ],
  },
  {
    id: 'piercing',
    name: 'Пронзающий коготь',
    rarity: 'rare',
    description: 'Снаряды пробивают ещё одну цель.',
    tags: ['снаряды'],
    maxStacks: 4,
    modifiers: [{ key: 'pierce', flat: 1 }],
  },
  {
    id: 'ricochet',
    name: 'Рикошет',
    rarity: 'rare',
    description: 'Снаряды отскакивают в новую цель (+1 отскок).',
    tags: ['снаряды'],
    maxStacks: 3,
    modifiers: [{ key: 'bounce', flat: 1 }],
    behaviors: ['ricochet'],
  },
  {
    id: 'hunting-instinct',
    name: 'Охотничий инстинкт',
    rarity: 'rare',
    description: 'Снаряды слегка наводятся на цель.',
    tags: ['снаряды'],
    maxStacks: 3,
    behaviors: ['homing'],
  },
  {
    id: 'burning-blood',
    name: 'Пылающая кровь',
    rarity: 'rare',
    description: '+30% базового урона добавляется огнём. Поджигает.',
    tags: ['огонь', 'урон'],
    maxStacks: 4,
    modifiers: [{ key: 'convFire', flat: 0.3 }],
  },
  {
    id: 'venom-glands',
    name: 'Ядовитые железы',
    rarity: 'rare',
    description: '+30% базового урона добавляется ядом. Отравляет.',
    tags: ['яд', 'урон'],
    maxStacks: 4,
    modifiers: [{ key: 'convPoison', flat: 0.3 }],
  },
  {
    id: 'frost-breath',
    name: 'Морозное дыхание',
    rarity: 'rare',
    description: '+25% базового урона морозом. Замедляет и в итоге замораживает.',
    tags: ['мороз', 'урон'],
    maxStacks: 4,
    modifiers: [{ key: 'convFrost', flat: 0.25 }],
  },
  {
    id: 'storm-hide',
    name: 'Грозовая шкура',
    rarity: 'rare',
    description: '+25% базового урона молнией. Накладывает разряд.',
    tags: ['молния', 'урон'],
    maxStacks: 4,
    modifiers: [{ key: 'convLightning', flat: 0.25 }],
  },
  {
    id: 'blight-seal',
    name: 'Печать скверны',
    rarity: 'rare',
    description: '+25% базового урона скверной. Проклинает цель.',
    tags: ['скверна', 'урон'],
    maxStacks: 4,
    modifiers: [{ key: 'convUnholy', flat: 0.25 }],
    behaviors: ['curseOnHit'],
  },
  {
    id: 'shadow-step',
    name: 'Шаг тени',
    rarity: 'rare',
    description: '+1 заряд рывка и -25% отката.',
    tags: ['скорость'],
    maxStacks: 3,
    modifiers: [
      { key: 'dashCharges', flat: 1 },
      { key: 'dashCooldown', mult: -0.25 },
    ],
  },
  {
    id: 'killer-focus',
    name: 'Взгляд убийцы',
    rarity: 'rare',
    description: '+30% силы крита и +6% шанса.',
    tags: ['крит'],
    maxStacks: 4,
    modifiers: [
      { key: 'critDamage', flat: 0.3 },
      { key: 'critChance', flat: 0.06 },
    ],
  },
  {
    id: 'armor-shred',
    name: 'Дробящие когти',
    rarity: 'rare',
    description: '+25% пробития брони.',
    tags: ['урон'],
    maxStacks: 3,
    modifiers: [{ key: 'armorPen', flat: 0.25 }],
  },
  {
    id: 'devour',
    name: 'Пожиратель',
    rarity: 'rare',
    description: 'Убитые оставляют больше крови, лечение усилено на 40%.',
    tags: ['вампиризм'],
    maxStacks: 2,
    modifiers: [{ key: 'healingReceived', mult: 0.4 }],
    behaviors: ['devourCorpses'],
  },
  {
    id: 'dread-roar',
    name: 'Устрашающий рёв',
    rarity: 'rare',
    description: 'Убийство вселяет ужас в тех, кто это видел.',
    tags: ['страх'],
    maxStacks: 1,
    behaviors: ['fearOnKill'],
  },
  {
    id: 'potent-venoms',
    name: 'Концентрат',
    rarity: 'rare',
    description: '+40% силы и +30% длительности всех эффектов.',
    tags: ['яд', 'огонь'],
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
    name: 'Разрыв плоти',
    rarity: 'epic',
    description: 'Убитые взрываются, задевая всех рядом.',
    tags: ['урон', 'разрушение'],
    maxStacks: 3,
    behaviors: ['explodeOnKill'],
  },
  {
    id: 'chain-storm',
    name: 'Цепная гроза',
    rarity: 'epic',
    description: 'Удары молнией перескакивают на 2 соседние цели.',
    tags: ['молния'],
    maxStacks: 3,
    behaviors: ['chainLightning'],
    requires: (c) => c.stats.get('convLightning') > 0,
  },
  {
    id: 'plague-cloud',
    name: 'Чумное облако',
    rarity: 'epic',
    description: 'Убитые оставляют облако яда.',
    tags: ['яд'],
    maxStacks: 2,
    behaviors: ['poisonCloud'],
    requires: (c) => c.stats.get('convPoison') > 0,
  },
  {
    id: 'scorched-earth',
    name: 'Выжженная земля',
    rarity: 'epic',
    description: 'Снаряды оставляют горящие лужи.',
    tags: ['огонь'],
    maxStacks: 2,
    behaviors: ['burningGround'],
    requires: (c) => c.stats.get('convFire') > 0,
  },
  {
    id: 'frost-nova',
    name: 'Ледяная вспышка',
    rarity: 'epic',
    description: 'Рывок вымораживает всё вокруг.',
    tags: ['мороз'],
    maxStacks: 2,
    behaviors: ['frostNova'],
  },
  {
    id: 'brood',
    name: 'Выводок',
    rarity: 'epic',
    description: 'Вокруг тебя кружат сгустки скверны, бьющие всё, чего касаются.',
    tags: ['урон', 'скверна'],
    maxStacks: 3,
    behaviors: ['orbitingSpawn'],
  },
  {
    id: 'berserk',
    name: 'Берсерк',
    rarity: 'epic',
    description: 'До +80% урона тем сильнее, чем меньше твоё здоровье.',
    tags: ['урон'],
    maxStacks: 2,
    behaviors: ['rageAtLowHp'],
  },
  {
    id: 'execute',
    name: 'Добивание',
    rarity: 'epic',
    description: 'Мгновенно убивает врагов ниже 12% здоровья.',
    tags: ['урон'],
    maxStacks: 3,
    modifiers: [{ key: 'executeThreshold', flat: 0.12 }],
    behaviors: ['executeWeak'],
  },
  {
    id: 'hemorrhage',
    name: 'Кровопускание',
    rarity: 'epic',
    description: 'Криты вызывают сильное кровотечение.',
    tags: ['крит', 'урон'],
    maxStacks: 2,
    behaviors: ['bleedOnCrit'],
  },
  {
    id: 'second-wind',
    name: 'Второе дыхание',
    rarity: 'epic',
    description: 'Раз за комнату переживаешь смертельный удар с 25% здоровья.',
    tags: ['защита'],
    maxStacks: 1,
    behaviors: ['secondWind'],
  },
  {
    id: 'iron-carapace',
    name: 'Железный панцирь',
    rarity: 'epic',
    description: '+30 брони, шипы отражают 25% полученного урона.',
    tags: ['защита'],
    maxStacks: 2,
    modifiers: [
      { key: 'armor', flat: 30 },
      { key: 'thorns', flat: 0.25 },
    ],
  },

  // ---- legendary -----------------------------------------------------------
  {
    id: 'razer',
    name: 'Разрушитель',
    rarity: 'legendary',
    description: 'Снаряды сносят постройки. Каждое разрушенное здание даёт +2% урона до конца забега.',
    tags: ['разрушение'],
    maxStacks: 1,
    behaviors: ['razeBuildings'],
  },
  {
    id: 'terror-aura',
    name: 'Аура ужаса',
    rarity: 'legendary',
    description: 'Слабые враги рядом с тобой постоянно в панике.',
    tags: ['страх'],
    maxStacks: 1,
    behaviors: ['terrorAura'],
  },
  {
    id: 'glass-cannon',
    name: 'Хрупкая ярость',
    rarity: 'legendary',
    description: '+90% урона, но -45% максимального здоровья.',
    tags: ['урон'],
    maxStacks: 1,
    modifiers: [
      { key: 'damage', mult: 0.9 },
      { key: 'maxHp', mult: -0.45 },
    ],
    behaviors: ['glassCannon'],
  },
  {
    id: 'soul-harvest',
    name: 'Жатва душ',
    rarity: 'legendary',
    description: 'Каждая душа лечит и ненадолго ускоряет атаку.',
    tags: ['вампиризм'],
    maxStacks: 1,
    behaviors: ['soulHarvest'],
  },
  {
    id: 'death-blossom',
    name: 'Смертный цвет',
    rarity: 'legendary',
    description: 'Каждое убийство выпускает веер снарядов во все стороны.',
    tags: ['снаряды', 'урон'],
    maxStacks: 1,
    behaviors: ['deathBlossom'],
  },
  {
    id: 'volcano-heart',
    name: 'Сердце вулкана',
    rarity: 'legendary',
    description: '+60% урона огнём, и всё вокруг тебя медленно тлеет.',
    tags: ['огонь'],
    maxStacks: 1,
    modifiers: [{ key: 'dmgFire', flat: 0.6 }],
    behaviors: ['burningGround'],
    requires: (c) => c.stats.get('convFire') > 0,
  },
];

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

  constructor(private readonly rng: RNG) {}

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
    if (this.takenCount(card.id) >= card.maxStacks) return false;
    if (card.requires && !card.requires(context)) return false;
    return true;
  }

  /**
   * @param luck extra weight pushed toward higher rarities, 0..1
   */
  draw(count: number, context: SkillContext, luck = 0): SkillCard[] {
    const available = SKILL_CARDS.filter((c) => this.isAvailable(c, context));
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
          source: card.name,
        })),
      );
    }

    for (const behavior of card.behaviors ?? []) stats.addBehavior(behavior);
  }
}
