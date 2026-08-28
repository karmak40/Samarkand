/**
 * Every tunable gameplay number in one place: enemies, buildings, player base
 * stats, species, skills, mutations, boons, curses, statuses, and a handful of
 * scattered formula constants that used to live wherever they were first needed.
 *
 * This file holds *data only* — no classes, no game logic. The systems that act on
 * this data (StatSheet, SkillPool, StatusContainer, Human, Building, roomgen, ...)
 * still live in their own files and simply import their table from here instead of
 * defining it locally, then re-export it so nothing outside this file has to change
 * its import path.
 *
 * `enabled: false` on a skill/mutation/boon/curse/enemy removes it from play without
 * deleting its definition — useful for isolating one system while balancing another.
 * Bosses and mounted-turret units (spawnWeight 0) aren't gated by `enabled` today;
 * they're always reachable through their own fixed placement, not the random pool.
 */

import { type DamagePacket, type DamageType } from './combat/damage';
import { type StatusApplication, type StatusDef, type StatusId } from './combat/status';
import { type HumanArchetype, type HumanId } from './entities/human';
import { type BuildingProfile, type BuildingKind } from './entities/building';
import { type StatKey } from './progression/stats';
import { type Species } from './progression/species';
import { type MonsterBody } from './progression/evolution';
import { type Mutation } from './progression/evolution';
import { type BoonDef } from './progression/boons';
import { type Curse } from './progression/curses';
import { type SkillCard, type RarityStyle, type Rarity, type RawModifier } from './progression/skills';
import { t } from './i18n';

const NO_RESIST: Partial<Record<DamageType, number>> = {};

// ===========================================================================
// Enemies
// ===========================================================================

/** Depth-scaling formulas applied per room tier — see `Human`'s constructor/defenses. */
export const ENEMY_TIER_SCALING = {
  /** +13% HP per room, compounding. */
  hpPerTier: 1.13,
  /** +8% damage per room, compounding. */
  damagePerTier: 1.08,
  /** +6% armor per room, additive. */
  armorPerTier: 0.06,
};

