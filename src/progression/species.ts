import { t } from '../i18n';
import { createBaseBody, type MonsterBody } from './evolution';
import { type BehaviorFlag, type StatKey } from './stats';

/**
 * A starting body.
 *
 * The choice is made once, in the lair, before a run — not mid-run like a card. It
 * decides the shape of the whole run rather than tuning it: how far you fight from,
 * how much punishment you can eat, and what the creature actually looks like.
 *
 * Species change *base* stats, never modifiers. A base change compounds correctly
 * with every percentage the run layers on top, so a fast body stays fast after ten
 * cards instead of being drowned out by them.
 */
export interface Species {
  readonly id: string;
  readonly name: string;
  /** One line on how it plays, shown under the name. */
  readonly tagline: string;
  readonly description: string;
  /** Base stat overrides. Everything unlisted keeps `BASE_STATS`. */
  readonly stats: Partial<Record<StatKey, number>>;
  /** Body overrides on top of `createBaseBody()`. */
  readonly body: Partial<MonsterBody>;
  /** Behaviours the body has from the first room. */
  readonly behaviors?: readonly BehaviorFlag[];
  /** Souls to unlock. Zero means it is available on a fresh profile. */
  readonly price: number;
}

export const SPECIES: readonly Species[] = [
  {
    id: 'spawn',
    get name() { return t('species.spawn.name'); },
    get tagline() { return t('species.spawn.tag'); },
    get description() { return t('species.spawn.desc'); },
    stats: {},
    body: {},
    price: 0,
  },
  {
    id: 'stalker',
    get name() { return t('species.stalker.name'); },
    get tagline() { return t('species.stalker.tag'); },
    get description() { return t('species.stalker.desc'); },
    // Fragile and quick: two dashes make positioning the answer to everything, and
    // the short range forces you to take the risk of standing close.
    stats: {
      maxHp: 98,
      moveSpeed: 248,
      dashCharges: 2,
      dashCooldown: 2.3,
      dashDistance: 170,
      damage: 14,
      attackSpeed: 2.15,
      critChance: 0.12,
      range: 340,
      spread: 0.045,
      pickupRadius: 150,
    },
    body: {
      coreRadius: 17,
      lobes: 6,
      limbs: 6,
      tails: 2,
      maw: 0.26,
      bulk: 0.92,
      bodyColor: '#1d2130',
      accentColor: '#2c4a63',
      glowColor: '#69c9e8',
      glowStrength: 0.55,
    },
    price: 0,
  },
  {
    id: 'behemoth',
    get name() { return t('species.behemoth.name'); },
    get tagline() { return t('species.behemoth.tag'); },
    get description() { return t('species.behemoth.desc'); },
    // Slow, armoured, and hits like a collapsing wall. Rooms are won by walking
    // through the line rather than around it.
    stats: {
      maxHp: 180,
      armor: 14,
      moveSpeed: 174,
      dashDistance: 118,
      dashCooldown: 3.6,
      damage: 27,
      attackSpeed: 1.15,
      knockback: 130,
      projectileSize: 1.35,
      areaSize: 1.15,
      healingReceived: 1.2,
    },
    body: {
      coreRadius: 24,
      lobes: 9,
      horns: 2,
      spikes: 6,
      limbs: 4,
      maw: 0.4,
      bulk: 1.16,
      bodyColor: '#332720',
      accentColor: '#6b4630',
      glowColor: '#e0813c',
      glowStrength: 0.45,
    },
    price: 130,
  },
  {
    id: 'harbinger',
    get name() { return t('species.harbinger.name'); },
    get tagline() { return t('species.harbinger.tag'); },
    get description() { return t('species.harbinger.desc'); },
    // Two weak unholy bolts instead of one solid hit. Wide spread means the pair
    // only both land up close, so it wants range against crowds and nerve against
    // anything armoured.
    stats: {
      maxHp: 112,
      moveSpeed: 202,
      damage: 12,
      attackSpeed: 1.6,
      projectiles: 2,
      spread: 0.09,
      projectileSpeed: 700,
      range: 480,
      convUnholy: 0.5,
      resHoly: 0.2,
      statusPower: 1.2,
      soulGain: 1.15,
    },
    body: {
      coreRadius: 19,
      lobes: 8,
      eyes: 4,
      wings: 2,
      tails: 2,
      maw: 0.24,
      bodyColor: '#241a33',
      accentColor: '#4a2a63',
      glowColor: '#b072ff',
      glowStrength: 0.8,
      aura: 'void',
    },
    price: 170,
  },
];

export const DEFAULT_SPECIES_ID = 'spawn';

const BY_ID = new Map(SPECIES.map((s) => [s.id, s]));

export function getSpecies(id: string): Species | undefined {
  return BY_ID.get(id);
}

/** The chosen species, falling back to the starter if the id is unknown or locked. */
export function resolveSpecies(id: string): Species {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_SPECIES_ID)!;
}

/** A fresh body for this species: the base description with its overrides applied. */
export function speciesBody(species: Species): MonsterBody {
  return { ...createBaseBody(), ...species.body };
}
