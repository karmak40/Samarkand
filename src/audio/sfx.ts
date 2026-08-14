import { type DamageType } from '../combat/damage';
import { clamp } from '../core/math';
import { type AudioEngine, type SoundPlacement } from './engine';

/**
 * The sound catalogue.
 *
 * Every entry is hand-tuned synthesis rather than a data table: impacts, whooshes
 * and stingers each need a different combination of oscillators and noise, and
 * expressing that as a generic schema would be harder to read than the code.
 *
 * Two rules keep a busy fight from turning to mush:
 *  - anything that can fire many times per frame is throttled by id;
 *  - transients stay short, and only stingers are allowed a long tail.
 */
export class SoundBank {
  constructor(private readonly engine: AudioEngine) {}

  // ---- player ---------------------------------------------------------------

  /**
   * The monster's auto-attack. A wet exhale plus an element-coloured layer, so a
   * fire build and a frost build are distinguishable with your eyes closed.
   */
  monsterShot(element: DamageType, where: SoundPlacement): void {
    if (!this.engine.throttle('shot', 0.05)) return;

    this.engine.noise(
      { duration: 0.11, gain: 0.16, freq: 900, freqEnd: 240, filter: 'bandpass', q: 1.2 },
      where,
    );
    this.engine.tone(
      { freq: 300, freqEnd: 140, type: 'sawtooth', duration: 0.1, gain: 0.1, lowpass: 900 },
      where,
    );

    switch (element) {
      case 'fire':
        this.engine.noise(
          { duration: 0.22, gain: 0.09, freq: 2600, freqEnd: 700, filter: 'highpass', q: 0.7 },
          where,
        );
        break;
      case 'frost':
        this.engine.tone(
          { freq: 2400, freqEnd: 1500, type: 'triangle', duration: 0.16, gain: 0.06 },
          where,
        );
        break;
      case 'lightning':
        this.engine.tone(
          { freq: 1800, freqEnd: 260, type: 'square', duration: 0.07, gain: 0.05 },
          where,
        );
        break;
      case 'poison':
        this.engine.tone(
          { freq: 180, freqEnd: 90, type: 'triangle', duration: 0.2, gain: 0.07, lowpass: 500 },
          where,
        );
        break;
      case 'unholy':
        this.engine.tone(
          { freq: 120, freqEnd: 70, type: 'sawtooth', duration: 0.26, gain: 0.07, detune: 18, lowpass: 400 },
          where,
        );
        break;
      default:
        break;
    }
  }

  /** Projectile connecting with a body. */
  hit(where: SoundPlacement, crit: boolean): void {
    if (!this.engine.throttle(crit ? 'crit' : 'hit', 0.03)) return;

    this.engine.noise(
      { duration: 0.07, gain: crit ? 0.24 : 0.15, freq: 1400, freqEnd: 500, filter: 'bandpass', q: 1.4 },
      where,
    );
    this.engine.tone(
      { freq: crit ? 190 : 150, freqEnd: 70, type: 'sine', duration: 0.09, gain: crit ? 0.2 : 0.12 },
      where,
    );

    if (crit) {
      // A bright slap on top makes crits pop out of a stream of ordinary hits.
      this.engine.tone(
        { freq: 1100, freqEnd: 620, type: 'triangle', duration: 0.14, gain: 0.13, delay: 0.01 },
        where,
      );
    }
  }

  /** Something died. `weight` 0..1 scales from peasant to boss. */
  kill(where: SoundPlacement, weight: number): void {
    if (!this.engine.throttle('kill', 0.04)) return;
    const w = clamp(weight, 0, 1);

    this.engine.noise(
      { duration: 0.18 + w * 0.25, gain: 0.2, freq: 620 - w * 300, freqEnd: 120, filter: 'lowpass', q: 0.8 },
      where,
    );
    this.engine.tone(
      { freq: 130 - w * 50, freqEnd: 45, type: 'sine', duration: 0.24 + w * 0.3, gain: 0.18 },
      where,
    );
    // Bone snap.
    this.engine.noise(
      { duration: 0.05, gain: 0.1 + w * 0.08, freq: 3200, filter: 'highpass', q: 0.6, delay: 0.02 },
      where,
    );
  }

  /** The monster taking damage. Deliberately harsh — it must cut through. */
  hurt(where: SoundPlacement, severity: number): void {
    if (!this.engine.throttle('hurt', 0.12)) return;
    const s = clamp(severity, 0, 1);

    this.engine.tone(
      { freq: 150, freqEnd: 78, type: 'sawtooth', duration: 0.26, gain: 0.16 + s * 0.14, lowpass: 700 },
      where,
    );
    this.engine.noise(
      { duration: 0.14, gain: 0.14, freq: 1100, freqEnd: 260, filter: 'bandpass', q: 0.9 },
      where,
    );
  }

