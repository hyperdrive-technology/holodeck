/**
 * Type definitions for the 2D React editor
 */

import type { ContributionRegistry, SceneEdge, SceneFile, SceneNode, ScenePaletteItem } from '@holodeck/sdk';
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';

// Base viewer types
export interface HolodeckEditor2DProps {
  /** Scene file to edit */
  scene: SceneFile;
  /** Width of the viewer */
  width?: number | string;
  /** Height of the viewer */
  height?: number | string;
  /** Whether to show controls */
  showControls?: boolean;
  /** Whether to show minimap */
  showMinimap?: boolean;
  /** Whether the editor is interactive (drag, connect, undo) */
  interactive?: boolean;
  /**
   * Contribution registry. `holodeck.flow.nodeType` / `edgeType` items are
   * merged over the built-in node; a key also present in `nodeTypes`/`edgeTypes`
   * props throws. `holodeck.flow.palette` items feed the palette.
   */
  registry?: ContributionRegistry;
  /** Render a palette (from the registry's palette items) beside the canvas. */
  showPalette?: boolean;
  /** Extra palette items when no registry is used (or in addition to it). */
  paletteItems?: ScenePaletteItem[];
  /** Fired when a palette item is dropped; `node` is the ready-made SceneNode. */
  onDropPaletteItem?: (item: ScenePaletteItem, position: { x: number; y: number }, node: SceneNode) => void;
  /** Custom node types */
  nodeTypes?: Record<string, ComponentType<any>>;
  /** Custom edge types */
  edgeTypes?: Record<string, ComponentType<any>>;
  /** Callback when nodes are selected */
  onNodeSelect?: (nodes: SceneNode[]) => void;
  /** Callback when a node is clicked */
  onNodeClick?: (node: SceneNode) => void;
  /** Callback when a node is double clicked */
  onNodeDoubleClick?: (node: SceneNode) => void;
  /** Callback when a node label is edited */
  onNodeLabelEdit?: (node: SceneNode, nextLabel: string) => void;
  /** Callback when edges are selected */
  onEdgeSelect?: (edges: SceneEdge[]) => void;
  /** Callback when the view changes */
  onViewChange?: (viewport: ViewportState) => void;
  /**
   * Fired once per completed move, never per frame:
   * - `'drag'`: on drag stop. A multi-selection drag reports every moved node in
   *   one call.
   * - `'keyboard'`: once per arrow-key nudge of the selected nodes (5 px, or one
   *   grid cell when `snapGrid` is set).
   *
   * Nodes that ended where they started are omitted; the callback is not called
   * with an empty array. Positions are flow coordinates of the node's top-left
   * corner, i.e. the same space as `SceneNode.transform.position.{x,y}`.
   *
   * Persisting is optional. Write `position` back into `scene` (typically with
   * `layout="manual"`) and the editor keeps it without snapping back or refitting
   * the view. Without write-back, the moved position sticks locally until the
   * host gives that node a different position than it had before the move.
   */
  onNodesMoved?: (moves: HolodeckNodeMove[], source: HolodeckNodeMoveSource) => void;
  /**
   * Snap dragged nodes to a grid: a cell size in flow units (`20`), an `[x, y]`
   * pair, or `false`/omitted for free movement (default). The background dots
   * follow the grid when set.
   */
  snapGrid?: SnapGridProp;
  /**
   * `dagre` recomputes positions (default). Use `manual` when the scene already
   * carries compiler/authored coordinates (e.g. Hyperdrive LD/FBD/SFC projections).
   */
  layout?: 'dagre' | 'manual';
  /** Auto-layout configuration (dagre direction, spacing) */
  layoutConfig?: LayoutConfig;
  /** Custom CSS classes */
  className?: string;
  /** Custom styles */
  style?: CSSProperties;
}

/** How a node move reported through `onNodesMoved` happened. */
export type HolodeckNodeMoveSource = 'drag' | 'keyboard';

/** One node moved by the user, as reported by `onNodesMoved`. */
export interface HolodeckNodeMove {
  /** `SceneNode.id` of the moved node. */
  nodeId: string;
  /** New top-left position in flow coordinates. */
  position: { x: number; y: number };
  /** Position before this move (drag start, or before the nudge). */
  previousPosition: { x: number; y: number };
  /** The scene node as the editor last received it (position not yet updated). */
  sceneNode: SceneNode;
}

