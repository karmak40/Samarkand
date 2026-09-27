import { describe, expect, it } from 'vitest';
import { extensionFor, formatClock, MIME_CANDIDATES, pickMimeType, reelFileName } from './recorder';

describe('pickMimeType', () => {
  it('prefers MP4 when the browser records it', () => {
    expect(pickMimeType(() => true)).toBe(MIME_CANDIDATES[0]);
  });

  it('falls back to WebM where MP4 is unavailable (Firefox)', () => {
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
  });

  it('returns null when nothing can be recorded', () => {
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe('file naming', () => {
  it('matches the extension to the container', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
  });

  it('stamps the local date and time', () => {
    const name = reelFileName(new Date(2026, 8, 7, 4, 5, 6), 'video/mp4');
    expect(name).toBe('samarkand-reel-20260907-040506.mp4');
  });
});

describe('formatClock', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(7.9)).toBe('0:07');
    expect(formatClock(62)).toBe('1:02');
  });
});
