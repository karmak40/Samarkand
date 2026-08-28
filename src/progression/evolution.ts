import { EVOLUTION_ROOMS, MUTATIONS } from '../balance';
import { RNG } from '../core/rng';
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
  /** Balance-file toggle: false removes this mutation from the draw pool entirely. */
  readonly enabled: boolean;
  readonly modifiers?: readonly RawModifier[];
  readonly behaviors?: readonly BehaviorFlag[];
  readonly mutate: (body: MonsterBody) => void;
  /** Only offered when this returns true. */
  readonly requires?: (stats: StatSheet) => boolean;
}

// The actual mutation roster lives in ../balance now, re-exporting keeps
// every existing from './evolution' import working unchanged.
export { MUTATIONS };

const MUTATIONS_BY_ID = new Map(MUTATIONS.map((m) => [m.id, m]));

export function getMutation(id: string): Mutation | undefined {
  return MUTATIONS_BY_ID.get(id);
}

// Room cadence for evolution offers also lives in ../balance now.
export { EVOLUTION_ROOMS };

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
    (m) => m.enabled && !taken.has(m.id) && gate.has('mutation', m.id) && (!m.requires || m.requires(stats)),
  );
  return rng.sample(pool, count);
}
