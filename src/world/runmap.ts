import {
  ELITE_WEIGHT_DEPTH_BONUS_BASE,
  MIN_SPECIAL_NODES_PER_RUN,
  NODE_KIND_WEIGHTS,
  RUN_MAP_LANES,
} from '../balance';
import { RNG } from '../core/rng';

export type NodeKind = 'battle' | 'elite' | 'market' | 'cursed' | 'boss';

/** One stop on the run. Edges only ever point to the next depth. */
export interface MapNode {
  readonly id: number;
  readonly depth: number;
  /** Column used for layout; edges are restricted to ±1 lane so they never cross. */
  readonly lane: number;
  kind: NodeKind;
  /** Ids at `depth + 1` reachable from here. */
  readonly next: number[];
  readonly prev: number[];
}

export interface RunMap {
  readonly nodes: MapNode[];
  /** Node ids grouped by depth, ordered by lane. */
  readonly byDepth: number[][];
  readonly depths: number;
  readonly lanes: number;
}

interface KindWeight {
  kind: NodeKind;
  /** Base weight, before the depth curve. */
  weight: number;
  /** Not offered before this depth. */
  minDepth: number;
}

// The actual weights/gates live in `../balance`'s NODE_KIND_WEIGHTS (a Record, for
// easy editing); flattened here into the array shape this file's logic wants.
const KIND_WEIGHTS: readonly KindWeight[] = Object.entries(NODE_KIND_WEIGHTS).map(([kind, cfg]) => ({
  kind: kind as NodeKind,
  ...cfg,
}));

/**
 * Build the run's map.
 *
 * Shape: `depths` layers, one entry node, one boss, and two or three nodes in the
 * middle. Edges only connect adjacent lanes, which is what keeps the drawing legible
 * — a graph where any node can reach any other is impossible to read and removes the
 * feeling of committing to a route.
 *
 * Every node is guaranteed at least one way in and one way out, so no branch is a
 * dead end and nothing is unreachable.
 */
export function generateRunMap(depths: number, rng: RNG): RunMap {
  const nodes: MapNode[] = [];
  const byDepth: number[][] = [];

  const push = (depth: number, lane: number, kind: NodeKind): MapNode => {
    const node: MapNode = { id: nodes.length, depth, lane, kind, next: [], prev: [] };
    nodes.push(node);
    return node;
  };

  // --- layout ---------------------------------------------------------------
  for (let depth = 0; depth < depths; depth++) {
    const ids: number[] = [];

    if (depth === 0 || depth === depths - 1) {
      // A single entrance and a single boss: the run starts and ends in one place.
      const kind: NodeKind = depth === 0 ? 'battle' : 'boss';
      ids.push(push(depth, 1, kind).id);
    } else {
      const count = rng.bool(0.55) ? 3 : 2;
      // Two-node layers use the outer lanes so the fork is visually obvious.
      const lanes = count === 3 ? [0, 1, 2] : rng.bool(0.5) ? [0, 2] : [0, 1];
      for (const lane of lanes) ids.push(push(depth, lane, 'battle').id);
    }

    byDepth.push(ids);
  }

  // --- edges ----------------------------------------------------------------
  for (let depth = 0; depth < depths - 1; depth++) {
    const here = byDepth[depth]!;
    const there = byDepth[depth + 1]!;

    for (const id of here) {
      const node = nodes[id]!;
      // Candidates within one lane, so no two edges ever cross.
      let reachable = there.filter((other) => Math.abs(nodes[other]!.lane - node.lane) <= 1);
      // Nothing adjacent: fall back to the closest lane so the path never breaks.
      if (reachable.length === 0) {
        const closest = there.reduce((best, other) =>
          Math.abs(nodes[other]!.lane - node.lane) < Math.abs(nodes[best]!.lane - node.lane)
            ? other
            : best,
        );
        reachable = [closest];
      }

      // One or two exits: a single exit is a corridor, three would flatten the choice.
      const wanted = reachable.length > 1 && rng.bool(0.55) ? 2 : 1;
      const chosen = rng.sample(reachable, Math.min(wanted, reachable.length));
      for (const other of chosen) connect(nodes, node, nodes[other]!);
    }

    // Anything in the next layer with no way in gets an edge from its nearest
    // neighbour here — otherwise part of the map would be unreachable.
    for (const other of there) {
      const target = nodes[other]!;
      if (target.prev.length > 0) continue;
      const source = here.reduce((best, id) =>
        Math.abs(nodes[id]!.lane - target.lane) < Math.abs(nodes[best]!.lane - target.lane)
          ? id
          : best,
      );
      connect(nodes, nodes[source]!, target);
    }
  }

  assignKinds(nodes, byDepth, depths, rng);

  return { nodes, byDepth, depths, lanes: RUN_MAP_LANES };
}

