import { type BuildingKind } from '../entities/building';
import { HUMAN_ARCHETYPES, type HumanId } from '../entities/human';
import { clamp, type Rect, rectsOverlap, TAU, type Vec2 } from '../core/math';
import { RNG } from '../core/rng';

export type RoomKind = 'hamlet' | 'village' | 'fortified' | 'shrine' | 'boss';

export interface PlannedBuilding {
  kind: BuildingKind;
  rect: Rect;
}

export interface PlannedSpawn {
  id: HumanId;
  x: number;
  y: number;
}

export interface RoomPlan {
  index: number;
  kind: RoomKind;
  name: string;
  bounds: Rect;
  buildings: PlannedBuilding[];
  spawns: PlannedSpawn[];
  monsterStart: Vec2;
  /** Where the portal opens once the settlement is cleared. */
  exit: Vec2;
  /** Relics lying in the settlement, each granting a temporary form. */
  relics: Vec2[];
  /** Deterministic tint for the ground, so each room reads as its own place. */
  groundSeed: number;
  /**
   * Depth of the drawn barrier (rocks or masonry) around the arena. Entities are
   * clamped inside it, so the edge of the world is something you can see.
   */
  wallThickness: number;
  isBoss: boolean;
}

const NAME_PREFIX = [
  'Тихий',
  'Серый',
  'Старый',
  'Дальний',
  'Мокрый',
  'Кривой',
  'Волчий',
  'Пепельный',
  'Глухой',
  'Последний',
];

const NAME_ROOT: Record<RoomKind, string[]> = {
  hamlet: ['Хутор', 'Выселок', 'Двор', 'Займище'],
  village: ['Погост', 'Посад', 'Селище', 'Городище'],
  fortified: ['Острог', 'Застава', 'Крепь', 'Вал'],
  shrine: ['Скит', 'Часовня', 'Обитель', 'Придел'],
  boss: ['Собор', 'Оплот', 'Твердыня'],
};

/** Room kind by depth. Boss caps the biome. */
export function roomKindForDepth(index: number, totalRooms: number, rng: RNG): RoomKind {
  if (index >= totalRooms - 1) return 'boss';
  if (index === 0) return 'hamlet';
  if (index % 4 === 3) return 'shrine';
  if (index >= 6 && rng.bool(0.45)) return 'fortified';
  return rng.bool(0.3) ? 'hamlet' : 'village';
}

/** Depth of the boulder/masonry band drawn around every arena. */
const WALL_THICKNESS = 46;

interface KindConfig {
  /** Arena size in world units at depth 0; grows with depth. */
  size: [number, number];
  buildingCount: [number, number];
  /** Extra weight for these building kinds. */
  palette: BuildingKind[];
  palisade: boolean;
  enemyBudgetScale: number;
}

const KIND_CONFIG: Record<RoomKind, KindConfig> = {
  hamlet: {
    size: [1180, 900],
    buildingCount: [5, 9],
    palette: ['hut', 'hut', 'house', 'stack', 'cart', 'well'],
    palisade: false,
    enemyBudgetScale: 0.85,
  },
  village: {
    size: [1360, 1050],
    buildingCount: [9, 15],
    palette: ['house', 'house', 'hut', 'granary', 'longhouse', 'well', 'cart', 'stack'],
    palisade: false,
    enemyBudgetScale: 1,
  },
  fortified: {
    size: [1450, 1120],
    buildingCount: [10, 16],
    palette: ['house', 'longhouse', 'watchtower', 'granary', 'watchtower', 'well'],
    palisade: true,
    enemyBudgetScale: 1.25,
  },
  shrine: {
    size: [1280, 1020],
    buildingCount: [7, 11],
    palette: ['chapel', 'house', 'hut', 'well', 'chapel'],
    palisade: false,
    enemyBudgetScale: 1.1,
  },
  boss: {
    size: [1560, 1240],
    buildingCount: [6, 10],
    palette: ['chapel', 'watchtower', 'longhouse', 'wall'],
    palisade: true,
    enemyBudgetScale: 1.4,
  },
};

/** Point cost of each unit when filling the room's spawn budget. */
const SPAWN_COST: Record<HumanId, number> = {
  peasant: 1,
  militia: 2,
  archer: 3,
  torchbearer: 3.5,
  spearman: 4,
  crossbowman: 5,
  priest: 6,
  knight: 9,
  ballista: 7,
  inquisitor: 0,
};

/**
 * Builds a settlement.
 *
 * Layout method: a plaza anchors the centre, buildings are placed by rejection
 * sampling on a loose ring around it, and defenders spawn near the structures they
 * would plausibly be guarding. The monster always starts at the arena edge furthest
 * from the densest cluster, so the first thing you see is the village, not a wall.
 */
