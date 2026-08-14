import { DAMAGE_TYPES, type DamageType } from '../combat/damage';

export interface RoomRecord {
  index: number;
  name: string;
  /** Seconds spent clearing the room. */
  duration: number;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  soulsGained: number;
  buildingsDestroyed: number;
  /** HP fraction on leaving, for the "flawless room" streak. */
  exitHealth: number;
  perfect: boolean;
}

export interface SourceRecord {
  label: string;
  damage: number;
  hits: number;
  kills: number;
}

export interface KillRecord {
  id: string;
  name: string;
  count: number;
}

/** One sample of the damage-over-time graph shown on the results screen. */
export interface DpsSample {
  time: number;
  damage: number;
}

const DPS_BUCKET = 0.5;

function emptyByType(): Record<DamageType, number> {
  const out = {} as Record<DamageType, number>;
  for (const t of DAMAGE_TYPES) out[t] = 0;
  return out;
}

/**
 * Everything measurable about a single run.
 *
 * The tracker is deliberately dumb — it only accumulates. Interpretation (accuracy,
 * DPS, favourite element) lives in getters so nothing can drift out of sync.
 */
export class RunStats {
  readonly seed: number;
  /** Wall-clock start, milliseconds since epoch. */
  readonly startedAtMs: number;

  /** Seconds of active gameplay, excluding pauses and card screens. */
  elapsed = 0;

  roomsCleared = 0;
  currentRoomIndex = 0;
  private currentRoomName = '';
  private roomStartElapsed = 0;
  private roomKills = 0;
  private roomDamageDealt = 0;
  private roomDamageTaken = 0;
  private roomSouls = 0;
  private roomBuildings = 0;

  readonly rooms: RoomRecord[] = [];

  // --- damage ---------------------------------------------------------------
  readonly damageDealtByType = emptyByType();
  readonly damageTakenByType = emptyByType();
  totalDamageDealt = 0;
  totalDamageTaken = 0;
  totalOverkill = 0;
  largestHit = 0;
  largestHitSource = '—';

  readonly damageBySource = new Map<string, SourceRecord>();
  readonly damageTakenBySource = new Map<string, SourceRecord>();

  // --- accuracy -------------------------------------------------------------
  attacksFired = 0;
  projectilesFired = 0;
  projectilesHit = 0;
  hitsLanded = 0;
  critsLanded = 0;
  dodgesPerformed = 0;
  timesHit = 0;

  // --- survival -------------------------------------------------------------
  healingReceived = 0;
  lifestealHealing = 0;
  shieldAbsorbed = 0;
  lowestHealthFraction = 1;
  closeCalls = 0;

  // --- economy --------------------------------------------------------------
  soulsCollected = 0;
  buildingsDestroyed = 0;
  distanceTravelled = 0;
  dashesUsed = 0;

  // --- kills ----------------------------------------------------------------
  totalKills = 0;
  private readonly killsById = new Map<string, KillRecord>();
  bestKillStreak = 0;
  private killStreak = 0;
  private killStreakTimer = 0;

  // --- progression ----------------------------------------------------------
  readonly skillsTaken: Array<{ id: string; name: string; rarity: string; room: number }> = [];
  readonly mutationsTaken: Array<{ id: string; name: string; room: number }> = [];
  readonly cursesTaken: Array<{ id: string; name: string; room: number }> = [];

  // --- graph ----------------------------------------------------------------
  readonly dpsSeries: DpsSample[] = [];
  private bucketAccum = 0;
  private bucketTime = 0;

  outcome: 'in-progress' | 'victory' | 'death' = 'in-progress';
  killedBy = '';

  constructor(seed: number) {
    this.seed = seed;
    this.startedAtMs = Date.now();
  }

  // ---- lifecycle -----------------------------------------------------------

  tick(dt: number): void {
    this.elapsed += dt;

    this.bucketTime += dt;
    if (this.bucketTime >= DPS_BUCKET) {
      this.dpsSeries.push({ time: this.elapsed, damage: this.bucketAccum / this.bucketTime });
      this.bucketAccum = 0;
      this.bucketTime = 0;
      // Cap the series so a very long run can't grow without bound.
      if (this.dpsSeries.length > 900) this.dpsSeries.shift();
    }

    if (this.killStreakTimer > 0) {
      this.killStreakTimer -= dt;
      if (this.killStreakTimer <= 0) this.killStreak = 0;
    }
  }

  beginRoom(index: number, name: string): void {
    this.currentRoomIndex = index;
    this.currentRoomName = name;
    this.roomStartElapsed = this.elapsed;
    this.roomKills = 0;
    this.roomDamageDealt = 0;
    this.roomDamageTaken = 0;
    this.roomSouls = 0;
    this.roomBuildings = 0;
  }

  endRoom(exitHealth: number): RoomRecord {
    const record: RoomRecord = {
      index: this.currentRoomIndex,
      name: this.currentRoomName,
      duration: this.elapsed - this.roomStartElapsed,
      kills: this.roomKills,
      damageDealt: this.roomDamageDealt,
      damageTaken: this.roomDamageTaken,
      soulsGained: this.roomSouls,
      buildingsDestroyed: this.roomBuildings,
      exitHealth,
      perfect: this.roomDamageTaken <= 0,
    };
    this.rooms.push(record);
    this.roomsCleared++;
    return record;
  }

