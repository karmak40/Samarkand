import { SPECIES } from '../balance';
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

// The actual roster (stats, body, unlock price) lives in ../balance now, re-exporting keeps every existing import of SPECIES from this file working unchanged.
export { SPECIES };

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
