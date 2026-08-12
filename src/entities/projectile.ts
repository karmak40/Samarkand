import { type DamagePacket } from '../combat/damage';
import { type StatusApplication } from '../combat/status';
import { angleDelta, circleRectOverlap, dist2, TAU } from '../core/math';
import type { World } from '../world/world';
import { Combatant, Entity, type Faction } from './entity';

export type ProjectileShape = 'claw' | 'orb' | 'bolt' | 'arrow' | 'shard' | 'rock' | 'spit';

export interface ProjectileConfig {
  x: number;
  y: number;
  angle: number;
  speed: number;
  packets: DamagePacket[];
  faction: Faction;
  sourceLabel: string;
  radius?: number;
  /** Max travel distance before expiring. */
  range?: number;
  pierce?: number;
  bounce?: number;
  /** Turn rate in rad/s toward the nearest target. 0 disables homing. */
  homing?: number;
  crit?: boolean;
  lifesteal?: number;
  armorPen?: number;
  knockback?: number;
  color?: string;
  glow?: string;
  shape?: ProjectileShape;
  statuses?: StatusApplication[];
  /** Runs on every target hit, before damage is applied. */
  onHit?: (target: Combatant, world: World, projectile: Projectile) => void;
  /** Runs when the projectile stops for any reason. */
  onExpire?: (world: World, projectile: Projectile) => void;
  /** Player projectiles that raze structures on contact. */
  damagesBuildings?: boolean;
  /** Buildings do not stop this projectile (ghost shots). */
  ignoresWalls?: boolean;
  trail?: boolean;
  /** Owner, for lifesteal attribution. */
  owner?: Combatant | null;
}

/** How many trail samples a projectile keeps. */
const TRAIL_LENGTH = 7;

/**
 * A moving damage source. One class covers monster spit, arrows, crossbow bolts
 * and thrown rocks — behaviour differences are all data in the config.
 */
export class Projectile extends Entity {
  readonly packets: DamagePacket[];
  readonly sourceLabel: string;
  readonly config: ProjectileConfig;

  angle: number;
  /** Constant travel speed. Named to avoid shadowing Entity's velocity-magnitude getter. */
  travelSpeed: number;

  private pierceLeft: number;
  private bounceLeft: number;
  private travelled = 0;
  private readonly maxRange: number;
  private readonly hitIds = new Set<number>();
  private readonly trail: Array<{ x: number; y: number }> = [];
  private readonly owner: Combatant | null;

  constructor(config: ProjectileConfig) {
    super();
    this.config = config;
    this.x = config.x;
    this.y = config.y;
    this.angle = config.angle;
    this.travelSpeed = config.speed;
    this.radius = config.radius ?? 6;
    this.faction = config.faction;
    this.packets = config.packets;
    this.sourceLabel = config.sourceLabel;
    this.pierceLeft = config.pierce ?? 0;
    this.bounceLeft = config.bounce ?? 0;
    this.maxRange = config.range ?? 600;
    this.owner = config.owner ?? null;

    this.vx = Math.cos(this.angle) * this.travelSpeed;
    this.vy = Math.sin(this.angle) * this.travelSpeed;
  }

