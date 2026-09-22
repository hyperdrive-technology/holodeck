import { describe, expect, it } from 'vitest';
import { liveOverlayCopy } from './live-overlay';

describe('liveOverlayCopy', () => {
  it('renders Live · <selected target label>', () => {
    expect(
      liveOverlayCopy({
        state: 'live',
        targetId: 'inbound',
        targetLabel: 'inbound',
      }),
    ).toBe('Live · inbound');
  });

  it('keeps the selected in-browser PLC as Live, not Disconnected', () => {
    expect(
      liveOverlayCopy({
        state: 'disconnected',
        targetId: 'in-browser',
        targetLabel: 'in-browser PLC',
      }),
    ).toBe('Live · in-browser PLC');
    expect(
      liveOverlayCopy({
        state: 'stale',
        targetId: 'inbound',
        targetLabel: 'inbound',
      }),
    ).toBe('Live · inbound');
  });
});
