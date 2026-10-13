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
export {
  HolodeckPalette,
  PALETTE_DRAG_MIME,
  filterPaletteItems,
  groupPaletteItems,
  paletteCategory,
} from './components/HolodeckPalette';
export type { HolodeckPaletteProps } from './components/HolodeckPalette';
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

// Registry (extension kinds)
export * from './registry';
export { createSceneNodeFromPaletteItem, resolvePaletteDrop } from './utils';

// React Flow primitives for node/edge renderers.
//
// Hosts that contribute custom `holodeck.flow.nodeType` / `flowEdgeType`
// components (e.g. Hyperdrive's LD / SFC / FBD language packages) import these
// from here instead of depending on `@xyflow/react` themselves. That keeps a
// single React Flow version — the one this editor is built against — so the
// `<Handle>` inside a contributed node sees the same zustand store/context as
// the `<ReactFlow>` the editor mounts. Two copies would silently break handles
// and edges. Add to this list rather than importing `@xyflow/react` downstream.
export {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlowProvider,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
} from '@xyflow/react';
export type { EdgeProps, HandleProps, HandleType, NodeProps } from '@xyflow/react';
