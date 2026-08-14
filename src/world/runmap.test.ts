import { describe, expect, it } from 'vitest';
import { RNG } from '../core/rng';
import { generateRunMap, isArenaNode, type RunMap, reachableFrom } from './runmap';

const DEPTHS = 12;

/** Every map the tests inspect, so an invariant is checked against many shapes. */
const maps: RunMap[] = Array.from({ length: 120 }, (_, i) => generateRunMap(DEPTHS, new RNG(i + 1)));

/** Ids reachable from the entry by walking forward edges only. */
function walkForward(map: RunMap): Set<number> {
  const seen = new Set<number>(map.byDepth[0]);
  const queue = [...map.byDepth[0]!];
  while (queue.length > 0) {
    const node = map.nodes[queue.shift()!]!;
    for (const next of node.next) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

describe('run map shape', () => {
  it('has the requested number of depths', () => {
    for (const map of maps) {
      expect(map.byDepth).toHaveLength(DEPTHS);
      expect(map.depths).toBe(DEPTHS);
    }
  });

  it('starts on a single stop and ends on a single boss', () => {
    for (const map of maps) {
      expect(map.byDepth[0]).toHaveLength(1);

      const last = map.byDepth[DEPTHS - 1]!;
      expect(last).toHaveLength(1);
      expect(map.nodes[last[0]!]!.kind).toBe('boss');
    }
  });

  it('never lets an edge skip or cross more than one lane', () => {
    for (const map of maps) {
      for (const node of map.nodes) {
        for (const nextId of node.next) {
          const next = map.nodes[nextId]!;
          expect(next.depth).toBe(node.depth + 1);
          expect(Math.abs(next.lane - node.lane)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('run map connectivity', () => {
  it('leaves no dead ends and nothing unreachable', () => {
    for (const map of maps) {
      for (const node of map.nodes) {
        if (node.depth > 0) expect(node.prev.length).toBeGreaterThan(0);
        if (node.depth < DEPTHS - 1) expect(node.next.length).toBeGreaterThan(0);
      }
    }
  });

  it('can reach every node from the entry', () => {
    for (const map of maps) {
      expect(walkForward(map).size).toBe(map.nodes.length);
    }
  });

  it('keeps forward and backward edges consistent', () => {
    for (const map of maps) {
      for (const node of map.nodes) {
        for (const nextId of node.next) expect(map.nodes[nextId]!.prev).toContain(node.id);
        for (const prevId of node.prev) expect(map.nodes[prevId]!.next).toContain(node.id);
      }
    }
  });
});

describe('run map pacing', () => {
  it('opens on plain battles, so nobody meets an elite before they have a card', () => {
    for (const map of maps) {
      for (const depth of [0, 1]) {
        for (const id of map.byDepth[depth]!) expect(map.nodes[id]!.kind).toBe('battle');
      }
    }
  });

  it('makes the layer before the boss all battles', () => {
    for (const map of maps) {
      for (const id of map.byDepth[DEPTHS - 2]!) expect(map.nodes[id]!.kind).toBe('battle');
    }
  });

  it('always offers at least two markets and two elites', () => {
    for (const map of maps) {
      const count = (kind: string): number => map.nodes.filter((n) => n.kind === kind).length;
      expect(count('market')).toBeGreaterThanOrEqual(2);
      expect(count('elite')).toBeGreaterThanOrEqual(2);
    }
  });

  it('branches — a straight line of twelve would defeat the point', () => {
    for (const map of maps) {
      expect(map.nodes.length).toBeGreaterThan(DEPTHS);
    }
  });
});

describe('generateRunMap determinism', () => {
  it('produces an identical map for the same seed', () => {
    const shape = (map: RunMap): string =>
      map.nodes.map((n) => `${n.depth}:${n.lane}:${n.kind}:${n.next.join(',')}`).join('|');

    expect(shape(generateRunMap(DEPTHS, new RNG(777)))).toBe(
      shape(generateRunMap(DEPTHS, new RNG(777))),
    );
  });
});

describe('reachableFrom', () => {
  it('offers the entry layer before the first choice is made', () => {
    const map = maps[0]!;
    expect(reachableFrom(map, null).map((n) => n.id)).toEqual(map.byDepth[0]);
  });

  it('offers exactly the successors of the current stop', () => {
    const map = maps[0]!;
    const start = map.byDepth[0]![0]!;

    expect(reachableFrom(map, start).map((n) => n.id).sort()).toEqual(
      [...map.nodes[start]!.next].sort(),
    );
  });

  it('offers nothing past the boss', () => {
    const map = maps[0]!;
    expect(reachableFrom(map, map.byDepth[DEPTHS - 1]![0]!)).toHaveLength(0);
  });
});

describe('isArenaNode', () => {
  it('counts only the stops that load a settlement', () => {
    expect(isArenaNode('battle')).toBe(true);
    expect(isArenaNode('elite')).toBe(true);
    expect(isArenaNode('boss')).toBe(true);
    expect(isArenaNode('market')).toBe(false);
    expect(isArenaNode('cursed')).toBe(false);
  });
});