  dodge(where: SoundPlacement): void {
    if (!this.engine.throttle('dodge', 0.08)) return;
    this.engine.noise(
      { duration: 0.14, gain: 0.09, freq: 3000, freqEnd: 900, filter: 'bandpass', q: 2 },
      where,
    );
  }

  dash(where: SoundPlacement): void {
    this.engine.noise(
      { duration: 0.26, gain: 0.17, freq: 320, freqEnd: 2400, filter: 'bandpass', q: 1.1 },
      where,
    );
    this.engine.tone(
      { freq: 420, freqEnd: 120, type: 'triangle', duration: 0.18, gain: 0.08 },
      where,
    );
  }

  // ---- enemies --------------------------------------------------------------

  /**
   * Attack telegraph.
   *
   * Arguably the most important sound in the game: a rising tone in the moment
   * before a swing is what lets you dodge something off the edge of the screen.
   */
  enemyWindup(where: SoundPlacement, duration: number): void {
    if (!this.engine.throttle('windup', 0.05)) return;
    this.engine.tone(
      {
        freq: 330,
        freqEnd: 620,
        type: 'triangle',
        duration: Math.max(0.12, duration * 0.9),
        gain: 0.055,
        attack: 0.03,
        exponentialGlide: true,
      },
      where,
    );
  }

  enemyMelee(where: SoundPlacement): void {
    if (!this.engine.throttle('melee', 0.04)) return;
    this.engine.noise(
      { duration: 0.13, gain: 0.13, freq: 700, freqEnd: 1900, filter: 'bandpass', q: 1.3 },
      where,
    );
  }

  enemyShot(where: SoundPlacement): void {
    if (!this.engine.throttle('bow', 0.04)) return;
    this.engine.noise(
      { duration: 0.1, gain: 0.11, freq: 1600, freqEnd: 400, filter: 'bandpass', q: 3 },
      where,
    );
    this.engine.tone(
      { freq: 480, freqEnd: 200, type: 'triangle', duration: 0.08, gain: 0.05 },
      where,
    );
  }

  bossSpawn(where: SoundPlacement): void {
    // Stacked detuned saws an octave apart: a horn that means "this one is different".
    for (const [freq, detune, delay] of [
      [58, -8, 0],
      [58, 11, 0.02],
      [116, 5, 0.05],
    ] as const) {
      this.engine.tone(
        { freq, detune, type: 'sawtooth', duration: 2.2, gain: 0.14, attack: 0.35, lowpass: 500, delay },
        where,
      );
    }
    this.engine.noise({ duration: 1.6, gain: 0.08, freq: 200, freqEnd: 60, filter: 'lowpass' }, where);
  }

  // ---- world ----------------------------------------------------------------

  explosion(where: SoundPlacement, size: number): void {
    if (!this.engine.throttle('boom', 0.05)) return;
    const s = clamp(size, 0, 1);

    this.engine.noise(
      { duration: 0.35 + s * 0.4, gain: 0.24, freq: 1800, freqEnd: 90, filter: 'lowpass', q: 0.7 },
      where,
    );
    this.engine.tone(
      { freq: 90 - s * 30, freqEnd: 32, type: 'sine', duration: 0.4 + s * 0.3, gain: 0.22 },
      where,
    );
  }

  buildingCollapse(where: SoundPlacement): void {
    this.engine.noise(
      { duration: 0.9, gain: 0.22, freq: 420, freqEnd: 70, filter: 'lowpass', q: 0.6 },
      where,
    );
    this.engine.tone({ freq: 70, freqEnd: 34, type: 'sine', duration: 0.8, gain: 0.18 }, where);
    // Three scattered cracks of splintering timber.
    for (let i = 0; i < 3; i++) {
      this.engine.noise(
        {
          duration: 0.07,
          gain: 0.1,
          freq: 2200 + i * 500,
          filter: 'bandpass',
          q: 2,
          delay: 0.05 + i * 0.11,
        },
        where,
      );
    }
  }

  buildingHit(where: SoundPlacement): void {
    if (!this.engine.throttle('thud', 0.06)) return;
    this.engine.noise(
      { duration: 0.1, gain: 0.1, freq: 380, freqEnd: 140, filter: 'lowpass', q: 0.8 },
      where,
    );
  }

  lightning(where: SoundPlacement): void {
    if (!this.engine.throttle('zap', 0.04)) return;
    this.engine.noise(
      { duration: 0.14, gain: 0.15, freq: 5000, freqEnd: 1200, filter: 'highpass', q: 0.8 },
      where,
    );
    this.engine.tone(
      { freq: 2200, freqEnd: 320, type: 'square', duration: 0.09, gain: 0.06 },
      where,
    );
  }