  // ---- recording -----------------------------------------------------------

  recordDamageDealt(
    byType: Partial<Record<DamageType, number>>,
    total: number,
    source: string,
    crit: boolean,
  ): void {
    this.totalDamageDealt += total;
    this.roomDamageDealt += total;
    this.bucketAccum += total;
    this.hitsLanded++;
    if (crit) this.critsLanded++;

    for (const type of DAMAGE_TYPES) {
      const amount = byType[type];
      if (amount) this.damageDealtByType[type] += amount;
    }

    if (total > this.largestHit) {
      this.largestHit = total;
      this.largestHitSource = source;
    }

    const record = this.damageBySource.get(source);
    if (record) {
      record.damage += total;
      record.hits++;
    } else {
      this.damageBySource.set(source, { label: source, damage: total, hits: 1, kills: 0 });
    }
  }

  recordDamageTaken(
    byType: Partial<Record<DamageType, number>>,
    total: number,
    source: string,
  ): void {
    this.totalDamageTaken += total;
    this.roomDamageTaken += total;
    this.timesHit++;

    for (const type of DAMAGE_TYPES) {
      const amount = byType[type];
      if (amount) this.damageTakenByType[type] += amount;
    }

    const record = this.damageTakenBySource.get(source);
    if (record) {
      record.damage += total;
      record.hits++;
    } else {
      this.damageTakenBySource.set(source, { label: source, damage: total, hits: 1, kills: 0 });
    }
  }

  recordKill(enemyId: string, enemyName: string, source: string, overkill: number): void {
    this.totalKills++;
    this.roomKills++;
    this.totalOverkill += overkill;

    const record = this.killsById.get(enemyId);
    if (record) record.count++;
    else this.killsById.set(enemyId, { id: enemyId, name: enemyName, count: 1 });

    const src = this.damageBySource.get(source);
    if (src) src.kills++;

    this.killStreak++;
    this.killStreakTimer = 3;
    if (this.killStreak > this.bestKillStreak) this.bestKillStreak = this.killStreak;
  }

  recordSouls(amount: number): void {
    this.soulsCollected += amount;
    this.roomSouls += amount;
  }

  recordBuildingDestroyed(): void {
    this.buildingsDestroyed++;
    this.roomBuildings++;
  }

  recordHealth(fraction: number): void {
    if (fraction < this.lowestHealthFraction) {
      this.lowestHealthFraction = fraction;
      if (fraction > 0 && fraction < 0.15) this.closeCalls++;
    }
  }

  recordSkill(id: string, name: string, rarity: string): void {
    this.skillsTaken.push({ id, name, rarity, room: this.currentRoomIndex });
  }

  recordMutation(id: string, name: string): void {
    this.mutationsTaken.push({ id, name, room: this.currentRoomIndex });
  }

  /** Bargains struck at an altar. Permanent, so a run is judged by them too. */
  recordCurse(id: string, name: string): void {
    this.cursesTaken.push({ id, name, room: this.currentRoomIndex });
  }

  // ---- derived -------------------------------------------------------------

  get killList(): KillRecord[] {
    return [...this.killsById.values()].sort((a, b) => b.count - a.count);
  }

  get topDamageSources(): SourceRecord[] {
    return [...this.damageBySource.values()].sort((a, b) => b.damage - a.damage);
  }

  get topThreats(): SourceRecord[] {
    return [...this.damageTakenBySource.values()].sort((a, b) => b.damage - a.damage);
  }

  get averageDps(): number {
    return this.elapsed > 0 ? this.totalDamageDealt / this.elapsed : 0;
  }

  get peakDps(): number {
    let peak = 0;
    for (const sample of this.dpsSeries) if (sample.damage > peak) peak = sample.damage;
    return peak;
  }

  get critRate(): number {
    return this.hitsLanded > 0 ? this.critsLanded / this.hitsLanded : 0;
  }

  get accuracy(): number {
    return this.projectilesFired > 0 ? this.projectilesHit / this.projectilesFired : 0;
  }

  get killsPerMinute(): number {
    return this.elapsed > 0 ? (this.totalKills / this.elapsed) * 60 : 0;
  }

  /** The element that did the most damage this run. */
  get signatureElement(): { type: DamageType; damage: number; share: number } {
    let best: DamageType = 'physical';
    let bestAmount = 0;
    for (const type of DAMAGE_TYPES) {
      if (this.damageDealtByType[type] > bestAmount) {
        bestAmount = this.damageDealtByType[type];
        best = type;
      }
    }
    return {
      type: best,
      damage: bestAmount,
      share: this.totalDamageDealt > 0 ? bestAmount / this.totalDamageDealt : 0,
    };
  }

  get perfectRooms(): number {
    return this.rooms.filter((r) => r.perfect).length;
  }

  get fastestRoom(): RoomRecord | null {
    if (this.rooms.length === 0) return null;
    return this.rooms.reduce((a, b) => (b.duration < a.duration ? b : a));
  }
}
