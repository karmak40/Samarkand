import {
  ARENA_WALL_THICKNESS,
  BIOME_1_BOSS_WEIGHTS,
  BIOME_ROOM_COUNT,
  CIVILIAN_FALLOFF_FLOOR,
  CIVILIAN_FALLOFF_PER_DEPTH,
  ELITE_CHAMPIONS_EARLY,
  ELITE_CHAMPIONS_LATE,
  ELITE_CHAMPIONS_LATE_MIN_DEPTH,
  EARLY_ROOM_DIFFICULTY,
  earlyRoomDifficultyFraction,
  ENEMY_BUDGET_BASE,
  ENEMY_BUDGET_PER_DEPTH,
  EXTRA_BUILDINGS_PER_DEPTH_DIVISOR,
  GUARANTEED_RANGED_BASE,
  GUARANTEED_RANGED_PER_DEPTH_DIVISOR,
  RELIC_COUNT,
  ROOM_KIND_CONFIG,
  type RoomKindConfig,
  ROOM_KIND_ROLL,
  ROOM_SIZE_GROWTH_PER_DEPTH,
  SPAWN_COST,
  TURRET_BUDGET_FRACTION,
  WARCAMP_BOSS_ID,
  WARCAMP_STRONGHOLD_COUNT,
} from '../balance';
import { type BuildingKind } from '../entities/building';
import { HUMAN_ARCHETYPES, type BossId, type HumanId } from '../entities/human';
import { clamp, type Rect, rectsOverlap, segmentRectHit, TAU, type Vec2 } from '../core/math';
import { RNG } from '../core/rng';
import { roomNameBossSuffix, roomNamePrefixes, roomNameRoots } from '../i18n';

export type RoomKind = 'hamlet' | 'village' | 'fortified' | 'shrine' | 'elite' | 'boss';

/** What the run map asked for. `battle` is expanded into one of the flavour kinds. */
export type ArenaRequest = 'battle' | 'elite' | 'boss';

/**
 * Rooms per biome/map. The run generates one biome's worth of map at a time — see
 * `Game.generateBiome` — so this is also the single source of truth both sides
 * share for how deep each biome's own map goes. The actual count lives in
 * `../balance`'s `BIOME_ROOM_COUNT`; re-exported under this name since every call
 * site already imports `BIOME_ROOMS` from here.
 */
export const BIOME_ROOMS = BIOME_ROOM_COUNT;

export interface PlannedBuilding {
  kind: BuildingKind;
  rect: Rect;
}

export interface PlannedSpawn {
  id: HumanId;
  x: number;
  y: number;
  /** Index into `RoomPlan.buildings`, for a turret shielded by its own tower. */
  mountedBuildingIndex?: number;
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
  /** Which boss holds this room. Only set on the boss arena. */
  bossId: HumanId | null;
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
  /** Which biome this room belongs to — the terrain palette reads this. */
  biome: 1 | 2;
}

/**
 * Flavour for an ordinary fight.
 *
 * The run map decides *what kind of stop* a node is; this only picks how a plain
 * settlement looks, so consecutive battles don't feel identical.
 */
export function roomKindForDepth(index: number, rng: RNG): RoomKind {
  const roll = ROOM_KIND_ROLL;
  if (index === 0) return 'hamlet';
  if (index % roll.shrineInterval === roll.shrineOffset) return 'shrine';
  if (index >= roll.fortifiedMinDepth && rng.bool(roll.fortifiedChance)) return 'fortified';
  return rng.bool(roll.hamletChance) ? 'hamlet' : 'village';
}

/** Depth of the boulder/masonry band drawn around every arena. */
const WALL_THICKNESS = ARENA_WALL_THICKNESS;

// The actual per-flavour layout/difficulty numbers live in ../balance's
// ROOM_KIND_CONFIG now -- this alias keeps every local reference working.
const KIND_CONFIG = ROOM_KIND_CONFIG;
type KindConfig = RoomKindConfig;

