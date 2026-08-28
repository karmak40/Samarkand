import { STATUS_DEFS } from '../balance';
import { type DamagePacket, type DamageType } from './damage';
import { t } from '../i18n';

export type StatusId =
  | 'burn'
  | 'poison'
  | 'chill'
  | 'freeze'
  | 'shock'
  | 'bleed'
  | 'curse'
  | 'fear'
  | 'weaken';

export interface StatusDef {
  readonly id: StatusId;
  readonly name: string;
  readonly color: string;
  readonly maxStacks: number;
  /** Deals periodic damage of this type. */
  readonly dotType?: DamageType;
  /** Seconds between damage ticks. */
  readonly tickInterval: number;
  /** Longest duration this status can be extended to. */
  readonly maxDuration: number;
  readonly description: string;
}
// The actual per-status colours, stack caps and DoT tuning live in ../balance now, re-exporting keeps every existing import of STATUS_DEFS from this file working unchanged.
export { STATUS_DEFS };

export interface StatusInstance {
  id: StatusId;
  stacks: number;
  /** Seconds left before the status falls off entirely. */
  remaining: number;
  /** Damage per second per stack for DoTs; magnitude for the rest. */
  power: number;
  /** Countdown to the next damage tick. */
  tickTimer: number;
  sourceLabel: string;
}

export interface StatusApplication {
  id: StatusId;
  duration: number;
  stacks?: number;
  /** DPS per stack for DoTs. */
  power?: number;
  sourceLabel?: string;
}

/** Damage produced by DoTs during one update, already grouped per source. */
export interface StatusTick {
  packets: DamagePacket[];
  sourceLabel: string;
  statusId: StatusId;
}

/**
 * Per-entity bag of statuses. Owns duration, stacking and DoT scheduling, but never
 * touches HP directly — `update` returns the ticks and the entity applies them.
 */
export class StatusContainer {
  private readonly active = new Map<StatusId, StatusInstance>();

  /** Scratch array reused every frame so DoT ticks don't allocate. */
  private readonly tickBuffer: StatusTick[] = [];

  get size(): number {
    return this.active.size;
  }

  has(id: StatusId): boolean {
    return this.active.has(id);
  }

  get(id: StatusId): StatusInstance | undefined {
    return this.active.get(id);
  }

  stacksOf(id: StatusId): number {
    return this.active.get(id)?.stacks ?? 0;
  }

  list(): IterableIterator<StatusInstance> {
    return this.active.values();
  }

  clear(): void {
    this.active.clear();
  }

  remove(id: StatusId): void {
    this.active.delete(id);
  }

  /**
   * Apply or refresh a status. Duration refreshes to the longer of current/incoming
   * (capped by the def), stacks add up to the cap, and power takes the stronger
   * source so a weak proc can never dilute a strong one.
   */
  apply(app: StatusApplication): void {
    const def = STATUS_DEFS[app.id];
    const addStacks = app.stacks ?? 1;
    const existing = this.active.get(app.id);

    if (existing) {
      existing.stacks = Math.min(def.maxStacks, existing.stacks + addStacks);
      existing.remaining = Math.min(def.maxDuration, Math.max(existing.remaining, app.duration));
      if (app.power !== undefined && app.power > existing.power) existing.power = app.power;
      if (app.sourceLabel) existing.sourceLabel = app.sourceLabel;
      return;
    }

    this.active.set(app.id, {
      id: app.id,
      stacks: Math.min(def.maxStacks, addStacks),
      remaining: Math.min(def.maxDuration, app.duration),
      power: app.power ?? 0,
      tickTimer: def.tickInterval,
      sourceLabel: app.sourceLabel ?? def.name,
    });
  }

  /**
   * Advance every status. Returns DoT damage produced this frame; the array is
   * reused between calls, so consume it before calling update again.
   *
   * @param dotMultiplier scales DoT output, e.g. bleed doubling on moving targets
   */
  update(dt: number, dotMultiplier = 1): StatusTick[] {
    this.tickBuffer.length = 0;
    if (this.active.size === 0) return this.tickBuffer;

    for (const status of [...this.active.values()]) {
      const def = STATUS_DEFS[status.id];
      status.remaining -= dt;

      if (def.dotType && def.tickInterval > 0) {
        status.tickTimer -= dt;
        if (status.tickTimer <= 0) {
          status.tickTimer += def.tickInterval;
          const amount = status.power * status.stacks * def.tickInterval * dotMultiplier;
          if (amount > 0) {
            this.tickBuffer.push({
              packets: [{ type: def.dotType, amount }],
              sourceLabel: status.sourceLabel,
              statusId: status.id,
            });
          }
        }
      }

      if (status.remaining <= 0) {
        this.active.delete(status.id);
        // Chill decays into nothing; freeze leaves the target briefly chilled so it
        // doesn't snap back to full speed the instant the ice breaks.
        if (status.id === 'freeze') {
          this.apply({ id: 'chill', duration: 1.5, stacks: 4, sourceLabel: t('effect.thaw') });
        }
      }
    }

    // Chill reaching max stacks flash-freezes the target and consumes the stacks.
    const chill = this.active.get('chill');
    if (chill && chill.stacks >= STATUS_DEFS.chill.maxStacks) {
      this.active.delete('chill');
      this.apply({ id: 'freeze', duration: 1.6, sourceLabel: t('damageType.frost.name') });
    }

    return this.tickBuffer;
  }

  /** Movement multiplier from chill/freeze. */
  moveMultiplier(): number {
    if (this.active.has('freeze')) return 0;
    const chill = this.active.get('chill');
    if (!chill) return 1;
    return Math.max(0.25, 1 - 0.06 * chill.stacks);
  }

  /** Extra damage taken from shock and curse, as a multiplier. */
  vulnerability(): number {
    let mult = 1;
    const shock = this.active.get('shock');
    if (shock) mult += 0.08 * shock.stacks;
    const curse = this.active.get('curse');
    if (curse) mult += 0.1 * curse.stacks;
    return mult;
  }

  /** Damage output multiplier from weaken. */
  outputMultiplier(): number {
    const weaken = this.active.get('weaken');
    if (!weaken) return 1;
    return Math.max(0.3, 1 - 0.12 * weaken.stacks);
  }

  /** True when the entity cannot act at all. */
  isIncapacitated(): boolean {
    return this.active.has('freeze');
  }

  isFeared(): boolean {
    return this.active.has('fear');
  }

  /** Colour of the most visually dominant status, for the entity tint. */
  tint(): string | null {
    if (this.active.has('freeze')) return STATUS_DEFS.freeze.color;
    let best: StatusInstance | null = null;
    for (const s of this.active.values()) {
      if (!best || s.stacks > best.stacks) best = s;
    }
    return best ? STATUS_DEFS[best.id].color : null;
  }
}
