import {
  type DamageOptions,
  type DamageResult,
  type Defenses,
  dominantType,
  mitigate,
  rawTotal,
} from '../combat/damage';
import { StatusContainer } from '../combat/status';
import type { World } from '../world/world';

export type Faction = 'monster' | 'human' | 'neutral';

let nextEntityId = 1;

/** Anything that lives in the world, moves and draws. */
export abstract class Entity {
  readonly id = nextEntityId++;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  radius = 12;
  alive = true;
  faction: Faction = 'neutral';

  /** Draw order: higher renders on top. Defaults to y-sorting in the renderer. */
  layer = 0;

  /** Seconds this entity has existed — drives idle animation phase. */
  age = 0;

  abstract update(dt: number, world: World): void;
  abstract draw(ctx: CanvasRenderingContext2D, world: World): void;

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  distanceTo(other: { x: number; y: number }): number {
    return Math.hypot(other.x - this.x, other.y - this.y);
  }

  /** Removes the entity at the end of the frame. */
  destroy(): void {
    this.alive = false;
  }
}

export interface DeathContext {
  /** Who landed the killing blow, when known. */
  killer: Combatant | null;
  sourceLabel: string;
  overkill: number;
}

/**
 * An entity with health that can be damaged, statused and killed.
 * Owns the full damage pipeline so monster and humans resolve hits identically.
 */
export abstract class Combatant extends Entity {
  hp = 1;
  maxHp = 1;
  readonly statuses = new StatusContainer();

  /** 0..1, decays each frame; drives the white hit flash. */
  hitFlash = 0;
  /** Colour of the last hit, so elemental damage flashes in its own colour. */
  hitFlashColor = '#ffffff';

  /** Brief window after taking a hit during which further hits are ignored. */
  invulnerable = 0;

  /** Absorbs damage before HP. */
  shield = 0;

  /** Set on death so effects can react before the entity is culled. */
  deathTime = -1;

  abstract defenses(): Defenses;

  /** Called once when hp reaches zero. Implementations drop loot, spawn gibs, etc. */
  protected abstract onDeath(world: World, ctx: DeathContext): void;

  /** Hook for reacting to a landed hit (thorns, rage, on-hit procs). */
  protected onDamaged(_world: World, _result: DamageResult, _options: DamageOptions): void {}

  /** Hook for stats/telemetry; separated so subclasses can attribute correctly. */
  protected recordDamage(_world: World, _result: DamageResult, _options: DamageOptions): void {}

  get healthFraction(): number {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }

  heal(amount: number, world: World, label = 'Лечение'): number {
    if (!this.alive || amount <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    const healed = this.hp - before;
    if (healed > 0.5) world.onHealed(this, healed, label);
    return healed;
  }

  addShield(amount: number): void {
    this.shield = Math.max(this.shield, amount);
  }

  /**
   * Full damage pipeline: i-frames -> dodge/mitigation -> shield -> HP -> death.
   * Returns the resolved result so callers can drive lifesteal and on-hit effects.
   */
  takeDamage(options: DamageOptions, world: World, attacker: Combatant | null): DamageResult {
    if (!this.alive) {
      return {
        total: 0,
        byType: {},
        crit: false,
        dodged: false,
        applied: 0,
        overkill: 0,
        lethal: false,
      };
    }

    // Damage-over-time must never be blocked by i-frames, or a single dodge roll
    // would wipe an entire burn stack.
    const respectsIFrames = options.kind === 'attack' || options.kind === 'contact';
    if (respectsIFrames && this.invulnerable > 0) {
      return {
        total: 0,
        byType: {},
        crit: false,
        dodged: true,
        applied: 0,
        overkill: 0,
        lethal: false,
      };
    }

    const defenses = this.defenses();
    defenses.vulnerability *= this.statuses.vulnerability();

    const result = mitigate(options, defenses, () => world.rng.next());

    if (result.dodged) {
      world.onDodge(this);
      this.recordDamage(world, result, options);
      return result;
    }

    if (result.total <= 0) return result;

    // Shield soaks first and is consumed before HP.
    let remaining = result.total;
    if (this.shield > 0) {
      const absorbed = Math.min(this.shield, remaining);
      this.shield -= absorbed;
      remaining -= absorbed;
    }

    const before = this.hp;
    this.hp -= remaining;
    result.applied = before - Math.max(0, this.hp);

    this.hitFlash = 1;
    this.hitFlashColor = world.flashColorFor(dominantType(result.byType));

    if (options.knockback && options.knockback > 0) {
      const dx = options.dirX ?? 0;
      const dy = options.dirY ?? 0;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        const impulse = options.knockback / this.knockbackResistance();
        this.vx += (dx / len) * impulse;
        this.vy += (dy / len) * impulse;
      }
    }

    this.recordDamage(world, result, options);
    this.onDamaged(world, result, options);

    world.onDamageDealt(attacker, this, result, options);

    if (this.hp <= 0) {
      result.lethal = true;
      result.overkill = -this.hp;
      this.hp = 0;
      this.alive = false;
      this.deathTime = world.time;
      this.onDeath(world, {
        killer: attacker,
        sourceLabel: options.sourceLabel,
        overkill: result.overkill,
      });
      world.onKilled(attacker, this, options);
    }

    return result;
  }

  /** Heavier things get shoved around less. Override for bosses and knights. */
  protected knockbackResistance(): number {
    return 1;
  }

  /** Runs statuses and shared timers. Subclasses call this from `update`. */
  protected updateCommon(dt: number, world: World, dotMultiplier = 1): void {
    this.age += dt;
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    if (this.invulnerable > 0) this.invulnerable -= dt;

    const ticks = this.statuses.update(dt, dotMultiplier);
    for (const tick of ticks) {
      if (!this.alive) break;
      this.takeDamage(
        {
          packets: tick.packets,
          sourceLabel: tick.sourceLabel,
          kind: 'dot',
          dodgeable: false,
        },
        world,
        this.faction === 'human' ? world.monster : null,
      );
    }
  }

  /** Total unmitigated damage of an options bundle — used for telemetry. */
  static rawOf(options: DamageOptions): number {
    return rawTotal(options.packets);
  }
}
