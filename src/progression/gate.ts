/**
 * Content gating interface.
 *
 * Deliberately in its own dependency-free module. The unlock catalogue is derived
 * from the content tables (cards, mutations, boons), and those tables need the gate
 * type — putting both in one file creates an import cycle where the catalogue runs
 * before the tables it reads are initialised.
 */

export type UnlockCategory = 'card' | 'mutation' | 'boon' | 'species';

/** Everything that reads unlockable content asks this first. */
export interface ContentGate {
  has(category: UnlockCategory, refId: string): boolean;
}

/** A gate that permits everything — the default for tools, tests and dev harnesses. */
export const OPEN_GATE: ContentGate = { has: () => true };
