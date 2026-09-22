import type {
  AnimationHook,
  HolodeckLiveConnection,
  SceneFile,
  SceneNode,
  SceneObjectRenderer,
} from '@holodeck/sdk';
import type { CSSProperties } from 'react';

export type { HolodeckLiveConnection, HolodeckLiveConnectionState } from '@holodeck/sdk';

export interface HolodeckViewer3DProps {
  scene: SceneFile;
  width?: number | string;
  height?: number | string;
  interactive?: boolean;
  showGrid?: boolean;
  className?: string;
  style?: CSSProperties;
  onNodeSelect?: (nodes: SceneNode[]) => void;
  objectRenderers?: Record<string, SceneObjectRenderer>;
  animationHooks?: AnimationHook[];
  selectedNodeIds?: string[];
  liveConnection?: HolodeckLiveConnection;
}
