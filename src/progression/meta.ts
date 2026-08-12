import { DAMAGE_TYPES, type DamageType } from '../combat/damage';
import { type RunStats } from '../stats/tracker';
import { type RawModifier } from './skills';
import { type StatSheet } from './stats';

const SAVE_KEY = 'samarkand.save.v1';
const SAVE_VERSION = 1;

export interface MetaUpgrade {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly maxLevel: number;
  /** Souls for the first level; each level costs more. */
  readonly baseCost: number;
  readonly costGrowth: number;
  /** Applied once per level. */
  readonly perLevel: readonly RawModifier[];
}

export const META_UPGRADES: readonly MetaUpgrade[] = [
  {
    id: 'vitality',
    name: 'Живучесть',
    description: '+14 к максимальному здоровью за уровень.',
    maxLevel: 12,
    baseCost: 25,
    costGrowth: 1.35,
    perLevel: [{ key: 'maxHp', flat: 14 }],
  },
  {
    id: 'claws',
    name: 'Когти',
    description: '+6% урона за уровень.',
    maxLevel: 12,
    baseCost: 30,
    costGrowth: 1.4,
    perLevel: [{ key: 'damage', mult: 0.06 }],
  },
  {
    id: 'ferocity',
    name: 'Свирепость',
    description: '+5% скорости атаки за уровень.',
    maxLevel: 8,
    baseCost: 40,
    costGrowth: 1.45,
    perLevel: [{ key: 'attackSpeed', mult: 0.05 }],
  },
  {
    id: 'swiftness',
    name: 'Прыть',
    description: '+4% скорости передвижения за уровень.',
    maxLevel: 6,
    baseCost: 35,
    costGrowth: 1.4,
    perLevel: [{ key: 'moveSpeed', mult: 0.04 }],
  },
  {
    id: 'carapace',
    name: 'Хитин',
    description: '+7 брони за уровень.',
    maxLevel: 8,
    baseCost: 35,
    costGrowth: 1.38,
    perLevel: [{ key: 'armor', flat: 7 }],
  },
  {
    id: 'fortune',
    name: 'Чутьё',
    description: '+3% шанса крита за уровень.',
    maxLevel: 6,
    baseCost: 45,
    costGrowth: 1.5,
    perLevel: [{ key: 'critChance', flat: 0.03 }],
  },
  {
    id: 'hunger',
    name: 'Голод',
    description: '+2% вампиризма за уровень.',
    maxLevel: 5,
    baseCost: 60,
    costGrowth: 1.6,
    perLevel: [{ key: 'lifesteal', flat: 0.02 }],
  },
  {
    id: 'greed',
    name: 'Алчность',
    description: '+12% добываемых душ за уровень.',
    maxLevel: 6,
    baseCost: 30,
    costGrowth: 1.4,
    perLevel: [{ key: 'soulGain', mult: 0.12 }],
  },
  {
    id: 'aegis',
    name: 'Скорлупа',
    description: '+15 щита в начале каждой комнаты за уровень.',
    maxLevel: 5,
    baseCost: 55,
    costGrowth: 1.5,
    perLevel: [{ key: 'shieldOnRoom', flat: 15 }],
  },
  {
    id: 'sprint',
    name: 'Второе сердце',
    description: '-8% отката рывка за уровень.',
    maxLevel: 5,
    baseCost: 50,
    costGrowth: 1.45,
    perLevel: [{ key: 'dashCooldown', mult: -0.08 }],
  },
];

const UPGRADES_BY_ID = new Map(META_UPGRADES.map((u) => [u.id, u]));

export function upgradeCost(upgrade: MetaUpgrade, currentLevel: number): number {
  return Math.round(upgrade.baseCost * Math.pow(upgrade.costGrowth, currentLevel));
}

/** Aggregated numbers across every run ever played. */
export interface LifetimeStats {
  runs: number;
  victories: number;
  deaths: number;
  totalKills: number;
  totalSouls: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  totalBuildings: number;
  totalPlaytime: number;
  deepestRoom: number;
  bestKills: number;
  bestDps: number;
  bestSoulsInRun: number;
  largestHit: number;
  damageByType: Record<DamageType, number>;
  killsByEnemy: Record<string, number>;
  skillPicks: Record<string, number>;
  mutationPicks: Record<string, number>;
  /** How each run ended, keyed by the thing that killed you. */
  deathsBySource: Record<string, number>;
}

function emptyLifetime(): LifetimeStats {
  const damageByType = {} as Record<DamageType, number>;
  for (const type of DAMAGE_TYPES) damageByType[type] = 0;

  return {
    runs: 0,
    victories: 0,
    deaths: 0,
    totalKills: 0,
    totalSouls: 0,
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    totalBuildings: 0,
    totalPlaytime: 0,
    deepestRoom: 0,
    bestKills: 0,
    bestDps: 0,
    bestSoulsInRun: 0,
    largestHit: 0,
    damageByType,
    killsByEnemy: {},
    skillPicks: {},
    mutationPicks: {},
    deathsBySource: {},
  };
}

export interface SaveData {
  version: number;
  souls: number;
  upgrades: Record<string, number>;
  lifetime: LifetimeStats;
  /** Wall-clock of the last save, for display only. */
  updatedAt: number;
}

/**
 * Persistent player profile.
 *
 * Everything is kept in one localStorage blob and written on meaningful events
 * (run end, upgrade purchase) rather than every frame.
 */
export class MetaProgress {
  souls = 0;
  readonly upgrades = new Map<string, number>();
  lifetime: LifetimeStats = emptyLifetime();