export const HUMAN_ARCHETYPES: Record<HumanId, HumanArchetype> = {
  peasant: {
    id: 'peasant',
    get name() { return t('enemy.peasant.name'); },
    role: 'civilian',
    enabled: true,
    hp: 22,
    armor: 0,
    resist: NO_RESIST,
    speed: 128,
    radius: 10,
    damage: [{ type: 'physical', amount: 3 }],
    attackRange: 26,
    preferredRange: 26,
    attackCooldown: 1.6,
    windup: 0.35,
    recover: 0.4,
    souls: 1,
    knockbackResist: 0.7,
    tunic: '#9a8460',
    accent: '#6f5c3f',
    spawnWeight: 30,
    minDepth: 0,
    bloodChance: 0.18,
    relicChance: 0,
    courage: 0,
  },
  militia: {
    id: 'militia',
    get name() { return t('enemy.militia.name'); },
    role: 'melee',
    enabled: true,
    hp: 52,
    armor: 6,
    resist: NO_RESIST,
    speed: 152,
    radius: 11,
    damage: [{ type: 'physical', amount: 9 }],
    attackRange: 34,
    preferredRange: 34,
    attackCooldown: 1.1,
    windup: 0.32,
    recover: 0.35,
    souls: 2,
    knockbackResist: 1,
    tunic: '#7c6a52',
    accent: '#b4a583',
    spawnWeight: 26,
    minDepth: 0,
    bloodChance: 0.1,
    relicChance: 0,
    courage: 0.5,
  },
  archer: {
    id: 'archer',
    get name() { return t('enemy.archer.name'); },
    role: 'ranged',
    enabled: true,
    hp: 40,
    armor: 2,
    resist: NO_RESIST,
    speed: 146,
    radius: 10,
    damage: [{ type: 'physical', amount: 11 }],
    attackRange: 400,
    preferredRange: 280,
    attackCooldown: 1.7,
    windup: 0.55,
    recover: 0.35,
    souls: 3,
    knockbackResist: 0.9,
    tunic: '#5d6b48',
    accent: '#8a9a68',
    spawnWeight: 20,
    minDepth: 0,
    bloodChance: 0.1,
    relicChance: 0,
    courage: 0.35,
  },
  spearman: {
    id: 'spearman',
    get name() { return t('enemy.spearman.name'); },
    role: 'melee',
    enabled: true,
    hp: 78,
    armor: 14,
    resist: NO_RESIST,
    speed: 138,
    radius: 12,
    damage: [{ type: 'physical', amount: 15 }],
    attackRange: 62,
    preferredRange: 62,
    attackCooldown: 1.4,
    windup: 0.45,
    recover: 0.45,
    souls: 4,
    knockbackResist: 1.4,
    tunic: '#5a5f6b',
    accent: '#9aa3b2',
    spawnWeight: 16,
    minDepth: 1,
    bloodChance: 0.12,
    relicChance: 0.03,
    courage: 0.7,
  },
  crossbowman: {
    id: 'crossbowman',
    get name() { return t('enemy.crossbowman.name'); },
    role: 'ranged',
    enabled: true,
    hp: 54,
    armor: 8,
    resist: NO_RESIST,
    speed: 122,
    radius: 11,
    damage: [{ type: 'physical', amount: 26 }],
    attackRange: 460,
    preferredRange: 330,
    attackCooldown: 2.6,
    windup: 0.9,
    recover: 0.6,
    souls: 5,
    knockbackResist: 1.1,
    tunic: '#4f4a52',
    accent: '#8d8798',
    spawnWeight: 12,
    minDepth: 2,
    bloodChance: 0.12,
    relicChance: 0.05,
    courage: 0.5,
  },
  torchbearer: {
    id: 'torchbearer',
    get name() { return t('enemy.torchbearer.name'); },
    role: 'melee',
    enabled: true,
    hp: 46,
    armor: 2,
    resist: { fire: 0.6 },
    speed: 168,
    radius: 10,
    damage: [
      { type: 'physical', amount: 5 },
      { type: 'fire', amount: 10 },
    ],
    attackRange: 36,
    preferredRange: 36,
    attackCooldown: 1.2,
    windup: 0.3,
    recover: 0.3,
    souls: 4,
    knockbackResist: 0.8,
    tunic: '#7a4a2e',
    accent: '#ff9a3c',
    onHitStatuses: [{ id: 'burn', duration: 4, stacks: 2, power: 2.5, get sourceLabel() { return t('effect.torch'); } }],
    spawnWeight: 14,
    minDepth: 2,
    bloodChance: 0.1,
    relicChance: 0.03,
    courage: 0.6,
  },
  priest: {
    id: 'priest',
    get name() { return t('enemy.priest.name'); },
    role: 'support',
    enabled: true,
    hp: 66,
    armor: 4,
    resist: { unholy: 0.5, holy: 0.9 },
    speed: 126,
    radius: 11,
    damage: [{ type: 'holy', amount: 16 }],
    attackRange: 320,
    preferredRange: 300,
    attackCooldown: 2.2,
    windup: 0.7,
    recover: 0.5,
    souls: 7,
    knockbackResist: 1,
    tunic: '#d8d2c0',
    accent: '#e8c96a',
    spawnWeight: 10,
    minDepth: 3,
    bloodChance: 0.2,
    relicChance: 0.14,
    courage: 0.8,
  },
  knight: {
    id: 'knight',
    get name() { return t('enemy.knight.name'); },
    role: 'melee',
    enabled: true,
    hp: 190,
    armor: 46,
    resist: { physical: 0.15 },
    speed: 132,
    radius: 14,
    damage: [{ type: 'physical', amount: 24 }],
    attackRange: 46,
    preferredRange: 46,
    attackCooldown: 1.5,
    windup: 0.55,
    recover: 0.55,
    souls: 12,
    knockbackResist: 2.6,
    tunic: '#6b7280',
    accent: '#c8cdd6',
    spawnWeight: 8,
    minDepth: 4,
    bloodChance: 0.25,
    relicChance: 0.22,
    courage: 1,
  },
  ballista: {
    id: 'ballista',
    get name() { return t('enemy.ballista.name'); },
    role: 'turret',
    enabled: true,
    hp: 120,
    armor: 20,
    resist: { poison: 0.9, frost: 0.5 },
    speed: 0,
    radius: 16,
    damage: [{ type: 'physical', amount: 38 }],
    // Kept within the camera's visible half-extent (see render/renderer.ts) so a
    // shot never comes from off-screen — a stationary unit that can't be seen
    // coming reads as unfair, not as a threat worth respecting.
    attackRange: 440,
    preferredRange: 440,
    attackCooldown: 3.2,
    windup: 1.2,
    recover: 0.8,
    souls: 9,
    knockbackResist: 99,
    tunic: '#5c4c38',
    accent: '#8d7a5c',
    spawnWeight: 0,
    minDepth: 4,
    bloodChance: 0,
    relicChance: 0.08,
    courage: 1,
  },

  /**
   * The Rider: a war-camp charger.
   *
   * No new AI — it is a melee unit whose speed alone changes the fight, closing
   * from far outside the range any infantry could threaten from. Tuned to trip the
   * stalemate-breaking charge much sooner than anything else in the roster (see
   * `Human.update()`), so it reads as committing to a run at you rather than
   * shuffling into position like everyone else.
   */
  rider: {
    id: 'rider',
    get name() { return t('enemy.rider.name'); },
    role: 'melee',
    enabled: true,
    hp: 70,
    armor: 8,
    resist: NO_RESIST,
    speed: 250,
    radius: 13,
    damage: [{ type: 'physical', amount: 22 }],
    attackRange: 50,
    preferredRange: 50,
    attackCooldown: 1.3,
    windup: 0.35,
    recover: 0.5,
    souls: 6,
    knockbackResist: 1.6,
    tunic: '#8a5a2e',
    accent: '#c9a227',
    spawnWeight: 16,
    minDepth: 0,
    minBiome: 2,
    bloodChance: 0.15,
    relicChance: 0.08,
    courage: 0.9,
  },

  /**
   * The Siege Engine: a stronger ballista fielded only by a stronghold.
   *
   * Placed the same way a watchtower fields its ballista — see `roomgen`'s
   * `planSpawns` — just paired with the bigger structure instead, and hitting
   * harder to match.
   */
  siegeEngine: {
    id: 'siegeEngine',
    get name() { return t('enemy.siegeEngine.name'); },
    role: 'turret',
    enabled: true,
    hp: 160,
    armor: 26,
    resist: { poison: 0.9, frost: 0.5 },
    speed: 0,
    radius: 18,
    damage: [{ type: 'physical', amount: 44 }],
    // See ballista's attackRange comment above — same reasoning, tuned slightly
    // higher since this one is meant to hit harder from the stronger structure.
    attackRange: 480,
    preferredRange: 480,
    attackCooldown: 3,
    windup: 1.1,
    recover: 0.7,
    souls: 11,
    knockbackResist: 99,
    tunic: '#7a5c3a',
    accent: '#c9a25c',
    spawnWeight: 0,
    minDepth: 0,
    minBiome: 2,
    bloodChance: 0,
    relicChance: 0.1,
    courage: 1,
  },

  inquisitor: {
    id: 'inquisitor',
    get name() { return t('enemy.inquisitor.name'); },
    role: 'boss',
    enabled: true,
    hp: 1400,
    armor: 40,
    resist: { holy: 0.9, unholy: 0.35, fire: 0.2 },
    speed: 118,
    radius: 22,
    damage: [{ type: 'holy', amount: 30 }],
    attackRange: 380,
    preferredRange: 240,
    attackCooldown: 1.8,
    windup: 0.65,
    recover: 0.5,
    souls: 80,
    knockbackResist: 8,
    tunic: '#efe7d2',
    accent: '#d4af37',
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },

  /**
   * The Warlord: a pure bruiser.
   *
   * Where the Inquisitor punishes standing still, this one punishes standing
   * anywhere near it. Heavy armour and physical resistance mean an elemental build
   * handles it far better than a claws-and-crits one.
   */
  warlord: {
    id: 'warlord',
    get name() { return t('enemy.warlord.name'); },
    role: 'boss',
    enabled: true,
    hp: 1750,
    armor: 75,
    resist: { physical: 0.3, frost: 0.2 },
    speed: 142,
    radius: 24,
    damage: [{ type: 'physical', amount: 34 }],
    attackRange: 74,
    preferredRange: 66,
    attackCooldown: 1.5,
    windup: 0.6,
    recover: 0.55,
    souls: 85,
    knockbackResist: 12,
    tunic: '#6b3b2e',
    accent: '#c8cdd6',
    onHitStatuses: [{ id: 'bleed', duration: 6, stacks: 3, power: 3, sourceLabel: 'Warlord' }],
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },

  /**
   * The Pyromancer: fragile, but turns the arena itself against you.
   *
   * Low armour and the least health of the three — the difficulty is in the floor
   * catching fire, not in the health bar.
   */
  pyromancer: {
    id: 'pyromancer',
    get name() { return t('enemy.pyromancer.name'); },
    role: 'boss',
    enabled: true,
    hp: 1150,
    armor: 18,
    resist: { fire: 0.9, poison: 0.3 },
    speed: 130,
    radius: 20,
    damage: [{ type: 'fire', amount: 26 }],
    attackRange: 430,
    preferredRange: 300,
    attackCooldown: 1.5,
    windup: 0.55,
    recover: 0.45,
    souls: 80,
    knockbackResist: 5,
    tunic: '#8a3417',
    accent: '#ff9a3c',
    onHitStatuses: [{ id: 'burn', duration: 5, stacks: 3, power: 4, sourceLabel: 'Pyromancer' }],
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },

  /**
   * The Khagan: the war-camp's own warlord, and the run's real ending.
   *
   * Mounted like a Rider (see `Human.draw()`), commands them into the fight rather
   * than relying on its own reach, and closes the fight it can't win by attrition
   * with a storm that answers standing still with a dust cloud that doesn't miss.
   */
  khagan: {
    id: 'khagan',
    get name() { return t('enemy.khagan.name'); },
    role: 'boss',
    enabled: true,
    hp: 2100,
    armor: 55,
    resist: { physical: 0.15, frost: 0.3 },
    speed: 150,
    radius: 26,
    damage: [{ type: 'physical', amount: 36 }],
    attackRange: 90,
    preferredRange: 80,
    attackCooldown: 1.6,
    windup: 0.6,
    recover: 0.55,
    souls: 95,
    knockbackResist: 14,
    tunic: '#8a5a2e',
    accent: '#d4af37',
    spawnWeight: 0,
    minDepth: 99,
    bloodChance: 1,
    relicChance: 1,
    courage: 1,
  },
};

