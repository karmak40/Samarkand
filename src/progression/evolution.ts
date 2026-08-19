import { RNG } from '../core/rng';
import { t } from '../i18n';
import { type BehaviorFlag, type StatSheet } from './stats';
import { type RawModifier } from './skills';
import { type ContentGate, OPEN_GATE } from './gate';

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
    get name() { return t('mutation.abyssal-maw.name'); },
    get description() { return t('mutation.abyssal-maw.description'); },
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
    get name() { return t('mutation.bone-crown.name'); },
    get description() { return t('mutation.bone-crown.description'); },
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
    get name() { return t('mutation.dark-wings.name'); },
    get description() { return t('mutation.dark-wings.description'); },
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
    get name() { return t('mutation.many-eyes.name'); },
    get description() { return t('mutation.many-eyes.description'); },
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
    get name() { return t('mutation.spine-ridge.name'); },
    get description() { return t('mutation.spine-ridge.description'); },
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
    get name() { return t('mutation.lash-tails.name'); },
    get description() { return t('mutation.lash-tails.description'); },
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
    get name() { return t('mutation.extra-limbs.name'); },
    get description() { return t('mutation.extra-limbs.description'); },
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
    get name() { return t('mutation.bloated-mass.name'); },
    get description() { return t('mutation.bloated-mass.description'); },
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
    get name() { return t('mutation.hound-form.name'); },
    get description() { return t('mutation.hound-form.description'); },
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
    get name() { return t('mutation.magma-core.name'); },
    get description() { return t('mutation.magma-core.description'); },
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
    get name() { return t('mutation.rime-shell.name'); },
    get description() { return t('mutation.rime-shell.description'); },
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
    get name() { return t('mutation.plague-sac.name'); },
    get description() { return t('mutation.plague-sac.description'); },
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
    get name() { return t('mutation.storm-heart.name'); },
    get description() { return t('mutation.storm-heart.description'); },
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
    get name() { return t('mutation.void-gut.name'); },
    get description() { return t('mutation.void-gut.description'); },
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

/**
 * Rooms at which an evolution choice is offered. Every 4th room, symmetric across
 * both biomes — including each one's boss, so the war-camp's ending gets the same
 * flourish the first biome's did.
 */
export const EVOLUTION_ROOMS = [3, 7, 11, 15, 19, 23] as const;

export function isEvolutionRoom(roomIndex: number): boolean {
  return (EVOLUTION_ROOMS as readonly number[]).includes(roomIndex);
}

/** Draw distinct mutation offers, never repeating one already taken. */
export function drawMutations(
  rng: RNG,
  taken: ReadonlySet<string>,
  stats: StatSheet,
  count = 3,
  gate: ContentGate = OPEN_GATE,
): Mutation[] {
  const pool = MUTATIONS.filter(
    (m) => !taken.has(m.id) && gate.has('mutation', m.id) && (!m.requires || m.requires(stats)),
  );
  return rng.sample(pool, count);
}