function connect(nodes: MapNode[], from: MapNode, to: MapNode): void {
  void nodes;
  if (from.next.includes(to.id)) return;
  from.next.push(to.id);
  to.prev.push(from.id);
}

/**
 * Decide what each stop actually is.
 *
 * Rules that matter for pacing:
 *  - the first two depths are plain fights, so a run never opens on a shop;
 *  - a layer never offers the same non-battle twice, or the "choice" is fake;
 *  - the depth before the boss is always all-battle, so you arrive warmed up;
 *  - the map is guaranteed at least two markets and two elites, otherwise a bad
 *    roll can produce twelve identical rooms — the exact problem this replaces.
 */
function assignKinds(nodes: MapNode[], byDepth: number[][], depths: number, rng: RNG): void {
  for (let depth = 1; depth < depths - 1; depth++) {
    const ids = byDepth[depth]!;
    const used = new Set<NodeKind>();

    for (const id of ids) {
      const node = nodes[id]!;
      const pool = KIND_WEIGHTS.filter(
        (entry) =>
          depth >= entry.minDepth &&
          (entry.kind === 'battle' || !used.has(entry.kind)) &&
          // Keep the run-up to the boss clean.
          !(depth === depths - 2 && entry.kind !== 'battle'),
      );

      const chosen = rng.pickWeighted(pool, (entry) => {
        if (entry.kind === 'elite') return entry.weight * (ELITE_WEIGHT_DEPTH_BONUS_BASE + depth / depths);
        return entry.weight;
      });

      node.kind = chosen.kind;
      if (chosen.kind !== 'battle') used.add(chosen.kind);
    }
  }

  ensureMinimum(nodes, byDepth, depths, 'market', MIN_SPECIAL_NODES_PER_RUN, rng);
  ensureMinimum(nodes, byDepth, depths, 'elite', MIN_SPECIAL_NODES_PER_RUN, rng);
}

/** Convert plain fights into `kind` until the map holds at least `wanted` of them. */
function ensureMinimum(
  nodes: MapNode[],
  byDepth: number[][],
  depths: number,
  kind: NodeKind,
  wanted: number,
  rng: RNG,
): void {
  const count = (): number => nodes.filter((n) => n.kind === kind).length;
  if (count() >= wanted) return;

  const minDepth = KIND_WEIGHTS.find((entry) => entry.kind === kind)?.minDepth ?? 2;
  // Only the middle of the run is eligible; never the opener or the boss run-up.
  const candidates = nodes.filter(
    (node) =>
      node.kind === 'battle' &&
      node.depth >= minDepth &&
      node.depth < depths - 2 &&
      // Don't create a layer that offers the same thing twice.
      !byDepth[node.depth]!.some((id) => nodes[id]!.kind === kind),
  );

  for (const node of rng.shuffle(candidates)) {
    if (count() >= wanted) return;
    node.kind = kind;
  }
}

/** Nodes the player may move to from here. The entry node is chosen implicitly. */
export function reachableFrom(map: RunMap, nodeId: number | null): MapNode[] {
  if (nodeId === null) return map.byDepth[0]!.map((id) => map.nodes[id]!);
  return map.nodes[nodeId]!.next.map((id) => map.nodes[id]!);
}

/** Whether a stop is fought in an arena, as opposed to resolved on a screen. */
export function isArenaNode(kind: NodeKind): boolean {
  return kind === 'battle' || kind === 'elite' || kind === 'boss';
}
