/**
 * @starfleet/viewer-2d-react
 *
 * 2D React viewer for Starfleet infrastructure diagrams
 */

// Core components
export { EdgeRenderer } from './components/EdgeRenderer';
export { NodeRenderer } from './components/NodeRenderer';
export { StarfleetProvider } from './components/StarfleetProvider';
export { StarfleetViewer2D } from './components/StarfleetViewer2D';
export { ViewerControls } from './components/ViewerControls';
export { ViewerMinimap } from './components/ViewerMinimap';

// Hooks
export { useLayout } from './hooks/useLayout';
export { useStarfleet } from './hooks/useStarfleet';

// Types
export type {
  EdgeRendererProps,
  NodeRendererProps,
  StarfleetProviderProps,
  StarfleetViewer2DProps,
  ViewerControlsProps,
  ViewerMinimapProps,
} from './types';

// Utils
export {
  autoLayoutScene,
  calculateViewportBounds,
  reactFlowToSceneFile,
  sceneFileToReactFlow,
} from './utils';

// Constants
export { EDGE_TYPES, NODE_TYPES } from './constants';
