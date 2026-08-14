import { clamp } from '../core/math';

export type Bus = 'sfx' | 'music';

export interface ToneSpec {
  /** Starting frequency in Hz. */
  freq: number;
  /** Optional glide target; omit for a steady pitch. */
  freqEnd?: number;
  type?: OscillatorType;
  /** Seconds. */
  duration: number;
  attack?: number;
  /** Peak gain before bus and distance scaling. */
  gain: number;
  /** Cents of detune, for thickening. */
  detune?: number;
  /** Optional low-pass applied to this voice. */
  lowpass?: number;
  /** Delay before the voice starts, in seconds. */
  delay?: number;
  /** Exponential pitch glide reads more musical than linear for sweeps. */
  exponentialGlide?: boolean;
}

export interface NoiseSpec {
  duration: number;
  gain: number;
  /** Band-pass centre, or low-pass cutoff when `filter` is 'lowpass'. */
  freq: number;
  freqEnd?: number;
  filter?: BiquadFilterType;
  q?: number;
  attack?: number;
  delay?: number;
}

/** Where a sound happens, for panning and distance falloff. */
export interface SoundPlacement {
  x?: number;
  y?: number;
}

/** Hard cap on simultaneous voices; past this, new sounds are dropped. */
const MAX_VOICES = 36;

/** Distance at which a world sound becomes inaudible. */
const FALLOFF = 900;

