/**
 * Canvas + game audio to a video file, entirely in the browser.
 *
 * `MediaRecorder` over `canvas.captureStream()` rather than anything server-side: the
 * game already renders every pixel itself, so the recording is the exact frame the
 * player sees, at the backing store's full resolution, with the mix tapped straight
 * off the audio graph — no screen capture, no system sounds, no cursor.
 */

/**
 * Containers to try, best first.
 *
 * MP4/H.264 first because it is what Instagram, TikTok and YouTube Shorts take as-is;
 * Chrome records it natively since 126 and Safari always has. WebM is the fallback
 * for Firefox and older Chrome — every platform accepts an upload of it too, but some
 * re-encode it harder, so it is second choice rather than the default.
 */
export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

/** First candidate the browser can record, or null when it can record none of them. */
export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  for (const type of MIME_CANDIDATES) {
    if (isSupported(type)) return type;
  }
  return null;
}

export function extensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

/** `samarkand-reel-20260927-143005.mp4` — sortable, and unique per second. */
export function reelFileName(date: Date, mimeType: string): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `samarkand-reel-${stamp}.${extensionFor(mimeType)}`;
}

/** `0:07`, `1:02` — for the recording timer. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export interface RecorderOptions {
  fps: number;
  videoBitsPerSecond: number;
}

/** One take: start, stop, and a finished file handed to `onFinished`. */
export class ReelRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: RecorderOptions,
    private readonly onFinished: (file: Blob, name: string) => void,
  ) {}

  static get supported(): boolean {
    return (
      typeof MediaRecorder !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
      pickMimeType((t) => MediaRecorder.isTypeSupported(t)) !== null
    );
  }

  get recording(): boolean {
    return this.recorder !== null;
  }

  get elapsed(): number {
    return this.recorder ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** `audio` may be null — a silent take is still worth having. */
  start(audio: MediaStream | null): void {
    if (this.recorder) return;
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record video');

    const stream = this.canvas.captureStream(this.options.fps);
    for (const track of audio?.getAudioTracks() ?? []) stream.addTrack(track);

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: this.options.videoBitsPerSecond,
      audioBitsPerSecond: 192_000,
    });
    this.chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    recorder.onstop = () => {
      // Only the canvas track is ours to end; the audio track belongs to the
      // game's audio graph and has to survive for the next take.
      for (const track of stream.getVideoTracks()) track.stop();
      const file = new Blob(this.chunks, { type: mimeType });
      this.chunks = [];
      this.onFinished(file, reelFileName(new Date(), mimeType));
    };
    // A timeslice keeps memory flat on long takes and means a crash mid-take still
    // has most of the chunks — the browser would otherwise buffer it all internally.
    recorder.start(1000);
    this.recorder = recorder;
    this.startedAt = performance.now();
  }

  stop(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    this.recorder = null;
    recorder.stop();
  }
}

/** Hand a finished take to the browser as a download. */
export function saveFile(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked late: some browsers start the download asynchronously after click().
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
