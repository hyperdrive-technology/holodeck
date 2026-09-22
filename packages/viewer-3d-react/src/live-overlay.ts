import type { HolodeckLiveConnectionState } from '@holodeck/sdk';

export {
  liveOverlayCopy,
  type HolodeckLiveConnection,
  type HolodeckLiveConnectionState,
} from '@holodeck/sdk';

export function liveOverlayChrome(state: HolodeckLiveConnectionState): {
  background: string;
  color: string;
} {
  switch (state) {
    case 'live':
      return { background: 'rgba(16, 185, 129, 0.92)', color: '#042f1e' };
    case 'stale':
      return { background: 'rgba(245, 158, 11, 0.94)', color: '#3b2503' };
    default:
      return { background: 'rgba(75, 85, 99, 0.94)', color: '#f9fafb' };
  }
}
