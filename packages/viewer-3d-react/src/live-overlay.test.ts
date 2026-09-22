import { liveOverlayChrome as sdkLiveOverlayChrome } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';

import { liveOverlayChrome } from './live-overlay';

describe('live-overlay', () => {
  it('re-exports liveOverlayChrome from the sdk', () => {
    expect(liveOverlayChrome).toBe(sdkLiveOverlayChrome);
  });
});
