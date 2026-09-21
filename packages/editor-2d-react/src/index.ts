/**
 * @holodeck/editor-2d-react
 *
 * 2D React editor for Holodeck infrastructure diagrams
 */

// Core components
export { EdgeRenderer } from './components/EdgeRenderer';
export { NodeRenderer } from './components/NodeRenderer';
export { HolodeckProvider } from './components/HolodeckProvider';
export { HolodeckEditor2D } from './components/HolodeckEditor2D';
export { ViewerControls } from './components/ViewerControls';
export { ViewerMinimap } from './components/ViewerMinimap';

// Hooks
export { useLayout } from './hooks/useLayout';
export { useHolodeck } from './hooks/useHolodeck';

// Types
export type {
  EdgeRendererProps,
  NodeRendererProps,
  HolodeckProviderProps,
  HolodeckEditor2DProps,
  LayoutConfig,
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
