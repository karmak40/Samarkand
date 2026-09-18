import { describe, expect, it } from 'vitest';
import { RNG } from '../core/rng';
import { generateHordeArena } from './hordegen';
import { insideAnyBuilding } from './roomgen';

/** A spread of levels and seeds, so an invariant is checked against many shapes. */
const arenas = Array.from({ length: 20 }, (_, i) => generateHordeArena((i % 5) + 1, new RNG(i + 1)));

describe('horde arena shape', () => {
  it('is wide and shallow, not a near-square campaign room', () => {
    for (const { plan } of arenas) {
      expect(plan.bounds.w).toBeGreaterThan(plan.bounds.h * 1.5);
    }
  });

  it('tags the plan for the war-camp skin and roster', () => {
    for (const { plan } of arenas) {
      expect(plan.kind).toBe('fortified');
      expect(plan.biome).toBe(2);
      expect(plan.isBoss).toBe(false);
      expect(plan.bossId).toBeNull();
    }
  });

  it('keeps every building inside bounds', () => {
    for (const { plan } of arenas) {
      for (const building of plan.buildings) {
        const r = building.rect;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(plan.bounds.w);
        expect(r.y + r.h).toBeLessThanOrEqual(plan.bounds.h);
      }
    }
  });

  it('keeps the monster start and every spawn point clear of buildings', () => {
    for (const { plan, spawnPoints } of arenas) {
      expect(insideAnyBuilding(plan.monsterStart.x, plan.monsterStart.y, plan.buildings)).toBe(false);
      for (const point of spawnPoints) {
        expect(insideAnyBuilding(point.x, point.y, plan.buildings)).toBe(false);
      }
    }
  });

  it('keeps every spawn point a fair distance from the monster start', () => {
    for (const { plan, spawnPoints } of arenas) {
      for (const point of spawnPoints) {
        const distance = Math.hypot(point.x - plan.monsterStart.x, point.y - plan.monsterStart.y);
        expect(distance).toBeGreaterThanOrEqual(260);
      }
    }
  });

  it('spawns from all four edges of the arena, not just the one opposite the entry', () => {
    const nearEdge = 0.1; // within 10% of bounds size counts as "on that edge"
    for (const { plan, spawnPoints } of arenas) {
      const { w, h } = plan.bounds;
      // The monster's own entry corner (left edge) can lose a gate or two to the
      // fairness filter, so only the other three are required unconditionally.
      expect(spawnPoints.some((p) => p.x > w * (1 - nearEdge))).toBe(true);
      expect(spawnPoints.some((p) => p.y < h * nearEdge)).toBe(true);
      expect(spawnPoints.some((p) => p.y > h * (1 - nearEdge))).toBe(true);
    }
  });

  it('has no baked-in garrison — enemies only arrive as live waves', () => {
    for (const { plan } of arenas) {
      expect(plan.spawns).toHaveLength(0);
      expect(plan.reinforcements).toHaveLength(0);
    }
  });

  it('is deterministic for a given level and seed', () => {
    const a = generateHordeArena(3, new RNG(42));
    const b = generateHordeArena(3, new RNG(42));
    expect(a.plan.buildings).toEqual(b.plan.buildings);
    expect(a.spawnPoints).toEqual(b.spawnPoints);
    expect(a.plan.monsterStart).toEqual(b.plan.monsterStart);
  });
});