export function generateRoom(index: number, totalRooms: number, rng: RNG): RoomPlan {
  const kind = roomKindForDepth(index, totalRooms, rng);
  const config = KIND_CONFIG[kind];

  // Arenas grow only slightly with depth. Earlier tuning at 3% per room reached
  // four screens across by the finale, which turned late fights into long walks.
  const growth = 1 + index * 0.012;
  const width = Math.round(config.size[0] * growth * rng.range(0.94, 1.08));
  const height = Math.round(config.size[1] * growth * rng.range(0.94, 1.08));
  const bounds: Rect = { x: 0, y: 0, w: width, h: height };

  const cx = width / 2;
  const cy = height / 2;

  const buildings: PlannedBuilding[] = [];
  const margin = 90;

  // --- plaza ---------------------------------------------------------------
  const plazaRadius = Math.min(width, height) * rng.range(0.14, 0.2);
  const plaza: Rect = {
    x: cx - plazaRadius,
    y: cy - plazaRadius,
    w: plazaRadius * 2,
    h: plazaRadius * 2,
  };

  // A well or chapel marks the centre — a landmark to orient by.
  if (kind === 'shrine' || kind === 'boss') {
    pushBuilding(buildings, { kind: 'chapel', rect: centred(cx, cy, 130, 86) });
  } else {
    pushBuilding(buildings, { kind: 'well', rect: centred(cx, cy, 46, 46) });
  }

  // --- houses --------------------------------------------------------------
  const target = rng.int(config.buildingCount[0], config.buildingCount[1]) + Math.floor(index / 3);
  let attempts = 0;

  while (buildings.length < target && attempts < target * 40) {
    attempts++;

    const buildingKind = rng.pick(config.palette);
    const size = buildingSize(buildingKind, rng);

    // Ring distribution: most structures sit between the plaza and the outskirts.
    const angle = rng.next() * TAU;
    const minR = plazaRadius + 60;
    const maxR = Math.min(width, height) * 0.42;
    const radius = minR + Math.pow(rng.next(), 0.7) * (maxR - minR);

    const rect: Rect = {
      x: clamp(cx + Math.cos(angle) * radius - size.w / 2, margin, width - margin - size.w),
      y: clamp(cy + Math.sin(angle) * radius - size.h / 2, margin, height - margin - size.h),
      w: size.w,
      h: size.h,
    };

    if (overlapsAny(rect, buildings, 34)) continue;
    if (rectsOverlap(rect, plaza)) continue;

    pushBuilding(buildings, { kind: buildingKind, rect });
  }

  // --- palisade ------------------------------------------------------------
  if (config.palisade) addPalisade(buildings, bounds, rng);

  // --- monster entry -------------------------------------------------------
  // Enter from whichever edge has the least construction near it.
  const monsterStart = pickEntry(bounds, buildings, rng);
  // Push the exit to the opposite side, so clearing the room means crossing it.
  const exit: Vec2 = {
    x: clamp(width - monsterStart.x, margin, width - margin),
    y: clamp(height - monsterStart.y, margin, height - margin),
  };

  // Clear a breathing space around the entry and the portal. Without this a
  // palisade or house can spawn flush against the entry and wall the player in
  // on their first step.
  clearArea(buildings, monsterStart.x, monsterStart.y, 170);
  clearArea(buildings, exit.x, exit.y, 130);

  // --- relics ---------------------------------------------------------------
  // Every settlement holds at least one, so the transformation mechanic is met in
  // the first room and never depends on a lucky building drop.
  const relics = placeRelics(index, kind, bounds, buildings, monsterStart, rng);

  // --- defenders -----------------------------------------------------------
  const spawns = planSpawns(index, kind, config, bounds, buildings, monsterStart, rng);

  const name =
    kind === 'boss'
      ? `${rng.pick(NAME_ROOT.boss)} Инквизиции`
      : `${rng.pick(NAME_PREFIX)} ${rng.pick(NAME_ROOT[kind])}`;

  return {
    index,
    kind,
    name,
    bounds,
    buildings,
    spawns,
    monsterStart,
    exit,
    relics,
    groundSeed: rng.int(0, 100000),
    wallThickness: WALL_THICKNESS,
    isBoss: kind === 'boss',
  };
}

// ---------------------------------------------------------------------------