/** Point cost of each unit when filling a room's enemy spawn budget (roomgen.ts). */
export const SPAWN_COST: Record<HumanId, number> = {
  peasant: 1,
  militia: 2,
  archer: 3,
  torchbearer: 3.5,
  spearman: 4,
  crossbowman: 5,
  priest: 6,
  knight: 9,
  ballista: 7,
  rider: 5,
  siegeEngine: 10,
  inquisitor: 0,
  warlord: 0,
  pyromancer: 0,
  khagan: 0,
};

// ===========================================================================
// Buildings
// ===========================================================================

/** Fraction of max HP a burning building loses per second (Building.update). */
export const BUILDING_BURN_RATE_PER_SECOND = 0.03;

/** Building HP multiplier growth per room index on load (Game.enterNode). */
export const BUILDING_HP_SCALE_PER_ROOM_INDEX = 0.12;

export const BUILDING_PROFILES: Record<BuildingKind, BuildingProfile> = {
  hut: {
    kind: 'hut',
    get name() { return t('building.hut.name'); },
    hp: 120,
    souls: 3,
    occupancy: [0, 2],
    wallColor: '#5d4c3a',
    roofColor: '#7a5c34',
    hasRoof: true,
    opaque: true,
    relicChance: 0.04,
  },
  house: {
    kind: 'house',
    get name() { return t('building.house.name'); },
    hp: 220,
    souls: 6,
    occupancy: [1, 3],
    wallColor: '#6b5741',
    roofColor: '#8a4a32',
    hasRoof: true,
    opaque: true,
    relicChance: 0.07,
  },
  longhouse: {
    kind: 'longhouse',
    get name() { return t('building.longhouse.name'); },
    hp: 400,
    souls: 12,
    occupancy: [2, 5],
    wallColor: '#71604a',
    roofColor: '#6d4230',
    hasRoof: true,
    opaque: true,
    relicChance: 0.14,
  },
  granary: {
    kind: 'granary',
    get name() { return t('building.granary.name'); },
    hp: 180,
    souls: 5,
    occupancy: [0, 1],
    wallColor: '#7d6a4c',
    roofColor: '#9a7b3f',
    hasRoof: true,
    opaque: true,
    relicChance: 0.1,
  },
  chapel: {
    kind: 'chapel',
    get name() { return t('building.chapel.name'); },
    hp: 520,
    souls: 20,
    occupancy: [2, 4],
    wallColor: '#8b8579',
    roofColor: '#4a4f5c',
    hasRoof: true,
    opaque: true,
    relicChance: 0.3,
  },
  watchtower: {
    kind: 'watchtower',
    get name() { return t('building.watchtower.name'); },
    // Lower than the rest of its era: destroying it is now mandatory (it's what
    // shields its ballista), not optional loot like every other building kind.
    hp: 200,
    souls: 14,
    occupancy: [1, 2],
    wallColor: '#6a625a',
    roofColor: '#3f3a35',
    hasRoof: true,
    opaque: true,
    relicChance: 0.12,
  },
  stronghold: {
    kind: 'stronghold',
    get name() { return t('building.stronghold.name'); },
    // Same reasoning as watchtower: mandatory to destroy, so lower than its raw
    // size would otherwise suggest.
    hp: 420,
    souls: 26,
    occupancy: [1, 3],
    wallColor: '#8a7a5c',
    roofColor: '#5c4c38',
    hasRoof: true,
    opaque: true,
    relicChance: 0.2,
  },
  well: {
    kind: 'well',
    get name() { return t('building.well.name'); },
    hp: 160,
    souls: 2,
    occupancy: [0, 0],
    wallColor: '#5f5c58',
    roofColor: '#4a463f',
    hasRoof: false,
    opaque: false,
    relicChance: 0.02,
  },
  wall: {
    kind: 'wall',
    get name() { return t('building.wall.name'); },
    hp: 600,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#585349',
    roofColor: '#585349',
    hasRoof: false,
    opaque: true,
    relicChance: 0,
  },
  palisade: {
    kind: 'palisade',
    get name() { return t('building.palisade.name'); },
    hp: 260,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#6a5741',
    roofColor: '#6a5741',
    hasRoof: false,
    opaque: false,
    relicChance: 0,
  },
  cart: {
    kind: 'cart',
    get name() { return t('building.cart.name'); },
    hp: 90,
    souls: 2,
    occupancy: [0, 0],
    wallColor: '#6f5a3e',
    roofColor: '#5a4830',
    hasRoof: false,
    opaque: false,
    relicChance: 0.03,
  },
  stack: {
    kind: 'stack',
    get name() { return t('building.stack.name'); },
    hp: 60,
    souls: 1,
    occupancy: [0, 0],
    wallColor: '#a8913f',
    roofColor: '#c2a94c',
    hasRoof: false,
    opaque: false,
    relicChance: 0.02,
  },
};

