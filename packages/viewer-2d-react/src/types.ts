/**
 * Type definitions for the 2D React viewer
 */

// Local SDK types (until package is available)
export interface SceneFile {
  metadata: { name: string; version: string; description?: string; author?: string };
  scene: { nodes: SceneNode[]; edges: SceneEdge[] };
}

export interface SceneNode {
  id: string;
  type: string;
  position: { x: number; y: number; z?: number };
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  type?: string;
  properties?: Record<string, any>;
  metadata?: Record<string, any>;
}
import type { ComponentType, CSSProperties, ReactNode } from 'react';
import type { Edge, Node, ReactFlowInstance } from 'reactflow';

// Base viewer types
export interface StarfleetViewer2DProps {
  /** Scene file to render */
  scene: SceneFile;
  /** Width of the viewer */
  width?: number | string;
  /** Height of the viewer */
  height?: number | string;
  /** Whether to show controls */
  showControls?: boolean;
  /** Whether to show minimap */
  showMinimap?: boolean;
  /** Whether the viewer is interactive */
  interactive?: boolean;
  /** Custom node types */
  nodeTypes?: Record<string, ComponentType<any>>;
  /** Custom edge types */
  edgeTypes?: Record<string, ComponentType<any>>;
  /** Callback when nodes are selected */
  onNodeSelect?: (nodes: SceneNode[]) => void;
  /** Callback when edges are selected */
  onEdgeSelect?: (edges: SceneEdge[]) => void;
  /** Callback when the view changes */
  onViewChange?: (viewport: ViewportState) => void;
  /** Custom CSS classes */
  className?: string;
  /** Custom styles */
  style?: CSSProperties;
}

export interface StarfleetProviderProps {
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
export interface ReactFlowNodeData {
  sceneNode: SceneNode;
  type: string;
  label: string;
  status?: string;
  metrics?: Record<string, any>;
}

export interface ReactFlowEdgeData {
  sceneEdge: SceneEdge;
  type: string;
  label?: string;
  status?: string;
  metrics?: Record<string, any>;
}

export interface ReactFlowNode extends Node {
  data: ReactFlowNodeData;
}

export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  data: ReactFlowEdgeData;
}

// Store types
export interface StarfleetStore {
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
