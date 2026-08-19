import { clamp } from '../core/math';
import { type AudioEngine } from './engine';

/**
 * Adaptive background drone.
 *
 * Five always-running layers rather than a looping track, so there is no seam and
 * no file to load:
 *  - a detuned sub drone that is simply always there;
 *  - a pad whose filter opens as the room gets dangerous;
 *  - a slow heartbeat that only becomes audible when the monster is nearly dead;
 *  - a war-drum pulse that only exists for a boss;
 *  - a sustained minor-chord horn drone, likewise boss-only.
 *
 * The game pushes `tension`, `danger` and `boss`; everything is ramped, never
 * stepped, so the mix breathes instead of clicking.
 */
export class Ambience {
  private started = false;

  private droneFilter: BiquadFilterNode | null = null;
  private padGain: GainNode | null = null;
  private pulseGain: GainNode | null = null;
  private drumGain: GainNode | null = null;
  private hornGain: GainNode | null = null;
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

    // --- war drum (boss only) --------------------------------------------------
    // Same trick as the heartbeat — a steady voice gated by a slow LFO — but built
    // from filtered noise at a martial tempo instead of a sine tone, so it reads as
    // a drum rather than a pulse.
    const drumGain = ctx.createGain();
    drumGain.gain.value = 0;
    drumGain.connect(bus);
    this.drumGain = drumGain;

    const drumFilter = ctx.createBiquadFilter();
    drumFilter.type = 'lowpass';
    drumFilter.frequency.value = 110;
    drumFilter.Q.value = 0.9;
    drumFilter.connect(drumGain);

    const drumSource = ctx.createBufferSource();
    drumSource.buffer = this.createNoiseBuffer(ctx);
    drumSource.loop = true;
    drumSource.connect(drumFilter);
    drumSource.start();
    this.nodes.push(drumSource);

    const drumLfo = ctx.createOscillator();
    drumLfo.type = 'sine';
    drumLfo.frequency.value = 2.3;
    const drumLfoDepth = ctx.createGain();
    drumLfoDepth.gain.value = 0.07;
    drumLfo.connect(drumLfoDepth);
    drumLfoDepth.connect(drumGain.gain);
    drumLfo.start();
    this.nodes.push(drumLfo);

    // --- horn (boss only) -------------------------------------------------------
    // A sustained minor triad, low enough to sit under the drone rather than
    // compete with it. A slow tremolo keeps it from reading as a held, static note.
    const hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    hornGain.connect(bus);
    this.hornGain = hornGain;

    for (const freq of [82.41, 98.0, 123.47]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.Q.value = 1;
      osc.connect(filter);
      filter.connect(hornGain);
      osc.start();
      this.nodes.push(osc);
    }

    const swellLfo = ctx.createOscillator();
    swellLfo.type = 'sine';
    swellLfo.frequency.value = 0.18;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.045;
    swellLfo.connect(swellDepth);
    swellDepth.connect(hornGain.gain);
    swellLfo.start();
    this.nodes.push(swellLfo);
  }

  /**
   * @param tension 0..1 — how hot the fight is (enemies alive, recent damage)
   * @param danger  0..1 — how close to death the monster is
   * @param boss    a boss is alive in the current room
   */
  update(tension: number, danger: number, boss = false): void {
    const ctx = this.engine.context;
    if (!ctx || !this.started) return;

    const t = clamp(tension, 0, 1);
    const d = clamp(danger, 0, 1);
    const now = ctx.currentTime;

    // Slow ramps: the mix should drift, not react frame by frame.
    this.droneFilter?.frequency.setTargetAtTime(130 + t * 320, now, 0.9);
    this.padGain?.gain.setTargetAtTime(0.006 + t * 0.045, now, 1.2);
    this.pulseGain?.gain.setTargetAtTime(d * 0.09, now, 0.5);
    // Quicker in than out: the drum and horn should announce the boss the instant
    // it's up, but not vanish the moment it happens to duck behind a building.
    this.drumGain?.gain.setTargetAtTime(boss ? 0.16 : 0, now, boss ? 0.5 : 1.4);
    this.hornGain?.gain.setTargetAtTime(boss ? 0.09 : 0, now, boss ? 0.7 : 1.4);
  }

  /** Fade the drone out — used on menus and result screens. */
  quiet(): void {
    const ctx = this.engine.context;
    if (!ctx || !this.started) return;
    const now = ctx.currentTime;
    this.padGain?.gain.setTargetAtTime(0, now, 0.6);
    this.pulseGain?.gain.setTargetAtTime(0, now, 0.4);
    this.droneFilter?.frequency.setTargetAtTime(90, now, 0.8);
    this.drumGain?.gain.setTargetAtTime(0, now, 0.5);
    this.hornGain?.gain.setTargetAtTime(0, now, 0.5);
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

  /** Half a second of white noise for the drum layer to loop. */
  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
