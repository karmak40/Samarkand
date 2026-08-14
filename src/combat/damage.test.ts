import { describe, expect, it } from 'vitest';
import {
  armorReduction,
  DAMAGE_TYPES,
  type DamageOptions,
  type Defenses,
  mergePackets,
  mitigate,
  rawTotal,
  scalePackets,
} from './damage';

/** Defences with nothing on them, so each test can set only what it is about. */
function bare(overrides: Partial<Defenses> = {}): Defenses {
  return { armor: 0, resist: {}, dodge: 0, vulnerability: 1, ...overrides };
}

function hit(overrides: Partial<DamageOptions> = {}): DamageOptions {
  return {
    packets: [{ type: 'physical', amount: 100 }],
    sourceLabel: 'test',
    kind: 'attack',
    ...overrides,
  };
}

/** A roll that never dodges, so mitigation tests stay deterministic. */
const never = (): number => 1;

describe('armorReduction', () => {
  it('is the documented curve', () => {
    expect(armorReduction(0)).toBe(0);
    expect(armorReduction(100)).toBeCloseTo(0.5);
    expect(armorReduction(300)).toBeCloseTo(0.75);
  });

  it('never reaches immunity', () => {
    expect(armorReduction(1_000_000)).toBeLessThan(1);
  });

  it('treats negative armour as none rather than as a bonus', () => {
    expect(armorReduction(-500)).toBe(0);
  });
});

describe('mitigate', () => {
  it('applies armour to physical only', () => {
    const result = mitigate(
      hit({
        packets: [
          { type: 'physical', amount: 100 },
          { type: 'fire', amount: 100 },
        ],
      }),
      bare({ armor: 100 }),
      never,
    );

    expect(result.byType.physical).toBeCloseTo(50);
    expect(result.byType.fire).toBeCloseTo(100);
  });

  it('applies each resistance to its own element only', () => {
    const result = mitigate(
      hit({
        packets: [
          { type: 'fire', amount: 100 },
          { type: 'frost', amount: 100 },
        ],
      }),
      bare({ resist: { fire: 0.5 } }),
      never,
    );

    expect(result.byType.fire).toBeCloseTo(50);
    expect(result.byType.frost).toBeCloseTo(100);
  });

  it('caps resistance short of immunity, so no build is locked out', () => {
    const result = mitigate(
      hit({ packets: [{ type: 'fire', amount: 100 }] }),
      bare({ resist: { fire: 1 } }),
      never,
    );

    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeCloseTo(15);
  });

  it('leaves true damage entirely alone', () => {
    const result = mitigate(
      hit({ packets: [{ type: 'true', amount: 100 }] }),
      bare({ armor: 500, resist: { true: 0.9 } }),
      never,
    );

    expect(result.total).toBeCloseTo(100);
  });

  it('lets armour penetration through a fraction of the armour', () => {
    const full = mitigate(hit(), bare({ armor: 100 }), never);
    const pierced = mitigate(hit({ armorPen: 1 }), bare({ armor: 100 }), never);

    expect(full.total).toBeCloseTo(50);
    expect(pierced.total).toBeCloseTo(100);
  });

  it('multiplies everything by vulnerability, after mitigation', () => {
    const result = mitigate(hit(), bare({ armor: 100, vulnerability: 2 }), never);
    expect(result.total).toBeCloseTo(100);
  });

  it('dodges when the roll lands under the dodge chance', () => {
    const result = mitigate(hit(), bare({ dodge: 0.5 }), () => 0.1);
    expect(result.dodged).toBe(true);
    expect(result.total).toBe(0);
  });

  it('cannot dodge what is not dodgeable — damage over time', () => {
    const result = mitigate(hit({ dodgeable: false, kind: 'dot' }), bare({ dodge: 0.99 }), () => 0);
    expect(result.dodged).toBe(false);
    expect(result.total).toBeCloseTo(100);
  });

  it('never touches the target: the result is advice, not an effect', () => {
    const defenses = bare({ armor: 50 });
    const before = JSON.stringify(defenses);
    mitigate(hit(), defenses, never);
    expect(JSON.stringify(defenses)).toBe(before);
  });

  it('drops non-positive packets instead of healing the target', () => {
    const result = mitigate(
      hit({
        packets: [
          { type: 'physical', amount: -50 },
          { type: 'fire', amount: 20 },
        ],
      }),
      bare(),
      never,
    );

    expect(result.total).toBeCloseTo(20);
    expect(result.byType.physical).toBeUndefined();
  });
});

describe('packet helpers', () => {
  it('sums the raw total before mitigation', () => {
    expect(
      rawTotal([
        { type: 'physical', amount: 10 },
        { type: 'fire', amount: 5 },
      ]),
    ).toBe(15);
  });

  it('scales without mutating the input', () => {
    const packets = [{ type: 'physical' as const, amount: 10 }];
    const scaled = scalePackets(packets, 2);

    expect(scaled[0]!.amount).toBe(20);
    expect(packets[0]!.amount).toBe(10);
  });

  it('merges packets of the same element', () => {
    const merged = mergePackets([
      { type: 'fire', amount: 10 },
      { type: 'fire', amount: 5 },
      { type: 'frost', amount: 3 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.type === 'fire')!.amount).toBe(15);
  });
});

describe('the damage table', () => {
  it('has no duplicate elements', () => {
    expect(new Set(DAMAGE_TYPES).size).toBe(DAMAGE_TYPES.length);
  });
});
