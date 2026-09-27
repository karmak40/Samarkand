import { describe, expect, it, vi } from 'vitest';
import {
  biomeTag,
  designEventId,
  eventPart,
  gameAnalyticsKeys,
  progressionParts,
  RecordingAnalytics,
  roomTag,
} from './analytics';

describe('gameAnalyticsKeys', () => {
  const env = {
    VITE_GA_WEB_GAME_KEY: 'wg',
    VITE_GA_WEB_SECRET_KEY: 'ws',
    VITE_GA_ANDROID_GAME_KEY: 'ag',
    VITE_GA_ANDROID_SECRET_KEY: 'as',
  };

  it('picks the pair for the platform the bundle is running on', () => {
    expect(gameAnalyticsKeys('web', env)).toEqual({ gameKey: 'wg', secretKey: 'ws' });
    expect(gameAnalyticsKeys('android', env)).toEqual({ gameKey: 'ag', secretKey: 'as' });
  });

  it('sends nothing from a platform without its own keys, rather than borrowing another', () => {
    expect(gameAnalyticsKeys('ios', env)).toBeNull();
    expect(gameAnalyticsKeys('web', { VITE_GA_WEB_GAME_KEY: 'wg' })).toBeNull();
  });
});

describe('event naming', () => {
  it('keeps ids GameAnalytics accepts untouched', () => {
    expect(eventPart('blood_frenzy')).toBe('blood_frenzy');
    expect(eventPart('level3')).toBe('level3');
  });

  it('replaces characters GameAnalytics would silently drop the event for', () => {
    expect(eventPart('card:pick')).toBe('card_pick');
    expect(eventPart('огонь')).toBe('_____');
  });

  it('never produces an empty or over-long segment', () => {
    expect(eventPart('')).toBe('none');
    expect(eventPart('x'.repeat(100))).toHaveLength(64);
  });

  it('caps design ids at five segments and progression at three', () => {
    expect(designEventId(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('a:b:c:d:e');
    expect(progressionParts(['campaign', 'biome1', 'room01', 'extra'])).toEqual(['campaign', 'biome1', 'room01']);
  });

  it('pads rooms so dashboards sort them in order, one-based like the HUD', () => {
    expect(roomTag(0)).toBe('room01');
    expect(roomTag(11)).toBe('room12');
    expect(biomeTag(3)).toBe('biome3');
  });
});

describe('RecordingAnalytics', () => {
  it('records events in the shape a real backend would receive them', () => {
    const a = new RecordingAnalytics();
    a.progression('start', ['campaign', 'biome1', roomTag(3)]);
    a.design(['card', 'pick', 'level', 'blood_frenzy']);
    a.resource('source', 'souls', 42, 'run', 'campaign');
    a.ad('rewarded', 'revive', 'admob');
    expect(a.events).toEqual([
      'progression start campaign:biome1:room04',
      'design card:pick:level:blood_frenzy',
      'resource source souls 42 run:campaign',
      'ad rewarded revive admob',
    ]);
  });

  it('records nothing while the player has statistics turned off', () => {
    const a = new RecordingAnalytics();
    a.setEnabled(false);
    a.design(['run', 'start']);
    expect(a.events).toEqual([]);
  });
});

describe('GameAnalyticsService opt-out', () => {
  const config = { gameKey: 'k', secretKey: 's', build: 'web test', verbose: false };

  async function withSdk(): Promise<{ calls: string[]; service: import('./analytics').GameAnalyticsService }> {
    const calls: string[] = [];
    vi.resetModules();
    vi.doMock('gameanalytics', () => ({ default: (command: string) => calls.push(command) }));
    const { GameAnalyticsService } = await import('./analytics');
    return { calls, service: new GameAnalyticsService() };
  }

  it('never initializes the SDK for a player who has statistics off', async () => {
    const { calls, service } = await withSdk();
    await service.init(config, false);
    service.design(['run', 'start']);
    expect(calls).not.toContain('initialize');
    expect(calls).not.toContain('addDesignEvent');
  });

  it('initializes once, on opting in later, and stops sending on opting out', async () => {
    const { calls, service } = await withSdk();
    await service.init(config, false);
    service.setEnabled(true);
    service.design(['run', 'start']);
    service.setEnabled(false);
    service.design(['run', 'end']);
    service.setEnabled(true);
    expect(calls.filter((c) => c === 'initialize')).toHaveLength(1);
    expect(calls.filter((c) => c === 'addDesignEvent')).toHaveLength(1);
    expect(calls).toContain('setEnabledEventSubmission');
  });
});