function centred(cx: number, cy: number, w: number, h: number): Rect {
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function pushBuilding(list: PlannedBuilding[], building: PlannedBuilding): void {
  list.push(building);
}

function buildingSize(kind: BuildingKind, rng: RNG): { w: number; h: number } {
  switch (kind) {
    case 'hut':
      return { w: rng.range(52, 70), h: rng.range(44, 58) };
    case 'house':
      return { w: rng.range(72, 96), h: rng.range(54, 70) };
    case 'longhouse':
      return { w: rng.range(120, 165), h: rng.range(58, 74) };
    case 'granary':
      return { w: rng.range(62, 80), h: rng.range(62, 80) };
    case 'chapel':
      return { w: rng.range(110, 140), h: rng.range(74, 92) };
    case 'watchtower':
      return { w: rng.range(52, 64), h: rng.range(52, 64) };
    case 'well':
      return { w: 46, h: 46 };
    case 'cart':
      return { w: rng.range(44, 58), h: rng.range(26, 34) };
    case 'stack':
      return { w: rng.range(34, 48), h: rng.range(34, 46) };
    case 'palisade':
      return { w: 120, h: 16 };
    case 'wall':
      return { w: 160, h: 22 };
  }
}

/** Delete every structure whose rect comes within `radius` of a point. */
function clearArea(buildings: PlannedBuilding[], x: number, y: number, radius: number): void {
  for (let i = buildings.length - 1; i >= 0; i--) {
    const r = buildings[i]!.rect;
    const nearestX = clamp(x, r.x, r.x + r.w);
    const nearestY = clamp(y, r.y, r.y + r.h);
    if (Math.hypot(x - nearestX, y - nearestY) < radius) buildings.splice(i, 1);
  }
}

function overlapsAny(rect: Rect, buildings: PlannedBuilding[], padding: number): boolean {
  const padded: Rect = {
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2,
  };
  for (const b of buildings) {
    if (rectsOverlap(padded, b.rect)) return true;
  }
  return false;
}

/**
 * Ring of palisade segments with two gates. Gaps matter: a fully sealed ring would
 * just be an invisible wall, while gates create chokepoints archers can hold.
 */
function addPalisade(buildings: PlannedBuilding[], bounds: Rect, rng: RNG): void {
  const inset = 56;
  const seg = 120;
  const gateA = rng.int(0, 3);
  let gateB = rng.int(0, 3);
  if (gateB === gateA) gateB = (gateB + 2) % 4;

  const sides: Array<{ horizontal: boolean; fixed: number; from: number; to: number }> = [
    { horizontal: true, fixed: bounds.y + inset, from: bounds.x + inset, to: bounds.x + bounds.w - inset },
    { horizontal: true, fixed: bounds.y + bounds.h - inset, from: bounds.x + inset, to: bounds.x + bounds.w - inset },
    { horizontal: false, fixed: bounds.x + inset, from: bounds.y + inset, to: bounds.y + bounds.h - inset },
    { horizontal: false, fixed: bounds.x + bounds.w - inset, from: bounds.y + inset, to: bounds.y + bounds.h - inset },
  ];

  sides.forEach((side, sideIndex) => {
    const length = side.to - side.from;
    const count = Math.floor(length / seg);
    // The gate sits in the middle third of its side.
    const gateIndex = sideIndex === gateA || sideIndex === gateB ? Math.floor(count / 2) : -1;

    for (let i = 0; i < count; i++) {
      if (i === gateIndex || i === gateIndex + 1) continue;
      const start = side.from + i * seg;
      const rect: Rect = side.horizontal
        ? { x: start, y: side.fixed - 8, w: seg - 4, h: 16 }
        : { x: side.fixed - 8, y: start, w: 16, h: seg - 4 };
      buildings.push({ kind: 'palisade', rect });
    }
  });
}

function pickEntry(bounds: Rect, buildings: PlannedBuilding[], rng: RNG): Vec2 {
  const margin = 70;
  const candidates: Vec2[] = [
    { x: bounds.x + margin, y: bounds.y + bounds.h / 2 },
    { x: bounds.x + bounds.w - margin, y: bounds.y + bounds.h / 2 },
    { x: bounds.x + bounds.w / 2, y: bounds.y + margin },
    { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h - margin },
  ];

  let best = candidates[0]!;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    // Prefer the emptiest approach, with a nudge of randomness so the entry side
    // isn't perfectly predictable.
    let score = rng.range(0, 120);
    for (const b of buildings) {
      const bx = b.rect.x + b.rect.w / 2;
      const by = b.rect.y + b.rect.h / 2;
      score += Math.hypot(bx - candidate.x, by - candidate.y) * 0.02;
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/**
 * Fill the room's point budget with defenders.
 *
 * Composition rules: civilians always outnumber soldiers in small settlements,
 * ranged units are placed near cover, and every room keeps at least a couple of
 * bodies right in the plaza so the fight starts immediately.
 */
function planSpawns(
  index: number,
  kind: RoomKind,
  config: KindConfig,
  bounds: Rect,
  buildings: PlannedBuilding[],
  monsterStart: Vec2,
  rng: RNG,
): PlannedSpawn[] {
  const spawns: PlannedSpawn[] = [];

  if (kind === 'boss') {
    spawns.push({ id: 'inquisitor', x: bounds.w / 2, y: bounds.h / 2 });
  }

  // Raised from 8 to cover the guaranteed ranged defender, which otherwise ate
  // most of a first room's budget on its own.
  let budget = (11 + index * 5) * config.enemyBudgetScale;

  const available = (Object.keys(HUMAN_ARCHETYPES) as HumanId[]).filter((id) => {
    const a = HUMAN_ARCHETYPES[id];
    return a.spawnWeight > 0 && a.minDepth <= index;
  });

  // Watchtowers get a ballista each; that's what makes them worth destroying.
  // It sits just below the tower rather than inside it — a turret that cannot be
  // reached or shot at would stop the room from ever being cleared.
  for (const building of buildings) {
    if (building.kind !== 'watchtower') continue;
    spawns.push({
      id: 'ballista',
      x: building.rect.x + building.rect.w / 2,
      y: building.rect.y + building.rect.h + 26,
    });
    budget -= SPAWN_COST.ballista * 0.5;
  }

  // Guarantee a ranged presence from the very first room. A settlement defended
  // only by people who run at you teaches the wrong lesson about positioning.
  const rangedPool = available.filter((id) => {
    const role = HUMAN_ARCHETYPES[id].role;
    return role === 'ranged' || role === 'support';
  });
  if (rangedPool.length > 0) {
    const guaranteed = 1 + Math.floor(index / 3);
    for (let i = 0; i < guaranteed && budget > 0; i++) {
      const id = rng.pick(rangedPool);
      budget -= SPAWN_COST[id];
      const point = placementFor(id, bounds, buildings, monsterStart, rng);
      spawns.push({ id, x: point.x, y: point.y });
    }
  }

  let guard = 0;
  while (budget > 0 && guard++ < 400) {
    const id = rng.pickWeighted(available, (candidate) => {
      const a = HUMAN_ARCHETYPES[candidate];
      // Later rooms shift the mix away from civilians toward real soldiers.
      const civilianFalloff = a.role === 'civilian' ? Math.max(0.15, 1 - index * 0.12) : 1;
      return a.spawnWeight * civilianFalloff;
    });

    const cost = SPAWN_COST[id];
    if (cost > budget + 1.5) break;
    budget -= cost;

    const point = placementFor(id, bounds, buildings, monsterStart, rng);
    spawns.push({ id, x: point.x, y: point.y });
  }

  return spawns;
}

function placementFor(
  id: HumanId,
  bounds: Rect,
  buildings: PlannedBuilding[],
  monsterStart: Vec2,
  rng: RNG,
): Vec2 {
  const archetype = HUMAN_ARCHETYPES[id];
  const minDistanceFromEntry = 380;

  for (let attempt = 0; attempt < 30; attempt++) {
    let x: number;
    let y: number;

    // Ranged units hug buildings for cover; everyone else roams the open ground.
    const nearBuilding = archetype.role === 'ranged' || archetype.role === 'support' || rng.bool(0.45);
    const structures = buildings.filter((b) => b.kind !== 'palisade' && b.kind !== 'wall');

    if (nearBuilding && structures.length > 0) {
      const host = rng.pick(structures);
      const angle = rng.next() * TAU;
      const radius = rng.range(38, 96);
      x = host.rect.x + host.rect.w / 2 + Math.cos(angle) * radius;
      y = host.rect.y + host.rect.h / 2 + Math.sin(angle) * radius;
    } else {
      x = rng.range(bounds.x + 90, bounds.x + bounds.w - 90);
      y = rng.range(bounds.y + 90, bounds.y + bounds.h - 90);
    }

    x = clamp(x, bounds.x + 60, bounds.x + bounds.w - 60);
    y = clamp(y, bounds.y + 60, bounds.y + bounds.h - 60);

    if (Math.hypot(x - monsterStart.x, y - monsterStart.y) < minDistanceFromEntry) continue;
    if (insideAnyBuilding(x, y, buildings)) continue;

    return { x, y };
  }

  // Fallback: centre of the arena is always valid enough to avoid a failed spawn.
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

function insideAnyBuilding(x: number, y: number, buildings: PlannedBuilding[]): boolean {
  for (const b of buildings) {
    const r = b.rect;
    if (x > r.x - 14 && x < r.x + r.w + 14 && y > r.y - 14 && y < r.y + r.h + 14) return true;
  }
  return false;
}
