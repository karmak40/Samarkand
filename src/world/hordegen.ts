import { ARENA_WALL_THICKNESS, HORDE_ARENA_CONFIG } from '../balance';
import { clamp, type Rect, type Vec2 } from '../core/math';
import { RNG } from '../core/rng';
import { type BuildingKind } from '../entities/building';
import { t } from '../i18n';
import {
  buildingSize,
  clearArea,
  overlapsAny,
  placeRelics,
  pushBuilding,
  type PlannedBuilding,
  type RoomPlan,
} from './roomgen';

export interface HordeArena {
  plan: RoomPlan;
  /** Corridor mouths waves march in from — horde-only, not part of `RoomPlan`. */
  spawnPoints: Vec2[];
}

/**
 * Builds a Horde arena: a wide, shallow rectangle with buildings laid out in
 * parallel lanes instead of the campaign's ring-around-a-plaza village. The
 * result drops straight into the normal renderer/world reset (`kind: 'fortified'`,
 * `biome: 2` reuse the existing war-camp terrain skin and building roster — see
 * `terrain.ts`), so nothing downstream needs to know this room was generated
 * differently.
 *
 * `level` only seeds the relic count/flavour (via `placeRelics`) — actual
 * difficulty comes from `hordeDifficultyTier` (see `hordewaves.ts`), driven by
 * elapsed survival time, not by anything in this plan.
 */
export function generateHordeArena(level: number, rng: RNG): HordeArena {
  const cfg = HORDE_ARENA_CONFIG;
  const width = cfg.width;
  const height = cfg.height;
  const bounds: Rect = { x: 0, y: 0, w: width, h: height };
  const buildings: PlannedBuilding[] = [];
  const margin = 90;

  // The height splits into `lanes * 2 + 1` bands, alternating clear travel
  // corridor / building row / clear / building row / ... / clear — so every
  // building lane has an open lane on both sides of it to march or retreat along.
  const lanes = cfg.lanes;
  const bandH = height / (lanes * 2 + 1);

  for (let lane = 0; lane < lanes; lane++) {
    const bandY = bandH * (lane * 2 + 1);
    const rowCenterY = bandY + bandH / 2;
    const count = rng.int(cfg.buildingsPerLane[0], cfg.buildingsPerLane[1]);

    let x = margin + rng.range(0, 120);
    for (let i = 0; i < count; i++) {
      const kind: BuildingKind = rng.pick(cfg.palette);
      const size = buildingSize(kind, rng);
      // Keep the building inside its own band so it never bleeds into a
      // neighbouring travel corridor.
      const h = Math.min(size.h, bandH - 20);
      const rect: Rect = {
        x,
        y: clamp(rowCenterY - h / 2, bandY, bandY + bandH - h),
        w: size.w,
        h,
      };
      if (rect.x + rect.w > width - margin) break;
      if (!overlapsAny(rect, buildings, 30)) pushBuilding(buildings, { kind, rect });
      x += size.w + rng.range(70, 160);
    }
  }

  // The monster enters at the left edge, centred.
  const monsterStart: Vec2 = { x: margin + 20, y: height / 2 };
  clearArea(buildings, monsterStart.x, monsterStart.y, 170);

  // Cosmetic only in Horde mode — survival is time-based, not exit-based — but
  // mirrors the campaign's own "opposite the entry" convention for consistency.
  const exit: Vec2 = {
    x: clamp(width - monsterStart.x, margin, width - margin),
    y: clamp(height - monsterStart.y, margin, height - margin),
  };
  clearArea(buildings, exit.x, exit.y, 130);

  const spawnPoints = buildSpawnPoints(bounds, monsterStart, margin);
  for (const point of spawnPoints) clearArea(buildings, point.x, point.y, 80);

  const relics = placeRelics(level, 'fortified', bounds, buildings, monsterStart, rng);

  const plan: RoomPlan = {
    index: level,
    kind: 'fortified',
    name: t('horde.arenaName', { level }),
    bounds,
    buildings,
    spawns: [],
    reinforcements: [],
    monsterStart,
    exit,
    bossId: null,
    relics,
    groundSeed: rng.int(0, 100000),
    wallThickness: ARENA_WALL_THICKNESS,
    isBoss: false,
    biome: 2,
  };

  return { plan, spawnPoints };
}

/**
 * Wave-spawn gates around the whole perimeter of the arena — every edge, not just
 * the one opposite the entry, so a Horde fight surrounds the player instead of
 * assaulting from one direction. Units spawned here already march toward the
 * monster on their own (the standard alerted-unit chase every human archetype
 * already has) — this only decides where they first appear.
 *
 * A gate that would land on top of the monster's own entry point is dropped
 * rather than nudged, so the true count can come out a couple short of
 * `spawnGatesPerEdge * 4` depending on where `monsterStart` sits.
 */
function buildSpawnPoints(bounds: Rect, monsterStart: Vec2, margin: number): Vec2[] {
  const gates = Math.max(1, HORDE_ARENA_CONFIG.spawnGatesPerEdge);
  const points: Vec2[] = [];

  for (let i = 0; i < gates; i++) {
    const y = margin + ((bounds.h - margin * 2) * (i + 0.5)) / gates;
    points.push({ x: margin, y });
    points.push({ x: bounds.w - margin, y });
  }
  for (let i = 0; i < gates; i++) {
    const x = margin + ((bounds.w - margin * 2) * (i + 0.5)) / gates;
    points.push({ x, y: margin });
    points.push({ x, y: bounds.h - margin });
  }

  // A gate spawned on top of the monster's own entry would be an unfair opening
  // hit before the player has even had a chance to move.
  const minDistFromStart = 260;
  return points.filter((p) => Math.hypot(p.x - monsterStart.x, p.y - monsterStart.y) >= minDistFromStart);
}