/**
 * Builds a settlement.
 *
 * Layout method: a plaza anchors the centre, buildings are placed by rejection
 * sampling on a loose ring around it, and defenders spawn near the structures they
 * would plausibly be guarding. The monster always starts at the arena edge furthest
 * from the densest cluster, so the first thing you see is the village, not a wall.
 *
 * `index` drives every difficulty curve (arena size, spawn budget, pacing) and is
 * *not* always the room's position within `biome` — a run that reaches the war-camp
 * by clearing the first biome keeps counting up from where that left off, while a
 * war-camp run started directly from the menu counts from 0 like any fresh run.
 * `biome` alone decides which content (roster, terrain, boss) shows up.
 */
export function generateRoom(
  index: number,
  rng: RNG,
  request: ArenaRequest = 'battle',
  biome: 1 | 2 = 1,
): RoomPlan {
  const kind: RoomKind =
    request === 'boss' ? 'boss' : request === 'elite' ? 'elite' : roomKindForDepth(index, rng);
  const config = KIND_CONFIG[kind];
  // The war-camp fields a stronghold or two wherever it would otherwise field a
  // watchtower — the building `planSpawns` pairs a siege engine with, the same way
  // a watchtower is paired with a ballista.
  const palette =
    biome === 2 && (kind === 'fortified' || kind === 'elite' || kind === 'boss')
      ? [...config.palette, ...Array<BuildingKind>(WARCAMP_STRONGHOLD_COUNT).fill('stronghold')]
      : config.palette;

  // Arenas grow only slightly with depth. Earlier tuning at 3% per room reached
  // four screens across by the finale, which turned late fights into long walks.
  const growth = 1 + index * ROOM_SIZE_GROWTH_PER_DEPTH;
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
  const target =
    rng.int(config.buildingCount[0], config.buildingCount[1]) +
    Math.floor(index / EXTRA_BUILDINGS_PER_DEPTH_DIVISOR);
  let attempts = 0;

  while (buildings.length < target && attempts < target * 40) {
    attempts++;

    const buildingKind = rng.pick(palette);
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
  // Drawn from the run seed, so the finale differs between runs and every player
  // on a daily seed faces the same one. The war-camp's boss is fixed rather than
  // rolled — the Khagan is the run's real ending, not one of three interchangeable
  // finales the way the first biome's boss is.
  const bossId: HumanId | null =
    kind === 'boss'
      ? biome === 2
        ? WARCAMP_BOSS_ID
        : rng.pickWeighted(
            Object.keys(BIOME_1_BOSS_WEIGHTS) as BossId[],
            (id) => BIOME_1_BOSS_WEIGHTS[id],
          )
      : null;
  const spawns = planSpawns(index, kind, config, bounds, buildings, monsterStart, rng, bossId, biome);

  const name =
    kind === 'boss'
      ? `${rng.pick(roomNameRoots('boss'))} ${roomNameBossSuffix(bossId ?? 'inquisitor')}`
      : `${rng.pick(roomNamePrefixes())} ${rng.pick(roomNameRoots(kind))}`;

  return {
    index,
    kind,
    name,
    bounds,
    buildings,
    spawns,
    monsterStart,
    exit,
    bossId,
    relics,
    groundSeed: rng.int(0, 100000),
    wallThickness: WALL_THICKNESS,
    isBoss: kind === 'boss',
    biome,
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
    case 'stronghold':
      return { w: rng.range(130, 165), h: rng.range(110, 140) };
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

/**
 * Scatter relics through the settlement.
 *
 * They sit away from the entry — a relic you can grab before the fight starts is a
 * free win — and away from each other, so collecting one means crossing contested
 * ground rather than hoovering up a pile.
 */
function placeRelics(
  index: number,
  kind: RoomKind,
  bounds: Rect,
  buildings: PlannedBuilding[],
  monsterStart: Vec2,
  rng: RNG,
): Vec2[] {
  // Elites promise a relic and must deliver two, since they are the reason to pick
  // the harder branch at all.
  const count =
    kind === 'boss'
      ? RELIC_COUNT.boss
      : kind === 'elite'
        ? RELIC_COUNT.elite
        : RELIC_COUNT.battleBase + (index >= RELIC_COUNT.battleBonusMinDepth ? 1 : 0);
  const placed: Vec2[] = [];
  const minFromEntry = 420;
  const minApart = 300;

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = rng.range(bounds.x + 110, bounds.x + bounds.w - 110);
      const y = rng.range(bounds.y + 110, bounds.y + bounds.h - 110);

      if (Math.hypot(x - monsterStart.x, y - monsterStart.y) < minFromEntry) continue;
      if (insideAnyBuilding(x, y, buildings)) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minApart)) continue;

      placed.push({ x, y });
      break;
    }
  }

  // A settlement with none at all would silently drop the mechanic for that room.
  if (placed.length === 0) {
    placed.push({ x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.35 });
  }
  return placed;
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
  bossId: HumanId | null,
  biome: 1 | 2,
): PlannedSpawn[] {
  const spawns: PlannedSpawn[] = [];

  // An elite garrison is defined by *who* holds it, not by how many. Champions are
  // seeded first so the fight has a shape even before the budget is spent.
  if (kind === 'elite') {
    const champions = index >= ELITE_CHAMPIONS_LATE_MIN_DEPTH ? ELITE_CHAMPIONS_LATE : ELITE_CHAMPIONS_EARLY;
    for (const id of champions) {
      const point = placementFor(id, bounds, buildings, monsterStart, rng);
      spawns.push({ id, x: point.x, y: point.y });
    }
  }

  if (kind === 'boss') {
    spawns.push({ id: bossId ?? 'inquisitor', x: bounds.w / 2, y: bounds.h / 2 });
  }

  // Raised from 8 to cover the guaranteed ranged defender, which otherwise ate
  // most of a first room's budget on its own.
  let budget = (ENEMY_BUDGET_BASE + index * ENEMY_BUDGET_PER_DEPTH) * config.enemyBudgetScale;
  budget *= 1 + EARLY_ROOM_DIFFICULTY.budgetBonus * earlyRoomDifficultyFraction(index);

  const available = (Object.keys(HUMAN_ARCHETYPES) as HumanId[]).filter((id) => {
    const a = HUMAN_ARCHETYPES[id];
    return a.enabled && a.spawnWeight > 0 && a.minDepth <= index && (a.minBiome ?? 1) <= biome;
  });

  // Watchtowers field a ballista each, and a stronghold fields a siege engine —
  // shielded by the tower it stands on, so it's the tower that's actually worth
  // destroying. It's stood right against the wall facing the plaza, which both
  // sells "on the wall" and guarantees the tower itself can never block its own
  // sight line. If that spot is somehow blocked (a dense building cluster), fall
  // back to the old open-ground placement rather than dropping the unit — it
  // stays shielded by the same tower either way, just visually a step removed.
  for (let i = 0; i < buildings.length; i++) {
    const building = buildings[i]!;
    const turretId = building.kind === 'watchtower' ? 'ballista' : building.kind === 'stronghold' ? 'siegeEngine' : null;
    if (!turretId || !HUMAN_ARCHETYPES[turretId].enabled) continue;
    const radius = HUMAN_ARCHETYPES[turretId].radius;
    const spot = placeOnWall(building.rect, bounds, buildings, radius) ?? placeTurret(building.rect, bounds, buildings, rng);
    if (!spot) continue;
    spawns.push({ id: turretId, x: spot.x, y: spot.y, mountedBuildingIndex: i });
    budget -= SPAWN_COST[turretId] * TURRET_BUDGET_FRACTION;
  }

  // Guarantee a ranged presence from the very first room. A settlement defended
  // only by people who run at you teaches the wrong lesson about positioning.
  const rangedPool = available.filter((id) => {
    const role = HUMAN_ARCHETYPES[id].role;
    return role === 'ranged' || role === 'support';
  });
  if (rangedPool.length > 0) {
    const guaranteed = GUARANTEED_RANGED_BASE + Math.floor(index / GUARANTEED_RANGED_PER_DEPTH_DIVISOR);
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
      const civilianFalloff =
        a.role === 'civilian' ? Math.max(CIVILIAN_FALLOFF_FLOOR, 1 - index * CIVILIAN_FALLOFF_PER_DEPTH) : 1;
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

/**
 * Stand a turret right against its own tower, on the face closest to the plaza.
 *
 * Whichever axis points more directly at the arena centre decides which edge —
 * that's also the edge a rect can never occlude sight to a point sitting on it, so
 * this alone is enough to guarantee the defender stays reachable without the
 * spiral search `placeTurret` needs for open-ground placement.
 */
function placeOnWall(
  tower: Rect,
  bounds: Rect,
  buildings: PlannedBuilding[],
  unitRadius: number,
): Vec2 | null {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const towerCx = tower.x + tower.w / 2;
  const towerCy = tower.y + tower.h / 2;
  const dx = cx - towerCx;
  const dy = cy - towerCy;
  const gap = unitRadius + 6;

  const spot =
    Math.abs(dx) / tower.w > Math.abs(dy) / tower.h
      ? { x: towerCx + Math.sign(dx || 1) * (tower.w / 2 + gap), y: towerCy }
      : { x: towerCx, y: towerCy + Math.sign(dy || 1) * (tower.h / 2 + gap) };

  const x = clamp(spot.x, bounds.x + 40, bounds.x + bounds.w - 40);
  const y = clamp(spot.y, bounds.y + 40, bounds.y + bounds.h - 40);
  if (insideAnyBuilding(x, y, buildings)) return null;
  return { x, y };
}

/**
 * Find open ground for an immobile siege engine.
 *
 * Requires a clear line to the arena centre through every sight-blocking structure.
 * Without that guarantee a turret can sit forever in a blind spot, and since it can
 * neither move nor be shot the settlement can never be cleared.
 */
function placeTurret(
  tower: Rect,
  bounds: Rect,
  buildings: PlannedBuilding[],
  rng: RNG,
): Vec2 | null {
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  const originX = tower.x + tower.w / 2;
  const originY = tower.y + tower.h / 2;

  for (let attempt = 0; attempt < 48; attempt++) {
    // Spiral outward from the tower so the engine still reads as belonging to it.
    const angle = rng.next() * TAU;
    const distance = 70 + attempt * 6;
    const x = clamp(originX + Math.cos(angle) * distance, bounds.x + 80, bounds.x + bounds.w - 80);
    const y = clamp(originY + Math.sin(angle) * distance, bounds.y + 80, bounds.y + bounds.h - 80);

    if (insideAnyBuilding(x, y, buildings)) continue;
    if (!hasClearLine(x, y, cx, cy, buildings)) continue;
    return { x, y };
  }
  return null;
}

/** Segment test against every structure that stops sight. */
function hasClearLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  buildings: PlannedBuilding[],
): boolean {
  for (const building of buildings) {
    if (!OPAQUE_KINDS.has(building.kind)) continue;
    if (segmentRectHit(ax, ay, bx, by, building.rect)) return false;
  }
  return true;
}

/** Mirrors `BuildingProfile.opaque`; kept here so planning needs no live entities. */
const OPAQUE_KINDS = new Set<BuildingKind>([
  'hut',
  'house',
  'longhouse',
  'granary',
  'chapel',
  'watchtower',
  'stronghold',
  'wall',
]);

function insideAnyBuilding(x: number, y: number, buildings: PlannedBuilding[]): boolean {
  for (const b of buildings) {
    const r = b.rect;
    if (x > r.x - 14 && x < r.x + r.w + 14 && y > r.y - 14 && y < r.y + r.h + 14) return true;
  }
  return false;
}
