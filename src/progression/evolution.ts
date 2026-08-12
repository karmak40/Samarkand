import { RNG } from '../core/rng';
import { type BehaviorFlag, type StatSheet } from './stats';
import { type RawModifier } from './skills';

export type AuraKind = 'none' | 'fire' | 'frost' | 'poison' | 'storm' | 'void';

/**
 * The monster's physical description.
 *
 * The renderer draws entirely from this struct, so a mutation that adds horns
 * genuinely changes the silhouette — there are no sprites to keep in sync.
 */
export interface MonsterBody {
  /** Base body radius before bulk. */
  coreRadius: number;
  /** Number of lobes in the blob outline; more = lumpier, more grotesque. */
  lobes: number;
  eyes: number;
  horns: number;
  spikes: number;
  tails: number;
  wings: number;
  /** Ambulatory tendrils. */
  limbs: number;
  /** 0..1 — how much of the body is taken up by the maw. */
  maw: number;
  bulk: number;
  bodyColor: string;
  accentColor: string;
  glowColor: string;
  glowStrength: number;
  aura: AuraKind;
  /** Whole-body opacity. Temporary forms use it to go spectral. */
  alpha: number;
}

/** Deep-ish copy. The body holds only primitives, so a spread is enough. */
export function cloneBody(body: MonsterBody): MonsterBody {
  return { ...body };
}

export function createBaseBody(): MonsterBody {
  return {
    coreRadius: 20,
    lobes: 7,
    eyes: 2,
    horns: 0,
    spikes: 0,
    tails: 1,
    wings: 0,
    limbs: 4,
    maw: 0.32,
    bulk: 1,
    bodyColor: '#2b1f2e',
    accentColor: '#5c2740',
    glowColor: '#c0343c',
    glowStrength: 0.5,
    aura: 'none',
    alpha: 1,
  };
}

export interface Mutation {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Which evolution step this belongs to; 0 means "any". */
  readonly tier: number;
  readonly modifiers?: readonly RawModifier[];
  readonly behaviors?: readonly BehaviorFlag[];
  readonly mutate: (body: MonsterBody) => void;
  /** Only offered when this returns true. */
  readonly requires?: (stats: StatSheet) => boolean;
}

