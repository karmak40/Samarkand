import { clamp } from '../core/math';
import { type AudioEngine } from './engine';

/**
 * Adaptive background drone.
 *
 * Three always-running layers rather than a looping track, so there is no seam and
 * no file to load:
 *  - a detuned sub drone that is simply always there;
 *  - a pad whose filter opens as the room gets dangerous;
 *  - a slow heartbeat that only becomes audible when the monster is nearly dead.
 *
 * The game pushes `tension` and `danger`; everything is ramped, never stepped, so
 * the mix breathes instead of clicking.
 */
export class Ambience {
  private started = false;

  private droneFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private nodes: AudioScheduledSourceNode[] = [];

  constructor(private readonly engine: AudioEngine) {}

  /** Build the graph. Safe to call every frame; only the first call does work. */
  start(): void {
    if (this.started) return;

    const ctx = this.engine.context;
    const bus = this.engine.busNode('music');
    if (!ctx || !bus) return;

    this.started = true;

    // --- sub drone ------------------------------------------------------------
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 150;
    droneFilter.Q.value = 0.7;
    droneFilter.connect(bus);
    this.droneFilter = droneFilter;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.11;
    droneGain.connect(droneFilter);

    for (const detune of [-9, 8]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 41.2;
      osc.detune.value = detune;
      osc.connect(droneGain);
      osc.start();
      this.nodes.push(osc);
    }

    // --- pad ------------------------------------------------------------------
    const padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.connect(bus);
    this.padGain = padGain;

    for (const [freq, detune] of [
      [123.5, 0],
      [185.0, 6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(padGain);
      osc.start();
      this.nodes.push(osc);
    }

    // --- heartbeat ------------------------------------------------------------
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0;
    pulseGain.connect(bus);
    this.pulseGain = pulseGain;

    const pulse = ctx.createOscillator();
    pulse.type = 'sine';
    pulse.frequency.value = 54;
    pulse.connect(pulseGain);
    pulse.start();
    this.nodes.push(pulse);

    // An LFO on the pulse gain turns a steady tone into a slow thump.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.35;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.05;
    lfo.connect(lfoDepth);
    lfoDepth.connect(pulseGain.gain);
    lfo.start();
    this.nodes.push(lfo);
  }

  /**
   * @param tension 0..1 — how hot the fight is (enemies alive, recent damage)
   * @param danger  0..1 — how close to death the monster is
   */
  update(tension: number, danger: number): void {
    const ctx = this.engine.context;
    if (!ctx || !this.started) return;

    const t = clamp(tension, 0, 1);
    const d = clamp(danger, 0, 1);
    const now = ctx.currentTime;

    // Slow ramps: the mix should drift, not react frame by frame.
    this.droneFilter?.frequency.setTargetAtTime(130 + t * 320, now, 0.9);
    this.padGain?.gain.setTargetAtTime(0.006 + t * 0.045, now, 1.2);
    this.pulseGain?.gain.setTargetAtTime(d * 0.09, now, 0.5);
  }

  /** Fade the drone out — used on menus and result screens. */
  quiet(): void {
    const ctx = this.engine.context;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;
    this.padGain?.gain.setTargetAtTime(0, now, 0.6);
    this.pulseGain?.gain.setTargetAtTime(0, now, 0.4);
    this.droneFilter?.frequency.setTargetAtTime(90, now, 0.8);
  }

  stop(): void {
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.nodes = [];
    this.started = false;
  }
}