  /** Set when loading found no save — the game shows the intro in that case. */
  isNewProfile = true;

  constructor() {
    this.load();
  }

  levelOf(id: string): number {
    return this.upgrades.get(id) ?? 0;
  }

  costOf(id: string): number | null {
    const upgrade = UPGRADES_BY_ID.get(id);
    if (!upgrade) return null;
    const level = this.levelOf(id);
    if (level >= upgrade.maxLevel) return null;
    return upgradeCost(upgrade, level);
  }

  canAfford(id: string): boolean {
    const cost = this.costOf(id);
    return cost !== null && this.souls >= cost;
  }

  purchase(id: string): boolean {
    const cost = this.costOf(id);
    if (cost === null || this.souls < cost) return false;
    this.souls -= cost;
    this.upgrades.set(id, this.levelOf(id) + 1);
    this.save();
    return true;
  }

  /** Total souls spent so far, for the profile screen. */
  soulsInvested(): number {
    let total = 0;
    for (const upgrade of META_UPGRADES) {
      const level = this.levelOf(upgrade.id);
      for (let i = 0; i < level; i++) total += upgradeCost(upgrade, i);
    }
    return total;
  }

  /** Apply every purchased upgrade to a fresh run's stat sheet. */
  applyTo(stats: StatSheet): void {
    for (const upgrade of META_UPGRADES) {
      const level = this.levelOf(upgrade.id);
      if (level <= 0) continue;

      for (const mod of upgrade.perLevel) {
        stats.addModifier({
          key: mod.key,
          flat: mod.flat !== undefined ? mod.flat * level : undefined,
          mult: mod.mult !== undefined ? mod.mult * level : undefined,
          source: `${upgrade.name} ${level}`,
        });
      }
    }
  }

  /** Fold a finished run into the lifetime record and bank its souls. */
  recordRun(run: RunStats, soulsEarned: number): void {
    const l = this.lifetime;

    l.runs++;
    if (run.outcome === 'victory') l.victories++;
    else l.deaths++;

    l.totalKills += run.totalKills;
    l.totalSouls += soulsEarned;
    l.totalDamageDealt += run.totalDamageDealt;
    l.totalDamageTaken += run.totalDamageTaken;
    l.totalBuildings += run.buildingsDestroyed;
    l.totalPlaytime += run.elapsed;

    if (run.roomsCleared > l.deepestRoom) l.deepestRoom = run.roomsCleared;
    if (run.totalKills > l.bestKills) l.bestKills = run.totalKills;
    if (run.averageDps > l.bestDps) l.bestDps = run.averageDps;
    if (soulsEarned > l.bestSoulsInRun) l.bestSoulsInRun = soulsEarned;
    if (run.largestHit > l.largestHit) l.largestHit = run.largestHit;

    for (const type of DAMAGE_TYPES) l.damageByType[type] += run.damageDealtByType[type];
    for (const kill of run.killList) {
      l.killsByEnemy[kill.id] = (l.killsByEnemy[kill.id] ?? 0) + kill.count;
    }
    for (const skill of run.skillsTaken) {
      l.skillPicks[skill.id] = (l.skillPicks[skill.id] ?? 0) + 1;
    }
    for (const mutation of run.mutationsTaken) {
      l.mutationPicks[mutation.id] = (l.mutationPicks[mutation.id] ?? 0) + 1;
    }
    if (run.outcome === 'death' && run.killedBy) {
      l.deathsBySource[run.killedBy] = (l.deathsBySource[run.killedBy] ?? 0) + 1;
    }

    this.souls += soulsEarned;
    this.save();
  }

  /** The enemy that has killed you the most, for the profile screen. */
  nemesis(): { name: string; count: number } | null {
    let best: { name: string; count: number } | null = null;
    for (const [name, count] of Object.entries(this.lifetime.deathsBySource)) {
      if (!best || count > best.count) best = { name, count };
    }
    return best;
  }

  favouriteElement(): { type: DamageType; damage: number } | null {
    let best: { type: DamageType; damage: number } | null = null;
    for (const type of DAMAGE_TYPES) {
      const damage = this.lifetime.damageByType[type];
      if (damage > 0 && (!best || damage > best.damage)) best = { type, damage };
    }
    return best;
  }

  // ---- persistence ---------------------------------------------------------

  save(): void {
    const data: SaveData = {
      version: SAVE_VERSION,
      souls: this.souls,
      upgrades: Object.fromEntries(this.upgrades),
      lifetime: this.lifetime,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Private browsing or a full quota — the run still works, it just won't persist.
    }
  }

  load(): void {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    try {
      const data = JSON.parse(raw) as Partial<SaveData>;
      if (!data || data.version !== SAVE_VERSION) return;

      this.souls = typeof data.souls === 'number' ? data.souls : 0;
      this.upgrades.clear();
      for (const [id, level] of Object.entries(data.upgrades ?? {})) {
        if (UPGRADES_BY_ID.has(id) && typeof level === 'number') {
          this.upgrades.set(id, level);
        }
      }
      // Merge rather than replace, so a save written by an older build that lacks
      // newer counters still loads with sane defaults.
      this.lifetime = { ...emptyLifetime(), ...(data.lifetime ?? {}) };
      this.isNewProfile = false;
    } catch {
      // Corrupt save: fall back to a fresh profile rather than refusing to start.
    }
  }

  reset(): void {
    this.souls = 0;
    this.upgrades.clear();
    this.lifetime = emptyLifetime();
    this.isNewProfile = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing we can do; the in-memory reset already happened.
    }
  }
}
