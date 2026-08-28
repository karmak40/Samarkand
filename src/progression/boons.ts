import { BOONS } from '../balance';
import { RNG } from '../core/rng';
import { type ContentGate, OPEN_GATE } from './gate';
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
  /** Balance-file toggle: false removes this boon from the drop pool entirely. */
  readonly enabled: boolean;
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

// The actual boon roster lives in ../balance now, re-exporting keeps every
// existing from './boons' import working unchanged.
export { BOONS };

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
  const owned = BOONS.filter((b) => b.enabled && gate.has('boon', b.id));
  const source = owned.length > 0 ? owned : BOONS.filter((b) => b.enabled);
  // Prefer a form the monster is not already wearing; a duplicate would only top up
  // a timer, which is a dull thing to find lying on the ground.
  const fresh = source.filter((b) => !active.has(b.id));
  const pool = fresh.length > 0 ? fresh : source;
  return rng.pickWeighted(pool, (b) => b.weight);
}
