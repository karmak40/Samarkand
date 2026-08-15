import type { DamagePacket, DamageType } from '../combat/damage';
import type { Monster } from '../entities/monster';
import { t } from '../i18n';
import type { World } from '../world/world';

/**
 * Gifts of the abyss — the only thing in the game you aim by hand.
 *
 * Everything else the monster does is automatic: it picks its own target and fires on
 * its own timer, and that is the loop the whole game is built on. A gift deliberately
 * does not touch that loop. It is one deliberate act, on a long cooldown, at a point
 * *you* chose — which is why it is worth pointing at something, and why it can't
 * degenerate into a second attack button mashed on every turn.
 *
 * Gifts are borrowed, like relic forms: one drops from every settlement you empty,
 * you pick which of the three you want, and it fades after its seconds are up. That
 * keeps the choice recurring instead of a one-off decision made in room two.
 */
export interface AbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Drives the telegraph, the reticle and the HUD chip. */
  readonly color: string;
  /** Seconds between casts. */
  readonly cooldown: number;
  /** Seconds the gift is held before it fades. Only counts down during play. */
  readonly duration: number;
  /** Effect radius before `areaSize`. Also the size of the telegraph. */
  readonly radius: number;
  /** Farthest from the monster a point may be chosen. */
  readonly range: number;
  /**
   * Seconds between the cast and the effect landing.
   *
   * The delay is not a tax — it is the readable part. A telegraphed circle tells the
   * player (and, on screen, the victims) exactly what is about to happen, so a hit
   * feels aimed rather than lucky.
   */
  readonly windup: number;
  /** What actually happens, once the windup is over. */
  impact(monster: Monster, world: World, x: number, y: number): void;
}

/** The element carrying most of a build's damage — what a gift takes its flavour from. */
function dominantType(packets: readonly DamagePacket[]): DamageType {
  let best: DamageType = 'physical';
  let bestAmount = -1;
  for (const packet of packets) {
    if (packet.amount > bestAmount) {
      bestAmount = packet.amount;
      best = packet.type;
    }
  }
  return best;
}

/** A gift's damage, scaled off whatever the monster currently hits for. */
function scaledAttack(
  monster: Monster,
  multiplier: number,
): { packets: DamagePacket[]; statuses: ReturnType<Monster['buildAttack']>['statuses'] } {
  const { packets, statuses } = monster.buildAttack(false);
  return {
    packets: packets.map((p) => ({ type: p.type, amount: p.amount * multiplier })),
    statuses,
  };
}

export const ABILITIES: readonly AbilityDef[] = [
  {
    id: 'abyss-strike',
    get name() {
      return t('ability.abyss-strike.name');
    },
    get description() {
      return t('ability.abyss-strike.desc');
    },
    color: '#b06cff',
    cooldown: 6,
    duration: 45,
    radius: 108,
    range: 560,
    windup: 0.45,
    impact(monster, world, x, y) {
      const area = monster.stats.get('areaSize');
      const { packets, statuses } = scaledAttack(monster, 3.2);

      world.explode(x, y, this.radius * area, packets, this.name, {
        statuses,
        knockback: 280,
        color: this.color,
        hurtsBuildings: true,
        shake: 7,
      });
      world.sound.explosion({ x, y }, 1);
    },
  },
  {
    id: 'rift',
    get name() {
      return t('ability.rift.name');
    },
    get description() {
      return t('ability.rift.desc');
    },
    color: '#7fe08a',
    cooldown: 9,
    duration: 45,
    radius: 92,
    range: 520,
    windup: 0.25,
    impact(monster, world, x, y) {
      const area = monster.stats.get('areaSize');
      const { packets, statuses } = scaledAttack(monster, 1);
      const type = dominantType(packets);
      // The rift is a denial tool, so its numbers live in the lingering pool rather
      // than in the moment it lands — a burst *and* a zone would just be strictly
      // better than the strike.
      const total = packets.reduce((sum, p) => sum + p.amount, 0);

      world.addGroundHazard({
        x,
        y,
        radius: this.radius * area,
        life: 5,
        dps: total * 0.85,
        type,
        color: this.color,
        sourceLabel: this.name,
        status: statuses[0],
      });
      world.particles.ring(x, y, this.color, this.radius * area, 0.5);
      world.sound.explosion({ x, y }, 0.4);
    },
  },
  {
    id: 'pounce',
    get name() {
      return t('ability.pounce.name');
    },
    get description() {
      return t('ability.pounce.desc');
    },
    color: '#ff7b31',
    cooldown: 7,
    duration: 45,
    radius: 96,
    range: 380,
    // No telegraph: a leap the player has to wait out is a leap that lands on empty
    // ground, since everything they were jumping at has already moved.
    windup: 0,
    impact(monster, world, x, y) {
      const area = monster.stats.get('areaSize');
      const { packets, statuses } = scaledAttack(monster, 2.2);

      const fromX = monster.x;
      const fromY = monster.y;

      monster.x = x;
      monster.y = y;
      monster.vx = 0;
      monster.vy = 0;
      // Landing inside a wall or a building would leave the monster stuck in the
      // geometry; the world resolves it back out to the nearest legal spot.
      world.collideWithWorld(monster);

      world.particles.ring(fromX, fromY, this.color, 46, 0.35);
      world.explode(monster.x, monster.y, this.radius * area, packets, this.name, {
        statuses,
        knockback: 320,
        color: this.color,
        hurtsBuildings: true,
        shake: 5,
      });
      world.sound.explosion(monster, 0.7);
    },
  },
];

const BY_ID = new Map(ABILITIES.map((a) => [a.id, a]));

export function getAbility(id: string): AbilityDef | undefined {
  return BY_ID.get(id);
}