export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'abyssal-maw',
    name: 'Пасть бездны',
    description: 'Пасть раскрывается почти на всё тело. +30% урона, +6% вампиризма.',
    tier: 0,
    modifiers: [
      { key: 'damage', mult: 0.3 },
      { key: 'lifesteal', flat: 0.06 },
    ],
    mutate: (b) => {
      b.maw = Math.min(0.72, b.maw + 0.2);
      b.lobes += 1;
      b.accentColor = '#7a1f2b';
    },
  },
  {
    id: 'bone-crown',
    name: 'Костяной венец',
    description: 'Рога прорывают череп. +25 брони, +60% отбрасывания.',
    tier: 0,
    modifiers: [
      { key: 'armor', flat: 25 },
      { key: 'knockback', mult: 0.6 },
    ],
    mutate: (b) => {
      b.horns += 2;
      b.coreRadius += 1;
    },
  },
  {
    id: 'dark-wings',
    name: 'Крылья тьмы',
    description: 'Перепончатые крылья. +18% скорости, +1 заряд рывка.',
    tier: 0,
    modifiers: [
      { key: 'moveSpeed', mult: 0.18 },
      { key: 'dashCharges', flat: 1 },
      { key: 'dashDistance', mult: 0.2 },
    ],
    mutate: (b) => {
      b.wings += 2;
    },
  },
  {
    id: 'many-eyes',
    name: 'Многоглазие',
    description: 'Глаза покрывают тело. +12% крита, +20% дальности.',
    tier: 0,
    modifiers: [
      { key: 'critChance', flat: 0.12 },
      { key: 'range', mult: 0.2 },
    ],
    mutate: (b) => {
      b.eyes += 4;
      b.glowStrength += 0.2;
    },
  },
  {
    id: 'spine-ridge',
    name: 'Хребет шипов',
    description: 'Костяные шипы вдоль спины. Отражает 30% урона, +15 брони.',
    tier: 0,
    modifiers: [
      { key: 'thorns', flat: 0.3 },
      { key: 'armor', flat: 15 },
    ],
    mutate: (b) => {
      b.spikes += 7;
    },
  },
  {
    id: 'lash-tails',
    name: 'Хвосты-плети',
    description: 'Отрастают два хвоста. +1 снаряд, +10% скорости атаки.',
    tier: 0,
    modifiers: [
      { key: 'projectiles', flat: 1 },
      { key: 'attackSpeed', mult: 0.1 },
    ],
    mutate: (b) => {
      b.tails += 2;
    },
  },
  {
    id: 'extra-limbs',
    name: 'Лишние конечности',
    description: 'Ещё четыре лапы. +12% скорости атаки и передвижения.',
    tier: 0,
    modifiers: [
      { key: 'attackSpeed', mult: 0.12 },
      { key: 'moveSpeed', mult: 0.12 },
    ],
    mutate: (b) => {
      b.limbs += 4;
    },
  },
  {
    id: 'bloated-mass',
    name: 'Разбухшая туша',
    description: 'Тело раздувается. +90 здоровья и +20 брони, но -12% скорости.',
    tier: 0,
    modifiers: [
      { key: 'maxHp', flat: 90 },
      { key: 'armor', flat: 20 },
      { key: 'moveSpeed', mult: -0.12 },
    ],
    mutate: (b) => {
      b.bulk += 0.28;
      b.lobes += 2;
    },
  },
  {
    id: 'hound-form',
    name: 'Гончая форма',
    description: 'Тело вытягивается и худеет. +22% скорости, +18% атаки, -30 здоровья.',
    tier: 0,
    modifiers: [
      { key: 'moveSpeed', mult: 0.22 },
      { key: 'attackSpeed', mult: 0.18 },
      { key: 'maxHp', flat: -30 },
    ],
    mutate: (b) => {
      b.bulk = Math.max(0.7, b.bulk - 0.18);
      b.limbs += 2;
    },
  },

  // ---- elemental cores (mutually exclusive in practice) --------------------
  {
    id: 'magma-core',
    name: 'Магмовое ядро',
    description: 'Внутри тлеет вулкан. +35% урона огнём и поджиг всего вокруг.',
    tier: 0,
    modifiers: [
      { key: 'convFire', flat: 0.25 },
      { key: 'dmgFire', flat: 0.35 },
    ],
    behaviors: ['burningGround'],
    mutate: (b) => {
      b.aura = 'fire';
      b.glowColor = '#ff7b31';
      b.accentColor = '#8a3417';
      b.glowStrength += 0.35;
    },
  },
  {
    id: 'rime-shell',
    name: 'Ледяной панцирь',
    description: 'Кожа покрывается инеем. +25% урона морозом, +20 брони, ледяная вспышка при рывке.',
    tier: 0,
    modifiers: [
      { key: 'convFrost', flat: 0.25 },
      { key: 'dmgFrost', flat: 0.25 },
      { key: 'armor', flat: 20 },
    ],
    behaviors: ['frostNova'],
    mutate: (b) => {
      b.aura = 'frost';
      b.glowColor = '#6fd0ff';
      b.accentColor = '#274a63';
      b.spikes += 4;
    },
  },
  {
    id: 'plague-sac',
    name: 'Чумной мешок',
    description: 'Раздутые железы. +30% урона ядом, убитые оставляют облако заразы.',
    tier: 0,
    modifiers: [
      { key: 'convPoison', flat: 0.3 },
      { key: 'dmgPoison', flat: 0.3 },
    ],
    behaviors: ['poisonCloud'],
    mutate: (b) => {
      b.aura = 'poison';
      b.glowColor = '#8ed44f';
      b.accentColor = '#3b5c25';
      b.lobes += 2;
      b.bulk += 0.12;
    },
  },
  {
    id: 'storm-heart',
    name: 'Грозовое сердце',
    description: 'В груди бьётся молния. +25% урона молнией, удары бьют по цепи.',
    tier: 0,
    modifiers: [
      { key: 'convLightning', flat: 0.25 },
      { key: 'dmgLightning', flat: 0.3 },
      { key: 'attackSpeed', mult: 0.1 },
    ],
    behaviors: ['chainLightning'],
    mutate: (b) => {
      b.aura = 'storm';
      b.glowColor = '#ffe45c';
      b.accentColor = '#5c5322';
      b.glowStrength += 0.3;
    },
  },
  {
    id: 'void-gut',
    name: 'Пустотное нутро',
    description: 'Внутренности исчезают в пустоте. +30% урона скверной, удары проклинают.',
    tier: 0,
    modifiers: [
      { key: 'convUnholy', flat: 0.3 },
      { key: 'dmgUnholy', flat: 0.3 },
    ],
    behaviors: ['curseOnHit'],
    mutate: (b) => {
      b.aura = 'void';
      b.glowColor = '#b06cff';
      b.accentColor = '#3d1f5c';
      b.eyes += 2;
    },
  },
];

const MUTATIONS_BY_ID = new Map(MUTATIONS.map((m) => [m.id, m]));

export function getMutation(id: string): Mutation | undefined {
  return MUTATIONS_BY_ID.get(id);
}

/** Rooms at which an evolution choice is offered. */
export const EVOLUTION_ROOMS = [3, 7, 11] as const;

export function isEvolutionRoom(roomIndex: number): boolean {
  return (EVOLUTION_ROOMS as readonly number[]).includes(roomIndex);
}

/** Draw distinct mutation offers, never repeating one already taken. */
export function drawMutations(
  rng: RNG,
  taken: ReadonlySet<string>,
  stats: StatSheet,
  count = 3,
): Mutation[] {
  const pool = MUTATIONS.filter((m) => !taken.has(m.id) && (!m.requires || m.requires(stats)));
  return rng.sample(pool, count);
}
