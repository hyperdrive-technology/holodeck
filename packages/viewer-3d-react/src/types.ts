import type {
  AnimationHook,
  SceneFile,
  SceneNode,
  SceneObjectRenderer,
} from '@holodeck/sdk';
import type { CSSProperties } from 'react';

export type HolodeckLiveConnectionState = 'live' | 'stale' | 'disconnected';

export interface HolodeckLiveConnection {
  state: HolodeckLiveConnectionState;
  targetId: string;
  targetLabel: string;
}

export interface HolodeckViewer3DProps {
  scene: SceneFile;
  width?: number | string;
  height?: number | string;
  /** When false, orbit controls are disabled. Defaults to true. */
  interactive?: boolean;
  /** Draw a ground grid helper. */
  showGrid?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Called when the user picks one or more scene nodes. */
  onNodeSelect?: (nodes: SceneNode[]) => void;
  /**
   * Custom R3F renderers keyed by `SceneNode.type`
   * (typically from a `SceneComponentPack.objectRenderers` merge).
   */
  objectRenderers?: Record<string, SceneObjectRenderer>;
  /** Optional animation hooks invoked each frame via `onFrame`. */
  animationHooks?: AnimationHook[];
  /** Node ids that should render with a selection highlight. */
  selectedNodeIds?: string[];
  /** Selected runtime target freshness overlay. */
  liveConnection?: HolodeckLiveConnection;
}