// ===========================================================================
// Projectiles
// ===========================================================================

/** Fraction of a hit's damage a plain shot deals to a building, absent Razer. */
export const BASELINE_BUILDING_DAMAGE = 0.5;

// ===========================================================================
// Player — base stats and species
// ===========================================================================

export const BASE_STATS: Record<StatKey, number> = {
  maxHp: 120,
  hpRegen: 0,
  lifesteal: 0,
  armor: 0,
  dodge: 0,
  thorns: 0,
  shieldOnRoom: 0,

  moveSpeed: 210,
  dashCharges: 1,
  dashCooldown: 3,
  dashDistance: 150,

  damage: 16,
  attackSpeed: 1.7,
  critChance: 0.05,
  critDamage: 0.5,
  armorPen: 0,
  knockback: 60,
  executeThreshold: 0,

  projectiles: 1,
  projectileSpeed: 620,
  projectileSize: 1,
  pierce: 0,
  bounce: 0,
  range: 420,
  spread: 0.06,

  areaSize: 1,
  statusPower: 1,
  statusDuration: 1,
  statusChance: 1,

  pickupRadius: 110,
  soulGain: 1,
  healingReceived: 1,

  dmgPhysical: 0,
  dmgFire: 0,
  dmgPoison: 0,
  dmgFrost: 0,
  dmgLightning: 0,
  dmgUnholy: 0,

  convFire: 0,
  convPoison: 0,
  convFrost: 0,
  convLightning: 0,
  convUnholy: 0,

  resPhysical: 0,
  resFire: 0,
  resPoison: 0,
  resFrost: 0,
  resLightning: 0,
  resUnholy: 0,
  resHoly: 0,
};

/** Stats that must never go below these values, whatever the modifiers say. */
export const STAT_FLOORS: Partial<Record<StatKey, number>> = {
  maxHp: 1,
  moveSpeed: 40,
  damage: 1,
  attackSpeed: 0.2,
  projectiles: 1,
  projectileSpeed: 100,
  projectileSize: 0.3,
  range: 80,
  dashCooldown: 0.3,
  spread: 0,
  areaSize: 0.2,
  healingReceived: 0,
};

/** Hard ceilings on stats that would break the game if stacked without limit. */
export const STAT_CEILINGS: Partial<Record<StatKey, number>> = {
  dodge: 0.6,
  critChance: 1,
  armorPen: 0.9,
  lifesteal: 0.6,
  executeThreshold: 0.35,
  resPhysical: 0.8,
  resFire: 0.8,
  resPoison: 0.8,
  resFrost: 0.8,
  resLightning: 0.8,
  resUnholy: 0.8,
  resHoly: 0.8,
  attackSpeed: 12,
  projectiles: 16,
};

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

// ===========================================================================
// Skills
// ===========================================================================

export const RARITY: Record<Rarity, RarityStyle> = {
  common: { get name() { return t('rarity.common'); }, color: '#b9b2a2', glow: '#e8e2d4', weight: 100 },
  rare: { get name() { return t('rarity.rare'); }, color: '#5ea8d8', glow: '#a8dcff', weight: 42 },
  epic: { get name() { return t('rarity.epic'); }, color: '#a774e0', glow: '#dcbcff', weight: 14 },
  legendary: { get name() { return t('rarity.legendary'); }, color: '#d8a13a', glow: '#ffe28a', weight: 3.5 },
};

