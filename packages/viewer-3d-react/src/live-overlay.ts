import type { HolodeckLiveConnection } from './types';

/** Banner copy for the selected runtime target. Never "Deploy without Connect". */
export function liveOverlayCopy(connection: HolodeckLiveConnection): string {
  switch (connection.state) {
    case 'live':
      return `Live · ${connection.targetLabel}`;
    case 'stale':
      return `Stale values · ${connection.targetLabel}`;
    default:
      return `Disconnected · ${connection.targetLabel}`;
  }
}
