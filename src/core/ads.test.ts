import { describe, expect, it } from 'vitest';
import { NoAdsService, SimulatedAdService } from './ads';

describe('SimulatedAdService', () => {
  it('reports a rewarded ad as available', () => {
    expect(new SimulatedAdService().isRewardedAdAvailable()).toBe(true);
  });

  it('resolves completed after its delay', async () => {
    const service = new SimulatedAdService(5);
    expect(await service.showRewardedAd()).toBe('completed');
  });
});

describe('NoAdsService', () => {
  it('never has anything to offer', () => {
    expect(new NoAdsService().isRewardedAdAvailable()).toBe(false);
  });

  it('resolves unavailable rather than hanging', async () => {
    expect(await new NoAdsService().showRewardedAd()).toBe('unavailable');
  });
});