  override update(dt: number, world: World): void {
    this.age += dt;

    if (this.config.homing && this.config.homing > 0) this.steer(dt, world);

    // Substep long moves so fast projectiles can't tunnel through thin targets.
    const stepDistance = this.travelSpeed * dt;
    const steps = Math.max(1, Math.ceil(stepDistance / (this.radius * 1.5)));
    const stepDt = dt / steps;

    for (let i = 0; i < steps && this.alive; i++) {
      this.x += this.vx * stepDt;
      this.y += this.vy * stepDt;
      this.travelled += this.travelSpeed * stepDt;

      if (this.checkCollisions(world)) return;

      if (this.travelled >= this.maxRange) {
        if (this.faction === 'monster') world.shotOutcomes.outOfRange++;
        this.expire(world);
        return;
      }
      if (!this.insideBounds(world)) {
        if (this.faction === 'monster') world.shotOutcomes.leftBounds++;
        this.expire(world);
        return;
      }
    }

    if (this.config.trail !== false) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    }
  }

  private insideBounds(world: World): boolean {
    const b = world.bounds;
    return (
      this.x > b.x - 40 && this.x < b.x + b.w + 40 && this.y > b.y - 40 && this.y < b.y + b.h + 40
    );
  }

  private steer(dt: number, world: World): void {
    const target =
      this.faction === 'monster'
        ? world.nearestHuman(this.x, this.y, 460, false)
        : world.monster;
    if (!target || !target.alive) return;

    const desired = Math.atan2(target.y - this.y, target.x - this.x);
    const delta = angleDelta(this.angle, desired);
    const maxTurn = this.config.homing! * dt;
    this.angle += Math.max(-maxTurn, Math.min(maxTurn, delta));
    this.vx = Math.cos(this.angle) * this.travelSpeed;
    this.vy = Math.sin(this.angle) * this.travelSpeed;
  }

  /** Returns true when the projectile was consumed. */
  private checkCollisions(world: World): boolean {
    if (this.faction === 'monster') {
      for (const human of world.humansInRadius(this.x, this.y, this.radius + 26)) {
        if (this.hitIds.has(human.id) || !human.alive) continue;
        const reach = this.radius + human.radius;
        if (dist2(this.x, this.y, human.x, human.y) > reach * reach) continue;
        if (this.hit(human, world)) return true;
      }
    } else {
      const monster = world.monster;
      if (monster.alive && !this.hitIds.has(monster.id)) {
        const reach = this.radius + monster.radius;
        if (dist2(this.x, this.y, monster.x, monster.y) <= reach * reach) {
          if (this.hit(monster, world)) return true;
        }
      }
    }

    if (!this.config.ignoresWalls) {
      for (const building of world.buildings) {
        // Low structures (palisades, carts, haystacks) are shot over, not into.
        if (!building.blocksSight) continue;
        if (!circleRectOverlap(this.x, this.y, this.radius, building.rect)) continue;

        if (this.config.damagesBuildings) {
          let total = 0;
          for (const p of this.packets) total += p.amount;
          building.takeStructuralDamage(total, world);
        }
        if (this.faction === 'monster') world.shotOutcomes.hitBuilding++;
        this.expire(world);
        return true;
      }
    }

    return false;
  }

  /** Apply damage to a target. Returns true if the projectile is consumed. */
  private hit(target: Combatant, world: World): boolean {
    this.hitIds.add(target.id);

    this.config.onHit?.(target, world, this);

    const result = target.takeDamage(
      {
        packets: this.packets,
        sourceLabel: this.sourceLabel,
        kind: 'attack',
        crit: this.config.crit ?? false,
        lifesteal: this.config.lifesteal ?? 0,
        armorPen: this.config.armorPen ?? 0,
        knockback: this.config.knockback ?? 0,
        dirX: this.vx,
        dirY: this.vy,
        dodgeable: true,
      },
      world,
      this.owner,
    );

    if (!result.dodged) {
      for (const status of this.config.statuses ?? []) target.statuses.apply(status);
    }

    world.particles.emit({
      count: 4,
      x: this.x,
      y: this.y,
      color: this.config.glow ?? this.config.color ?? '#ffffff',
      shape: 'spark',
      speed: [40, 140],
      size: [1.2, 2.6],
      life: [0.12, 0.28],
      angle: this.angle + Math.PI,
      spread: 1.1,
      additive: true,
    });

    if (this.pierceLeft > 0) {
      this.pierceLeft--;
      return false;
    }

    if (this.bounceLeft > 0 && this.faction === 'monster') {
      const next = this.findBounceTarget(world);
      if (next) {
        this.bounceLeft--;
        this.angle = Math.atan2(next.y - this.y, next.x - this.x);
        this.vx = Math.cos(this.angle) * this.travelSpeed;
        this.vy = Math.sin(this.angle) * this.travelSpeed;
        // Bounces get their own range budget so ricochet chains stay alive.
        this.travelled = Math.max(0, this.travelled - 220);
        return false;
      }
    }

    this.expire(world);
    return true;
  }

  private findBounceTarget(world: World): Combatant | null {
    let best: Combatant | null = null;
    let bestD2 = 320 * 320;
    for (const human of world.humansInRadius(this.x, this.y, 320)) {
      if (this.hitIds.has(human.id) || !human.alive) continue;
      const d2 = dist2(this.x, this.y, human.x, human.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = human;
      }
    }
    return best;
  }

  private expire(world: World): void {
    if (!this.alive) return;
    this.alive = false;
    this.config.onExpire?.(world, this);
  }

  override draw(ctx: CanvasRenderingContext2D, _world: World): void {
    const color = this.config.color ?? '#ffffff';
    const glow = this.config.glow ?? color;
    const shape = this.config.shape ?? 'orb';

    ctx.save();

    if (this.trail.length > 1) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1]!;
        const b = this.trail[i]!;
        const t = i / this.trail.length;
        ctx.globalAlpha = t * 0.5;
        ctx.lineWidth = this.radius * 1.6 * t;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius * 3.2);
    halo.addColorStop(0, glow);
    halo.addColorStop(0.4, color);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 3.2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = glow;

    switch (shape) {
      case 'claw': {
        // A crescent slash, elongated along the direction of travel.
        ctx.strokeStyle = glow;
        ctx.lineWidth = this.radius * 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(-this.radius * 0.6, 0, this.radius * 1.5, -1.05, 1.05);
        ctx.stroke();
        break;
      }
      case 'arrow': {
        ctx.fillStyle = '#d8cbb0';
        ctx.fillRect(-this.radius * 2.4, -1, this.radius * 3.6, 2);
        ctx.beginPath();
        ctx.moveTo(this.radius * 1.4, 0);
        ctx.lineTo(this.radius * 0.2, -this.radius * 0.8);
        ctx.lineTo(this.radius * 0.2, this.radius * 0.8);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'bolt': {
        ctx.fillStyle = '#c9c2b2';
        ctx.fillRect(-this.radius * 2, -1.6, this.radius * 3, 3.2);
        break;
      }
      case 'shard': {
        ctx.beginPath();
        ctx.moveTo(this.radius * 1.6, 0);
        ctx.lineTo(-this.radius, -this.radius * 0.7);
        ctx.lineTo(-this.radius * 0.4, 0);
        ctx.lineTo(-this.radius, this.radius * 0.7);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'rock': {
        ctx.fillStyle = '#6f665a';
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, TAU);
        ctx.fill();
        break;
      }
      case 'spit': {
        ctx.beginPath();
        ctx.ellipse(0, 0, this.radius * 1.5, this.radius * 0.85, 0, 0, TAU);
        ctx.fill();
        break;
      }
      case 'orb':
      default: {
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, TAU);
        ctx.fill();
        break;
      }
    }

    ctx.restore();
  }
}