/** `snapGrid` prop: one cell size, an `[x, y]` pair, or `false` for off. */
export type SnapGridProp = number | readonly [number, number] | false;

export interface HolodeckProviderProps {
  /** Scene file to provide */
  scene: SceneFile;
  /** Child components */
  children: ReactNode;
  /** Layout algorithm to use */
  layout?: 'dagre' | 'force' | 'manual';
  /** Layout configuration */
  layoutConfig?: LayoutConfig;
}

export interface NodeRendererProps {
  /** Scene node data */
  node: SceneNode;
  /** Whether the node is selected */
  selected?: boolean;
  /** Whether the node is draggable */
  draggable?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: CSSProperties;
  /** Click handler */
  onClick?: (node: SceneNode) => void;
  /** Double click handler */
  onDoubleClick?: (node: SceneNode) => void;
}

export interface EdgeRendererProps {
  /** Scene edge data */
  edge: SceneEdge;
  /** Whether the edge is selected */
  selected?: boolean;
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: CSSProperties;
  /** Click handler */
  onClick?: (edge: SceneEdge) => void;
}

export interface ViewerControlsProps {
  /** React Flow instance */
  reactFlowInstance?: ReactFlowInstance;
  /** Whether to show zoom controls */
  showZoom?: boolean;
  /** Whether to show fit view */
  showFitView?: boolean;
  /** Whether to show layout controls */
  showLayout?: boolean;
  /** Current layout */
  currentLayout?: string;
  /** Layout change handler */
  onLayoutChange?: (layout: string) => void;
  /** Custom class name */
  className?: string;
}

export interface ViewerMinimapProps {
  /** Custom class name */
  className?: string;
  /** Custom styles */
  style?: CSSProperties;
  /** Minimap position */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

// Layout types
export interface LayoutConfig {
  /** Node spacing */
  nodeSpacing?: number;
  /** Rank spacing (for dagre) */
  rankSpacing?: number;
  /** Layout direction */
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
  /** Alignment */
  align?: 'UL' | 'UR' | 'DL' | 'DR';
  /** Force simulation config (for force layout) */
  forceConfig?: {
    strength?: number;
    distance?: number;
    iterations?: number;
  };
}

// Viewport types
export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// React Flow adapter types
export interface ReactFlowNodeData extends Record<string, unknown> {
  sceneNode: SceneNode;
  type: string;
  label: string;
  status?: string;
  metrics?: Record<string, any>;
  liveValue?: string;
  onLabelEdit?: (node: SceneNode, nextLabel: string) => void;
}

export interface ReactFlowEdgeData extends Record<string, unknown> {
  sceneEdge: SceneEdge;
  type: string;
  label?: string;
  status?: string;
  metrics?: Record<string, any>;
}

export type ReactFlowNode = Node<ReactFlowNodeData>;

export type ReactFlowEdge = Edge<ReactFlowEdgeData>;

// Store types
export interface HolodeckStore {
  // Scene state
  scene: SceneFile | null;
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];

  // Selection state
  selectedNodes: string[];
  selectedEdges: string[];

  // Viewport state
  viewport: ViewportState;
  bounds: ViewportBounds | null;

  // Layout state
  layout: string;
  layoutConfig: LayoutConfig;

  // Actions
  setScene: (scene: SceneFile) => void;
  setNodes: (nodes: ReactFlowNode[]) => void;
  setEdges: (edges: ReactFlowEdge[]) => void;
  setSelectedNodes: (nodeIds: string[]) => void;
  setSelectedEdges: (edgeIds: string[]) => void;
  setViewport: (viewport: ViewportState) => void;
  setBounds: (bounds: ViewportBounds) => void;
  setLayout: (layout: string) => void;
  setLayoutConfig: (config: LayoutConfig) => void;

  // Computed
  getSelectedSceneNodes: () => SceneNode[];
  getSelectedSceneEdges: () => SceneEdge[];

  // Methods
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  applyLayout: (layout: string, config?: LayoutConfig) => void;
}