/**
 * Procedural audio.
 *
 * Same principle as the visuals: nothing is loaded, everything is synthesised at
 * play time from oscillators and filtered noise. That keeps the build asset-free
 * and lets a sound be re-tuned by editing numbers rather than re-recording.
 *
 * The context cannot start before a user gesture, so every call is a no-op until
 * `unlock()` runs — the menu's first click does it.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /**
   * Scheduled end time of every voice still in flight.
   *
   * Counting live voices via the `ended` event looks simpler but ties the budget to
   * event delivery, which browsers throttle on hidden pages — the count then sticks
   * high and silences the game. Times are known at schedule time, so pruning against
   * the audio clock is both exact and immune to that.
   */
  private voiceEnds: number[] = [];
  /** Last play time per sound id, for throttling bursts. */
  private readonly lastPlayed = new Map<string, number>();

  private listenerX = 0;
  private listenerY = 0;

  private masterVolume = 0.7;
  private muted = false;

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get volume(): number {
    return this.masterVolume;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Raw context, for subsystems that build their own graphs (the ambience drone). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  busNode(bus: Bus): GainNode | null {
    return this.buses ? this.buses[bus] : null;
  }

  /**
   * Create and resume the context. Safe to call repeatedly; browsers only allow
   * the resume to take effect inside a user gesture.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;

      try {
        this.ctx = new Ctor();
      } catch {
        // Audio is a nicety; a context failure must never stop the game.
        return;
      }

      // A limiter on the way out. Individual voices are mixed conservatively, but a
      // dozen of them landing together would still clip; this makes the loud moments
      // safe and lets the per-sound gains sit high enough to actually be heard.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.18;
      limiter.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.masterVolume;
      this.master.connect(limiter);

      const sfx = this.ctx.createGain();
      sfx.gain.value = 2.6;
      sfx.connect(this.master);

      // The drone is a bed, not a layer you notice. Kept well under the effects so
      // an attack transient always reads over it.
      const music = this.ctx.createGain();
      music.gain.value = 0.5;
      music.connect(this.master);

      this.buses = { sfx, music };
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }

    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(value: number): void {
    this.masterVolume = clamp(value, 0, 1);
    this.applyMasterGain();
  }

  setMuted(value: boolean): void {
    this.muted = value;
    this.applyMasterGain();
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private applyMasterGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.masterVolume;
    // Ramp rather than jump, or changing volume mid-tone clicks.
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  /** Follow the camera so distant events are quieter and panned. */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Reject a sound that fired too recently.
   *
   * A twelve-projectile volley would otherwise stack twelve identical transients
   * into one clipped blast; letting the first through and dropping the rest sounds
   * like one meaty shot.
   */
  throttle(id: string, minInterval: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(id);
    if (last !== undefined && now - last < minInterval) return false;
    this.lastPlayed.set(id, now);
    return true;
  }

  /** Combined distance attenuation and stereo pan for a world position. */
  private placement(where: SoundPlacement | undefined): { gain: number; pan: number } {
    if (!where || where.x === undefined || where.y === undefined) {
      return { gain: 1, pan: 0 };
    }
    const dx = where.x - this.listenerX;
    const dy = where.y - this.listenerY;
    const distance = Math.hypot(dx, dy);
    const falloff = clamp(1 - distance / FALLOFF, 0, 1);
    return { gain: falloff * falloff, pan: clamp(dx / 620, -1, 1) };
  }

  /** Shared output chain: per-voice gain -> panner -> bus. */
  private chain(bus: Bus, pan: number): GainNode | null {
    if (!this.ctx || !this.buses) return null;

    const gain = this.ctx.createGain();
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      panner.connect(this.buses[bus]);
    } else {
      gain.connect(this.buses[bus]);
    }
    return gain;
  }

  private trackVoice(source: AudioScheduledSourceNode, endTime: number): void {
    this.voiceEnds.push(endTime);
    // Still hook `ended` — not for counting, only to unhook the node for the GC.
    source.onended = () => source.disconnect();
  }

  /** Drop finished voices from the budget. Cheap: the list is at most MAX_VOICES. */
  private pruneVoices(): void {
    if (!this.ctx || this.voiceEnds.length === 0) return;
    const now = this.ctx.currentTime;
    let write = 0;
    for (let i = 0; i < this.voiceEnds.length; i++) {
      const end = this.voiceEnds[i]!;
      if (end > now) this.voiceEnds[write++] = end;
    }
    this.voiceEnds.length = write;
  }

  private get saturated(): boolean {
    this.pruneVoices();
    return this.voiceEnds.length >= MAX_VOICES;
  }

  /** A single oscillator voice with an attack/decay envelope. */
  tone(spec: ToneSpec, where?: SoundPlacement, bus: Bus = 'sfx'): void {
    if (!this.ctx || this.saturated) return;

    const place = this.placement(where);
    if (place.gain <= 0.01) return;

    const start = this.ctx.currentTime + (spec.delay ?? 0);
    const envelope = this.chain(bus, place.pan);
    if (!envelope) return;

    const osc = this.ctx.createOscillator();
    osc.type = spec.type ?? 'sine';
    osc.frequency.setValueAtTime(spec.freq, start);
    if (spec.detune) osc.detune.value = spec.detune;

    if (spec.freqEnd !== undefined && spec.freqEnd !== spec.freq) {
      if (spec.exponentialGlide) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(1, spec.freqEnd),
          start + spec.duration,
        );
      } else {
        osc.frequency.linearRampToValueAtTime(spec.freqEnd, start + spec.duration);
      }
    }

    let node: AudioNode = osc;
    if (spec.lowpass) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = spec.lowpass;
      osc.connect(filter);
      node = filter;
    }
    node.connect(envelope);

    const peak = spec.gain * place.gain;
    const attack = spec.attack ?? 0.005;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    // Exponential tails sound natural; the floor avoids a zero-target error.
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);

    const endTime = start + spec.duration + 0.02;
    this.trackVoice(osc, endTime);
    osc.start(start);
    osc.stop(endTime);
  }

  /** A filtered noise burst — the backbone of impacts, whooshes and rubble. */
  noise(spec: NoiseSpec, where?: SoundPlacement, bus: Bus = 'sfx'): void {
    if (!this.ctx || !this.noiseBuffer || this.saturated) return;

    const place = this.placement(where);
    if (place.gain <= 0.01) return;

    const start = this.ctx.currentTime + (spec.delay ?? 0);
    const envelope = this.chain(bus, place.pan);
    if (!envelope) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    // Random offset into the buffer so repeated hits never phase-align.
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = spec.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(spec.freq, start);
    filter.Q.value = spec.q ?? 1;
    if (spec.freqEnd !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.freqEnd),
        start + spec.duration,
      );
    }

    source.connect(filter);
    filter.connect(envelope);

    const peak = spec.gain * place.gain;
    const attack = spec.attack ?? 0.003;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + spec.duration);

    const endTime = start + spec.duration + 0.02;
    this.trackVoice(source, endTime);
    source.start(start, Math.random() * 1.5);
    source.stop(endTime);
  }

  /** Two seconds of white noise, reused by every noise voice. */
  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** State summary for the debug harness. */
  debugInfo(): { state: string; voices: number; volume: number; muted: boolean } {
    // Pruning is normally lazy, driven by the next sound. Do it here too or an idle
    // moment reports a stale count and looks like a leak.
    this.pruneVoices();
    return {
      state: this.ctx ? this.ctx.state : 'absent',
      voices: this.voiceEnds.length,
      volume: this.masterVolume,
      muted: this.muted,
    };
  }

  /** Release everything. Only used if the game is ever torn down. */
  destroy(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.buses = null;
  }
}