  freeze(where: SoundPlacement): void {
    if (!this.engine.throttle('freeze', 0.1)) return;
    this.engine.tone(
      { freq: 3200, freqEnd: 2100, type: 'sine', duration: 0.4, gain: 0.09 },
      where,
    );
    this.engine.noise(
      { duration: 0.3, gain: 0.07, freq: 4200, filter: 'highpass', q: 1.5 },
      where,
    );
  }

  // ---- pickups and progression ---------------------------------------------

  soul(where: SoundPlacement): void {
    if (!this.engine.throttle('soul', 0.035)) return;
    this.engine.tone(
      { freq: 1250, freqEnd: 1850, type: 'sine', duration: 0.09, gain: 0.05 },
      where,
    );
  }

  blood(where: SoundPlacement): void {
    this.engine.tone(
      { freq: 320, freqEnd: 520, type: 'triangle', duration: 0.16, gain: 0.09 },
      where,
    );
  }

  /** Picking up a relic: a bright chord that says "you are now something else". */
  boon(where: SoundPlacement): void {
    const chord = [392, 523, 659, 784];
    chord.forEach((freq, i) => {
      this.engine.tone(
        {
          freq,
          type: 'triangle',
          duration: 0.9 - i * 0.1,
          gain: 0.09,
          attack: 0.02,
          delay: i * 0.045,
        },
        where,
      );
    });
    this.engine.noise(
      { duration: 0.5, gain: 0.07, freq: 5000, freqEnd: 1500, filter: 'highpass' },
      where,
    );
  }

  boonExpire(where: SoundPlacement): void {
    this.engine.tone(
      { freq: 520, freqEnd: 180, type: 'triangle', duration: 0.5, gain: 0.07 },
      where,
    );
  }

  /** Rising arpeggio. No placement — progression sounds play flat and centred. */
  levelUp(): void {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this.engine.tone({
        freq,
        type: 'triangle',
        duration: 0.34,
        gain: 0.1,
        attack: 0.008,
        delay: i * 0.07,
      });
    });
  }

  mutation(): void {
    // Descending and detuned: evolution should feel unsettling, not triumphant.
    [330, 262, 196].forEach((freq, i) => {
      this.engine.tone({
        freq,
        type: 'sawtooth',
        duration: 1.1,
        gain: 0.09,
        detune: i * 9,
        attack: 0.05,
        lowpass: 900,
        delay: i * 0.12,
      });
    });
  }

  roomCleared(): void {
    [196, 262, 392].forEach((freq, i) => {
      this.engine.tone({
        freq,
        type: 'triangle',
        duration: 1.4,
        gain: 0.08,
        attack: 0.12,
        delay: i * 0.06,
      });
    });
  }

  portal(where: SoundPlacement): void {
    this.engine.tone(
      { freq: 220, freqEnd: 880, type: 'sine', duration: 0.7, gain: 0.1, attack: 0.1, exponentialGlide: true },
      where,
    );
    this.engine.noise(
      { duration: 0.7, gain: 0.06, freq: 800, freqEnd: 4000, filter: 'bandpass', q: 1.2 },
      where,
    );
  }

  secondWind(): void {
    this.engine.tone({ freq: 110, freqEnd: 660, type: 'sawtooth', duration: 0.8, gain: 0.16, attack: 0.25, lowpass: 1400, exponentialGlide: true });
    this.engine.noise({ duration: 0.8, gain: 0.1, freq: 300, freqEnd: 4000, filter: 'bandpass' });
  }

  death(): void {
    [220, 165, 110, 55].forEach((freq, i) => {
      this.engine.tone({
        freq,
        freqEnd: freq * 0.5,
        type: 'sawtooth',
        duration: 1.8,
        gain: 0.12,
        attack: 0.03,
        lowpass: 700,
        delay: i * 0.16,
      });
    });
  }

  victory(): void {
    [262, 330, 392, 523, 659].forEach((freq, i) => {
      this.engine.tone({
        freq,
        type: 'triangle',
        duration: 1.6,
        gain: 0.1,
        attack: 0.04,
        delay: i * 0.11,
      });
    });
  }

  // ---- interface ------------------------------------------------------------

  uiHover(): void {
    if (!this.engine.throttle('hover', 0.06)) return;
    this.engine.tone({ freq: 720, type: 'sine', duration: 0.05, gain: 0.035 });
  }

  uiClick(): void {
    this.engine.tone({ freq: 480, freqEnd: 660, type: 'triangle', duration: 0.09, gain: 0.08 });
  }

  cardPick(): void {
    this.engine.tone({ freq: 587, type: 'triangle', duration: 0.2, gain: 0.09 });
    this.engine.tone({ freq: 880, type: 'triangle', duration: 0.3, gain: 0.08, delay: 0.08 });
  }
}
