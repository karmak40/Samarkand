import { RNG } from '../core/rng';
import { type ContentGate, OPEN_GATE } from './gate';
import { t } from '../i18n';
import { type MonsterBody } from './evolution';
import { type RawModifier } from './skills';
import { type BehaviorFlag } from './stats';

/**
 * Temporary forms.
 *
 * Unlike mutations, a boon is borrowed: it lasts seconds, not the rest of the run.
 * Every one of them reshapes the body description as well as the stat sheet, so the
 * monster is visibly a different creature while it holds — that is the whole point.
 * Because the renderer draws purely from `MonsterBody`, a boon that adds wings
 * genuinely grows wings.
 */
export interface BoonDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Seconds the form holds. */
  readonly duration: number;
  /** Drives the pickup glow, the HUD timer and the pickup burst. */
  readonly color: string;
  readonly modifiers?: readonly RawModifier[];
  readonly behaviors?: readonly BehaviorFlag[];
  /** Mutates a *copy* of the body used for rendering and for the collision radius. */
  readonly shape: (body: MonsterBody) => void;
  /** Relative chance of being drawn. */
  readonly weight: number;
}

export const BOONS: readonly BoonDef[] = [
  {
    id: 'pyre',
    get name() { return t('boon.pyre.name'); },
    get description() { return t('boon.pyre.description'); },
    duration: 20,
    color: '#ff7b31',
    modifiers: [
      { key: 'convFire', flat: 0.5 },
      { key: 'dmgFire', flat: 0.4 },
    ],
    behaviors: ['burningGround'],
    shape: (b) => {
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
    duration: 18,
    color: '#d8a13a',
    modifiers: [
      { key: 'maxHp', mult: 0.5 },
      { key: 'damage', mult: 0.35 },
      { key: 'knockback', mult: 1 },
      { key: 'armor', flat: 25 },
      { key: 'moveSpeed', mult: -0.15 },
    ],
    shape: (b) => {
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
    duration: 15,
    color: '#9fb4c7',
    modifiers: [
      { key: 'dodge', flat: 0.35 },
      { key: 'moveSpeed', mult: 0.4 },
      { key: 'dashCooldown', mult: -0.4 },
      { key: 'maxHp', mult: -0.2 },
    ],
    shape: (b) => {
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
    duration: 18,
    color: '#ffe45c',
    modifiers: [
      { key: 'convLightning', flat: 0.4 },
      { key: 'attackSpeed', mult: 0.25 },
    ],
    behaviors: ['chainLightning'],
    shape: (b) => {
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
    duration: 20,
    color: '#e2dccb',
    modifiers: [
      { key: 'armor', flat: 70 },
      { key: 'thorns', flat: 0.45 },
      { key: 'moveSpeed', mult: -0.08 },
    ],
    shape: (b) => {
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
    duration: 18,
    color: '#b06cff',
    modifiers: [
      { key: 'critChance', flat: 0.3 },
      { key: 'critDamage', flat: 0.4 },
      { key: 'range', mult: 0.3 },
    ],
    behaviors: ['homing'],
    shape: (b) => {
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
    duration: 18,
    color: '#8f7ad8',
    modifiers: [
      { key: 'moveSpeed', mult: 0.3 },
      { key: 'dashCharges', flat: 2 },
      { key: 'dashDistance', mult: 0.3 },
    ],
    shape: (b) => {
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
    duration: 20,
    color: '#8ed44f',
    modifiers: [
      { key: 'convPoison', flat: 0.5 },
      { key: 'dmgPoison', flat: 0.35 },
    ],
    behaviors: ['poisonCloud'],
    shape: (b) => {
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
    duration: 16,
    color: '#c46b9a',
    modifiers: [
      { key: 'attackSpeed', mult: 0.45 },
      { key: 'moveSpeed', mult: 0.18 },
      { key: 'projectiles', flat: 1 },
      { key: 'damage', mult: -0.15 },
    ],
    shape: (b) => {
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
    duration: 18,
    color: '#6fd0ff',
    modifiers: [
      { key: 'convFrost', flat: 0.45 },
      { key: 'dmgFrost', flat: 0.35 },
      { key: 'armor', flat: 30 },
    ],
    behaviors: ['frostNova'],
    shape: (b) => {
      b.aura = 'frost';
      b.glowColor = '#6fd0ff';
      b.bodyColor = '#1e2b38';
      b.accentColor = '#2f5b7a';
      b.spikes += 6;
    },
    weight: 11,
  },
];

const BOONS_BY_ID = new Map(BOONS.map((b) => [b.id, b]));

export function getBoon(id: string): BoonDef | undefined {
  return BOONS_BY_ID.get(id);
}

/**
 * Pick a boon to drop.
 *
 * @param active ids already running — a duplicate would just refresh a timer, which
 *               is a dull thing to find lying on the ground.
 */
export function rollBoon(
  rng: RNG,
  active: ReadonlySet<string>,
  gate: ContentGate = OPEN_GATE,
): BoonDef {
  const owned = BOONS.filter((b) => gate.has('boon', b.id));
  const source = owned.length > 0 ? owned : BOONS;
  // Prefer a form the monster is not already wearing; a duplicate would only top up
  // a timer, which is a dull thing to find lying on the ground.
  const fresh = source.filter((b) => !active.has(b.id));
  const pool = fresh.length > 0 ? fresh : source;
  return rng.pickWeighted(pool, (b) => b.weight);
}