/**
 * The skill-card pool.
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
    enabled: true,
    get description() { return t('skill.fangs.description'); },
    tags: ['damage'],
    maxStacks: 6,
    modifiers: [{ key: 'damage', mult: 0.2 }],
  },
  {
    id: 'sinew',
    get name() { return t('skill.sinew.name'); },
    rarity: 'common',
    enabled: true,
    get description() { return t('skill.sinew.description'); },
    tags: ['speed'],
    maxStacks: 5,
    modifiers: [{ key: 'moveSpeed', mult: 0.1 }],
  },
  {
    id: 'thick-hide',
    get name() { return t('skill.thick-hide.name'); },
    rarity: 'common',
    enabled: true,
    get description() { return t('skill.thick-hide.description'); },
    tags: ['defense'],
    maxStacks: 6,
    modifiers: [{ key: 'maxHp', flat: 30 }],
  },
  {
    id: 'frenzy',
    get name() { return t('skill.frenzy.name'); },
    rarity: 'common',
    enabled: true,
    get description() { return t('skill.frenzy.description'); },
    tags: ['speed', 'damage'],
    maxStacks: 6,
    modifiers: [{ key: 'attackSpeed', mult: 0.15 }],
  },
  {
    id: 'long-reach',
    get name() { return t('skill.long-reach.name'); },
    rarity: 'common',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.bone-plates.description'); },
    tags: ['defense'],
    maxStacks: 5,
    modifiers: [{ key: 'armor', flat: 12 }],
  },
  {
    id: 'predator-eye',
    get name() { return t('skill.predator-eye.name'); },
    rarity: 'common',
    enabled: true,
    get description() { return t('skill.predator-eye.description'); },
    tags: ['crit'],
    maxStacks: 5,
    modifiers: [{ key: 'critChance', flat: 0.08 }],
  },
  {
    id: 'bloodthirst',
    get name() { return t('skill.bloodthirst.name'); },
    rarity: 'common',
    enabled: true,
    get description() { return t('skill.bloodthirst.description'); },
    tags: ['lifesteal'],
    maxStacks: 5,
    modifiers: [{ key: 'lifesteal', flat: 0.04 }],
  },
  {
    id: 'heavy-paw',
    get name() { return t('skill.heavy-paw.name'); },
    rarity: 'common',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.regrowth.description'); },
    tags: ['defense'],
    maxStacks: 5,
    modifiers: [{ key: 'hpRegen', flat: 1.5 }],
  },
  {
    id: 'wide-gullet',
    get name() { return t('skill.wide-gullet.name'); },
    rarity: 'common',
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.piercing.description'); },
    tags: ['projectiles'],
    maxStacks: 4,
    modifiers: [{ key: 'pierce', flat: 1 }],
  },
  {
    id: 'ricochet',
    get name() { return t('skill.ricochet.name'); },
    rarity: 'rare',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.hunting-instinct.description'); },
    tags: ['projectiles'],
    maxStacks: 3,
    behaviors: ['homing'],
  },
  {
    id: 'burning-blood',
    get name() { return t('skill.burning-blood.name'); },
    rarity: 'rare',
    enabled: true,
    get description() { return t('skill.burning-blood.description'); },
    tags: ['fire', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convFire', flat: 0.3 }],
  },
  {
    id: 'venom-glands',
    get name() { return t('skill.venom-glands.name'); },
    rarity: 'rare',
    enabled: true,
    get description() { return t('skill.venom-glands.description'); },
    tags: ['poison', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convPoison', flat: 0.3 }],
  },
  {
    id: 'frost-breath',
    get name() { return t('skill.frost-breath.name'); },
    rarity: 'rare',
    enabled: true,
    get description() { return t('skill.frost-breath.description'); },
    tags: ['frost', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convFrost', flat: 0.25 }],
  },
  {
    id: 'storm-hide',
    get name() { return t('skill.storm-hide.name'); },
    rarity: 'rare',
    enabled: true,
    get description() { return t('skill.storm-hide.description'); },
    tags: ['lightning', 'damage'],
    maxStacks: 4,
    modifiers: [{ key: 'convLightning', flat: 0.25 }],
  },
  {
    id: 'blight-seal',
    get name() { return t('skill.blight-seal.name'); },
    rarity: 'rare',
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.armor-shred.description'); },
    tags: ['damage'],
    maxStacks: 3,
    modifiers: [{ key: 'armorPen', flat: 0.25 }],
  },
  {
    id: 'devour',
    get name() { return t('skill.devour.name'); },
    rarity: 'rare',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.dread-roar.description'); },
    tags: ['fear'],
    maxStacks: 1,
    behaviors: ['fearOnKill'],
  },
  {
    id: 'potent-venoms',
    get name() { return t('skill.potent-venoms.name'); },
    rarity: 'rare',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.flesh-burst.description'); },
    tags: ['damage', 'destruction'],
    maxStacks: 3,
    behaviors: ['explodeOnKill'],
  },
  {
    id: 'chain-storm',
    get name() { return t('skill.chain-storm.name'); },
    rarity: 'epic',
    enabled: true,
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
    enabled: true,
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
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.frost-nova.description'); },
    tags: ['frost'],
    maxStacks: 2,
    behaviors: ['frostNova'],
  },
  {
    id: 'brood',
    get name() { return t('skill.brood.name'); },
    rarity: 'epic',
    enabled: true,
    get description() { return t('skill.brood.description'); },
    tags: ['damage', 'unholy'],
    maxStacks: 3,
    behaviors: ['orbitingSpawn'],
  },
  {
    id: 'berserk',
    get name() { return t('skill.berserk.name'); },
    rarity: 'epic',
    enabled: true,
    get description() { return t('skill.berserk.description'); },
    tags: ['damage'],
    maxStacks: 2,
    behaviors: ['rageAtLowHp'],
  },
  {
    id: 'execute',
    get name() { return t('skill.execute.name'); },
    rarity: 'epic',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.hemorrhage.description'); },
    tags: ['crit', 'damage'],
    maxStacks: 2,
    behaviors: ['bleedOnCrit'],
  },
  {
    id: 'second-wind',
    get name() { return t('skill.second-wind.name'); },
    rarity: 'epic',
    enabled: true,
    get description() { return t('skill.second-wind.description'); },
    tags: ['defense'],
    maxStacks: 1,
    behaviors: ['secondWind'],
  },
  {
    id: 'iron-carapace',
    get name() { return t('skill.iron-carapace.name'); },
    rarity: 'epic',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.razer.description'); },
    tags: ['destruction'],
    maxStacks: 1,
    behaviors: ['razeBuildings'],
  },
  {
    id: 'terror-aura',
    get name() { return t('skill.terror-aura.name'); },
    rarity: 'legendary',
    enabled: true,
    get description() { return t('skill.terror-aura.description'); },
    tags: ['fear'],
    maxStacks: 1,
    behaviors: ['terrorAura'],
  },
  {
    id: 'glass-cannon',
    get name() { return t('skill.glass-cannon.name'); },
    rarity: 'legendary',
    enabled: true,
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
    enabled: true,
    get description() { return t('skill.soul-harvest.description'); },
    tags: ['lifesteal'],
    maxStacks: 1,
    behaviors: ['soulHarvest'],
  },
  {
    id: 'death-blossom',
    get name() { return t('skill.death-blossom.name'); },
    rarity: 'legendary',
    enabled: true,
    get description() { return t('skill.death-blossom.description'); },
    tags: ['projectiles', 'damage'],
    maxStacks: 1,
    behaviors: ['deathBlossom'],
  },
  {
    id: 'volcano-heart',
    get name() { return t('skill.volcano-heart.name'); },
    rarity: 'legendary',
    enabled: true,
    get description() { return t('skill.volcano-heart.description'); },
    tags: ['fire'],
    maxStacks: 1,
    modifiers: [{ key: 'dmgFire', flat: 0.6 }],
    behaviors: ['burningGround'],
    requires: (c) => c.stats.get('convFire') > 0,
  },
];

// ===========================================================================
// Mutations (permanent, taken at evolution rooms)
// ===========================================================================

/**
 * Rooms at which an evolution choice is offered. Every 4th room, symmetric across
 * both biomes — including each one's boss, so the war-camp's ending gets the same
 * flourish the first biome's did.
 */
