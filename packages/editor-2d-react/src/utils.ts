/**
 * Utility functions for the 2D React editor
 */

import type { SceneEdge, SceneFile, SceneNode } from '@holodeck/sdk';
import dagre from 'dagre';
import type { XYPosition } from '@xyflow/react';
import { DEFAULT_LAYOUT_CONFIG, NODE_COLORS, NODE_SIZES } from './constants';
import type {
  LayoutConfig,
  ReactFlowEdge,
  ReactFlowEdgeData,
  ReactFlowNode,
  ViewportBounds,
  ViewportState,
} from './types';

/**
 * Convert a SceneFile to ReactFlow nodes and edges
 */
export function sceneFileToReactFlow(scene: SceneFile): {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
} {
  const nodes = scene.scene.nodes.map((sceneNode) => {
    const reactFlowNode: ReactFlowNode = {
      id: sceneNode.id,
      type: sceneNode.type,
      position: {
        x: sceneNode.transform.position.x,
        y: sceneNode.transform.position.y,
      },
      data: compactObject({
        sceneNode,
        type: sceneNode.type,
        label: sceneNode.name,
        status: sceneNode.status,
        metrics: sceneNode.metrics,
        liveValue: sceneNode.metadata?.liveValue,
      }) as ReactFlowNode['data'],
      draggable: true,
      selectable: true,
    };

    return reactFlowNode;
  });

  const edges = scene.scene.edges.map((sceneEdge) => {
    const reactFlowEdge: ReactFlowEdge = {
      id: sceneEdge.id,
      source: sceneEdge.source,
      target: sceneEdge.target,
      type: sceneEdge.type || 'default',
      data: compactObject({
        sceneEdge,
        type: sceneEdge.type || 'default',
        label: sceneEdge.metadata?.label,
        metrics: sceneEdge.metrics,
      }) as ReactFlowEdgeData,
      animated: false,
      selectable: true,
    };

    return reactFlowEdge;
  });

  return { nodes, edges };
}

/**
 * Convert ReactFlow nodes and edges back to a SceneFile
 */
export function reactFlowToSceneFile(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  metadata: SceneFile['metadata']
): SceneFile {
  const sceneNodes: SceneNode[] = nodes.map((node) => {
    const sceneNode = node.data.sceneNode;
    return {
      ...sceneNode,
      transform: {
        ...sceneNode.transform,
        position: {
          x: node.position.x,
          y: node.position.y,
          z: sceneNode.transform.position.z,
        },
      },
    };
  });

  const sceneEdges: SceneEdge[] = edges.map((edge) => edge.data!.sceneEdge);

  return {
    version: '1.0.0',
    metadata,
    scene: {
      nodes: sceneNodes,
      edges: sceneEdges,
    },
  };
}

/**
 * Apply auto-layout to nodes using dagre
 */
export function autoLayoutScene(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG
): ReactFlowNode[] {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const { nodeSpacing = 100, rankSpacing = 150, direction = 'TB' } = config;

  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: nodeSpacing,
    ranksep: rankSpacing,
    align: config.align,
  });

  // Add nodes to dagre graph
  nodes.forEach((node) => {
    const nodeSize = getNodeSize(node.data.sceneNode);
    dagreGraph.setNode(node.id, {
      width: nodeSize.width,
      height: nodeSize.height,
    });
  });

  // Add edges to dagre graph
  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  // Run layout
  dagre.layout(dagreGraph);

  // Apply layout positions
  return nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const nodeSize = getNodeSize(node.data.sceneNode);

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeSize.width / 2,
        y: nodeWithPosition.y - nodeSize.height / 2,
      },
    };
  });
}

/**
 * Get node size based on type and content
 */
export function getNodeSize(node: SceneNode): {
  width: number;
  height: number;
} {
  // Default size based on node type
  switch (node.type) {
    case 'server':
    case 'database':
    case 'storage':
      return NODE_SIZES.LARGE;
    case 'function':
    case 'queue':
    case 'cache':
      return NODE_SIZES.MEDIUM;
    case 'network':
    case 'load-balancer':
      return NODE_SIZES.EXTRA_LARGE;
    default:
      return NODE_SIZES.MEDIUM;
  }
}

/**
 * Get node color based on type and status
 */
export function getNodeColor(node: SceneNode): string {
  // Status color takes precedence
  if (node.status) {
    switch (node.status) {
      case 'healthy':
        return NODE_COLORS.HEALTHY;
      case 'warning':
        return NODE_COLORS.WARNING;
      case 'critical':
        return NODE_COLORS.CRITICAL;
      default:
        return NODE_COLORS.UNKNOWN;
    }
  }

  // Type-based color
  switch (node.type) {
    case 'server':
    case 'aws-ec2':
      return NODE_COLORS.SERVER;
    case 'database':
    case 'aws-rds':
      return NODE_COLORS.DATABASE;
    case 'network':
    case 'aws-vpc':
      return NODE_COLORS.NETWORK;
    case 'storage':
    case 'aws-s3':
      return NODE_COLORS.STORAGE;
    case 'function':
    case 'aws-lambda':
      return NODE_COLORS.FUNCTION;
    case 'queue':
    case 'aws-sqs':
      return NODE_COLORS.QUEUE;
    default:
      return NODE_COLORS.DEFAULT;
  }
}

/**
 * Calculate viewport bounds that fit all nodes
 */
export function calculateViewportBounds(
  nodes: ReactFlowNode[]
): ViewportBounds {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const nodeSize = getNodeSize(node.data.sceneNode);
    const { x, y } = node.position;

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + nodeSize.width);
    maxY = Math.max(maxY, y + nodeSize.height);
  });

  const padding = 50;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding,
  };
}

/**
 * Calculate viewport to fit bounds
 */
export function calculateFitViewport(
  bounds: ViewportBounds,
  containerWidth: number,
  containerHeight: number
): ViewportState {
  const scaleX = containerWidth / bounds.width;
  const scaleY = containerHeight / bounds.height;
  const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 1x

  return {
    x: (containerWidth - bounds.width * scale) / 2 - bounds.x * scale,
    y: (containerHeight - bounds.height * scale) / 2 - bounds.y * scale,
    zoom: scale,
  };
}

/**
 * Get position for a new node to avoid overlaps
 */
export function getAvailablePosition(
  nodes: ReactFlowNode[],
  preferredPosition?: XYPosition
): XYPosition {
  const defaultPosition = preferredPosition || { x: 100, y: 100 };

  if (nodes.length === 0) {
    return defaultPosition;
  }

  // Simple grid placement
  const gridSize = 200;
  const cols = Math.ceil(Math.sqrt(nodes.length + 1));
  const row = Math.floor(nodes.length / cols);
  const col = nodes.length % cols;

  return {
    x: defaultPosition.x + col * gridSize,
    y: defaultPosition.y + row * gridSize,
  };
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/**
 * Check if two nodes are connected
 */
export function areNodesConnected(
  nodeId1: string,
  nodeId2: string,
  edges: ReactFlowEdge[]
): boolean {
  return edges.some(
    (edge) =>
      (edge.source === nodeId1 && edge.target === nodeId2) ||
      (edge.source === nodeId2 && edge.target === nodeId1)
  );
}

/**
 * Get all connected nodes for a given node
 */
export function getConnectedNodes(
  nodeId: string,
  edges: ReactFlowEdge[]
): string[] {
  const connected = new Set<string>();

  edges.forEach((edge) => {
    if (edge.source === nodeId) {
      connected.add(edge.target);
    } else if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  });

  return Array.from(connected);
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const cloned = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned;
  }

  return obj;
}