export const EVOLUTION_ROOMS = [3, 7, 11, 15, 19, 23] as const;

export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'abyssal-maw',
    get name() { return t('mutation.abyssal-maw.name'); },
    get description() { return t('mutation.abyssal-maw.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'damage', mult: 0.3 },
      { key: 'lifesteal', flat: 0.06 },
    ],
    mutate: (b: MonsterBody) => {
      b.maw = Math.min(0.72, b.maw + 0.2);
      b.lobes += 1;
      b.accentColor = '#7a1f2b';
    },
  },
  {
    id: 'bone-crown',
    get name() { return t('mutation.bone-crown.name'); },
    get description() { return t('mutation.bone-crown.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'armor', flat: 25 },
      { key: 'knockback', mult: 0.6 },
    ],
    mutate: (b: MonsterBody) => {
      b.horns += 2;
      b.coreRadius += 1;
    },
  },
  {
    id: 'dark-wings',
    get name() { return t('mutation.dark-wings.name'); },
    get description() { return t('mutation.dark-wings.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'moveSpeed', mult: 0.18 },
      { key: 'dashCharges', flat: 1 },
      { key: 'dashDistance', mult: 0.2 },
    ],
    mutate: (b: MonsterBody) => {
      b.wings += 2;
    },
  },
  {
    id: 'many-eyes',
    get name() { return t('mutation.many-eyes.name'); },
    get description() { return t('mutation.many-eyes.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'critChance', flat: 0.12 },
      { key: 'range', mult: 0.2 },
    ],
    mutate: (b: MonsterBody) => {
      b.eyes += 4;
      b.glowStrength += 0.2;
    },
  },
  {
    id: 'spine-ridge',
    get name() { return t('mutation.spine-ridge.name'); },
    get description() { return t('mutation.spine-ridge.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'thorns', flat: 0.3 },
      { key: 'armor', flat: 15 },
    ],
    mutate: (b: MonsterBody) => {
      b.spikes += 7;
    },
  },
  {
    id: 'lash-tails',
    get name() { return t('mutation.lash-tails.name'); },
    get description() { return t('mutation.lash-tails.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'projectiles', flat: 1 },
      { key: 'attackSpeed', mult: 0.1 },
    ],
    mutate: (b: MonsterBody) => {
      b.tails += 2;
    },
  },
  {
    id: 'extra-limbs',
    get name() { return t('mutation.extra-limbs.name'); },
    get description() { return t('mutation.extra-limbs.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'attackSpeed', mult: 0.12 },
      { key: 'moveSpeed', mult: 0.12 },
    ],
    mutate: (b: MonsterBody) => {
      b.limbs += 4;
    },
  },
  {
    id: 'bloated-mass',
    get name() { return t('mutation.bloated-mass.name'); },
    get description() { return t('mutation.bloated-mass.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'maxHp', flat: 90 },
      { key: 'armor', flat: 20 },
      { key: 'moveSpeed', mult: -0.12 },
    ],
    mutate: (b: MonsterBody) => {
      b.bulk += 0.28;
      b.lobes += 2;
    },
  },
  {
    id: 'hound-form',
    get name() { return t('mutation.hound-form.name'); },
    get description() { return t('mutation.hound-form.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'moveSpeed', mult: 0.22 },
      { key: 'attackSpeed', mult: 0.18 },
      { key: 'maxHp', flat: -30 },
    ],
    mutate: (b: MonsterBody) => {
      b.bulk = Math.max(0.7, b.bulk - 0.18);
      b.limbs += 2;
    },
  },

  // ---- elemental cores (mutually exclusive in practice) --------------------
  {
    id: 'magma-core',
    get name() { return t('mutation.magma-core.name'); },
    get description() { return t('mutation.magma-core.description'); },
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'convFire', flat: 0.25 },
      { key: 'dmgFire', flat: 0.35 },
    ],
    behaviors: ['burningGround'],
    mutate: (b: MonsterBody) => {
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
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'convFrost', flat: 0.25 },
      { key: 'dmgFrost', flat: 0.25 },
      { key: 'armor', flat: 20 },
    ],
    behaviors: ['frostNova'],
    mutate: (b: MonsterBody) => {
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
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'convPoison', flat: 0.3 },
      { key: 'dmgPoison', flat: 0.3 },
    ],
    behaviors: ['poisonCloud'],
    mutate: (b: MonsterBody) => {
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
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'convLightning', flat: 0.25 },
      { key: 'dmgLightning', flat: 0.3 },
      { key: 'attackSpeed', mult: 0.1 },
    ],
    behaviors: ['chainLightning'],
    mutate: (b: MonsterBody) => {
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
    enabled: true,
    tier: 0,
    modifiers: [
      { key: 'convUnholy', flat: 0.3 },
      { key: 'dmgUnholy', flat: 0.3 },
    ],
    behaviors: ['curseOnHit'],
    mutate: (b: MonsterBody) => {
      b.aura = 'void';
      b.glowColor = '#b06cff';
      b.accentColor = '#3d1f5c';
      b.eyes += 2;
    },
  },
];

// ===========================================================================
// Boons (temporary forms picked up mid-run)
// ===========================================================================

export const BOONS: readonly BoonDef[] = [
  {
    id: 'pyre',
    get name() { return t('boon.pyre.name'); },
    get description() { return t('boon.pyre.description'); },
    enabled: true,
    duration: 20,
    color: '#ff7b31',
    modifiers: [
      { key: 'convFire', flat: 0.5 },
      { key: 'dmgFire', flat: 0.4 },
    ],
    behaviors: ['burningGround'],
    shape: (b: MonsterBody) => {
      b.aura = 'fire';
      b.glowColor = '#ff7b31';
      b.accentColor = '#8a3417';
      b.glowStrength += 0.6;
    },
    weight: 12,
  },
  {
    id: 'colossus',
    get name() { return t('boon.colossus.name'); },
    get description() { return t('boon.colossus.description'); },
    enabled: true,
    duration: 18,
    color: '#d8a13a',
    modifiers: [
      { key: 'maxHp', mult: 0.5 },
      { key: 'damage', mult: 0.35 },
      { key: 'knockback', mult: 1 },
      { key: 'armor', flat: 25 },
      { key: 'moveSpeed', mult: -0.15 },
    ],
    shape: (b: MonsterBody) => {
      b.bulk *= 1.65;
      b.lobes += 2;
      b.spikes += 3;
      b.accentColor = '#7a5a20';
    },
    weight: 10,
  },
  {
    id: 'wraith',
    get name() { return t('boon.wraith.name'); },
    get description() { return t('boon.wraith.description'); },
    enabled: true,
    duration: 15,
    color: '#9fb4c7',
    modifiers: [
      { key: 'dodge', flat: 0.35 },
      { key: 'moveSpeed', mult: 0.4 },
      { key: 'dashCooldown', mult: -0.4 },
      { key: 'maxHp', mult: -0.2 },
    ],
    shape: (b: MonsterBody) => {
      b.bulk *= 0.78;
      b.alpha = 0.45;
      b.bodyColor = '#1b1a24';
      b.accentColor = '#3a3a52';
      b.glowColor = '#9fb4c7';
      b.tails += 1;
    },
    weight: 10,
  },
  {
    id: 'stormcrown',
    get name() { return t('boon.stormcrown.name'); },
    get description() { return t('boon.stormcrown.description'); },
    enabled: true,
    duration: 18,
    color: '#ffe45c',
    modifiers: [
      { key: 'convLightning', flat: 0.4 },
      { key: 'attackSpeed', mult: 0.25 },
    ],
    behaviors: ['chainLightning'],
    shape: (b: MonsterBody) => {
      b.aura = 'storm';
      b.glowColor = '#ffe45c';
      b.accentColor = '#5c5322';
      b.horns += 2;
      b.glowStrength += 0.5;
    },
    weight: 11,
  },
  {
    id: 'ossuary',
    get name() { return t('boon.ossuary.name'); },
    get description() { return t('boon.ossuary.description'); },
    enabled: true,
    duration: 20,
    color: '#e2dccb',
    modifiers: [
      { key: 'armor', flat: 70 },
      { key: 'thorns', flat: 0.45 },
      { key: 'moveSpeed', mult: -0.08 },
    ],
    shape: (b: MonsterBody) => {
      b.spikes += 12;
      b.horns += 2;
      b.bodyColor = '#3a3630';
      b.accentColor = '#6b6455';
    },
    weight: 11,
  },
  {
    id: 'myriad',
    get name() { return t('boon.myriad.name'); },
    get description() { return t('boon.myriad.description'); },
    enabled: true,
    duration: 18,
    color: '#b06cff',
    modifiers: [
      { key: 'critChance', flat: 0.3 },
      { key: 'critDamage', flat: 0.4 },
      { key: 'range', mult: 0.3 },
    ],
    behaviors: ['homing'],
    shape: (b: MonsterBody) => {
      b.eyes += 10;
      b.glowColor = '#b06cff';
      b.glowStrength += 0.4;
    },
    weight: 11,
  },
  {
    id: 'winged',
    get name() { return t('boon.winged.name'); },
    get description() { return t('boon.winged.description'); },
    enabled: true,
    duration: 18,
    color: '#8f7ad8',
    modifiers: [
      { key: 'moveSpeed', mult: 0.3 },
      { key: 'dashCharges', flat: 2 },
      { key: 'dashDistance', mult: 0.3 },
    ],
    shape: (b: MonsterBody) => {
      b.wings += 2;
      b.tails += 1;
      b.accentColor = '#453462';
    },
    weight: 10,
  },
  {
    id: 'miasma',
    get name() { return t('boon.miasma.name'); },
    get description() { return t('boon.miasma.description'); },
    enabled: true,
    duration: 20,
    color: '#8ed44f',
    modifiers: [
      { key: 'convPoison', flat: 0.5 },
      { key: 'dmgPoison', flat: 0.35 },
    ],
    behaviors: ['poisonCloud'],
    shape: (b: MonsterBody) => {
      b.aura = 'poison';
      b.glowColor = '#8ed44f';
      b.accentColor = '#3b5c25';
      b.lobes += 3;
      b.bulk *= 1.12;
    },
    weight: 11,
  },
  {
    id: 'brood',
    get name() { return t('boon.brood.name'); },
    get description() { return t('boon.brood.description'); },
    enabled: true,
    duration: 16,
    color: '#c46b9a',
    modifiers: [
      { key: 'attackSpeed', mult: 0.45 },
      { key: 'moveSpeed', mult: 0.18 },
      { key: 'projectiles', flat: 1 },
      { key: 'damage', mult: -0.15 },
    ],
    shape: (b: MonsterBody) => {
      b.limbs += 8;
      b.eyes += 4;
      b.bulk *= 0.92;
      b.accentColor = '#7a2f4d';
    },
    weight: 10,
  },
  {
    id: 'glacier',
    get name() { return t('boon.glacier.name'); },
    get description() { return t('boon.glacier.description'); },
    enabled: true,
    duration: 18,
    color: '#6fd0ff',
    modifiers: [
      { key: 'convFrost', flat: 0.45 },
      { key: 'dmgFrost', flat: 0.35 },
      { key: 'armor', flat: 30 },
    ],
    behaviors: ['frostNova'],
    shape: (b: MonsterBody) => {
      b.aura = 'frost';
      b.glowColor = '#6fd0ff';
      b.bodyColor = '#1e2b38';
      b.accentColor = '#2f5b7a';
      b.spikes += 6;
    },
    weight: 11,
  },
];

// ===========================================================================
// Curses (permanent debuffs taken at cursed altars)
// ===========================================================================

export const CURSES: readonly Curse[] = [
  {
    id: 'brittleBones',
    enabled: true,
    modifiers: [{ key: 'maxHp', mult: -0.22 }],
    weight: 12,
  },
  {
    id: 'leadLimbs',
    enabled: true,
    modifiers: [{ key: 'moveSpeed', mult: -0.16 }],
    weight: 12,
  },
  {
    id: 'torpor',
    enabled: true,
    modifiers: [{ key: 'attackSpeed', mult: -0.16 }],
    weight: 12,
  },
  {
    id: 'cloudedEyes',
    enabled: true,
    modifiers: [
      { key: 'critChance', flat: -0.08 },
      { key: 'range', mult: -0.15 },
    ],
    weight: 11,
  },
  {
    id: 'rottingFlesh',
    enabled: true,
    modifiers: [
      { key: 'healingReceived', mult: -0.45 },
      { key: 'hpRegen', flat: -1.5 },
    ],
    weight: 10,
  },
  {
    id: 'peeledScales',
    enabled: true,
    modifiers: [{ key: 'armor', flat: -30 }],
    weight: 11,
  },
  {
    id: 'palsy',
    enabled: true,
    modifiers: [{ key: 'spread', mult: 0.8 }],
    weight: 10,
  },
  {
    id: 'starvedDark',
    enabled: true,
    modifiers: [{ key: 'soulGain', mult: -0.28 }],
    weight: 10,
  },
  {
    id: 'stiffHeart',
    enabled: true,
    modifiers: [{ key: 'dashCooldown', mult: 0.6 }],
    weight: 10,
  },
  {
    id: 'dullSenses',
    enabled: true,
    modifiers: [{ key: 'pickupRadius', mult: -0.4 }],
    weight: 9,
  },
];

// ===========================================================================
// Statuses (buffs/debuffs applied by combat — burn, poison, fear, ...)
// ===========================================================================

export const STATUS_DEFS: Record<StatusId, StatusDef> = {
  burn: {
    id: 'burn',
    get name() { return t('status.burn.name'); },
    color: '#ff7b31',
    maxStacks: 10,
    dotType: 'fire',
    tickInterval: 0.4,
    maxDuration: 8,
    get description() { return t('status.burn.description'); },
  },
  poison: {
    id: 'poison',
    get name() { return t('status.poison.name'); },
    color: '#8ed44f',
    maxStacks: 20,
    dotType: 'poison',
    tickInterval: 0.5,
    maxDuration: 14,
    get description() { return t('status.poison.description'); },
  },
  bleed: {
    id: 'bleed',
    get name() { return t('status.bleed.name'); },
    color: '#c0343c',
    maxStacks: 8,
    dotType: 'physical',
    tickInterval: 0.5,
    maxDuration: 10,
    get description() { return t('status.bleed.description'); },
  },
  chill: {
    id: 'chill',
    get name() { return t('status.chill.name'); },
    color: '#6fd0ff',
    maxStacks: 10,
    tickInterval: 0,
    maxDuration: 6,
    get description() { return t('status.chill.description'); },
  },
  freeze: {
    id: 'freeze',
    get name() { return t('status.freeze.name'); },
    color: '#a9e8ff',
    maxStacks: 1,
    tickInterval: 0,
    maxDuration: 3,
    get description() { return t('status.freeze.description'); },
  },
  shock: {
    id: 'shock',
    get name() { return t('status.shock.name'); },
    color: '#ffe45c',
    maxStacks: 5,
    tickInterval: 0,
    maxDuration: 5,
    get description() { return t('status.shock.description'); },
  },
  curse: {
    id: 'curse',
    get name() { return t('status.curse.name'); },
    color: '#b06cff',
    maxStacks: 5,
    tickInterval: 0,
    maxDuration: 8,
    get description() { return t('status.curse.description'); },
  },
  fear: {
    id: 'fear',
    get name() { return t('status.fear.name'); },
    color: '#9b8fb0',
    maxStacks: 1,
    tickInterval: 0,
    maxDuration: 5,
    get description() { return t('status.fear.description'); },
  },
  weaken: {
    id: 'weaken',
    get name() { return t('status.weaken.name'); },
    color: '#7d8a99',
    maxStacks: 5,
    tickInterval: 0,
    maxDuration: 8,
    get description() { return t('status.weaken.description'); },
  },
};

// Re-exported so a consumer that only needs the raw modifier shape doesn't have to
// know it originally came from the skill-card system.
export type { RawModifier };
export type { StatusApplication };
export type { DamagePacket };
