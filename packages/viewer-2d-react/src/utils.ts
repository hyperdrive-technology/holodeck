/**
 * Utility functions for the 2D React viewer
 */

import dagre from 'dagre';
import type { Edge, Node } from 'reactflow';
import type { 
  SceneFile, 
  SceneNode, 
  SceneEdge, 
  ReactFlowNode, 
  ReactFlowEdge, 
  LayoutConfig,
  ViewportBounds 
} from './types';
import { NODE_TYPES, NODE_COLORS, NODE_SIZES } from './constants';

/**
 * Convert a SceneFile to ReactFlow nodes and edges
 */
export function sceneFileToReactFlow(scene: SceneFile): {
  nodes: ReactFlowNode[];
  edges: ReactFlowEdge[];
} {
  const nodes: ReactFlowNode[] = scene.scene.nodes.map((node) => ({
    id: node.id,
    type: getNodeType(node.type),
    position: { x: node.position.x, y: node.position.y },
    data: {
      sceneNode: node,
      type: node.type,
      label: getNodeLabel(node),
      status: node.properties?.status || 'active',
      metrics: node.properties?.metrics
    }
  }));

  const edges: ReactFlowEdge[] = scene.scene.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: getEdgeType(edge.type),
    data: {
      sceneEdge: edge,
      type: edge.type || 'connection',
      label: getEdgeLabel(edge),
      status: edge.properties?.status || 'active',
      metrics: edge.properties?.metrics
    }
  }));

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
  const sceneNodes: SceneNode[] = nodes.map((node) => ({
    ...node.data.sceneNode,
    position: {
      x: node.position.x,
      y: node.position.y,
      ...(node.data.sceneNode.position.z !== undefined && { z: node.data.sceneNode.position.z })
    }
  }));

  const sceneEdges: SceneEdge[] = edges.map((edge) => edge.data.sceneEdge);

  return {
    metadata,
    scene: {
      nodes: sceneNodes,
      edges: sceneEdges
    }
  };
}

/**
 * Apply automatic layout to a scene
 */
export function autoLayoutScene(
  scene: SceneFile,
  layoutType: string = 'dagre',
  config: LayoutConfig = {}
): SceneFile {
  const { nodes, edges } = sceneFileToReactFlow(scene);
  
  let layoutedNodes: ReactFlowNode[];
  
  if (layoutType === 'dagre') {
    layoutedNodes = applyDagreLayout(nodes, edges, config);
  } else if (layoutType === 'force') {
    layoutedNodes = applyForceLayout(nodes, edges, config);
  } else {
    // Manual layout - keep existing positions
    layoutedNodes = nodes;
  }

  return reactFlowToSceneFile(layoutedNodes, edges, scene.metadata);
}

/**
 * Apply Dagre hierarchical layout
 */
function applyDagreLayout(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  config: LayoutConfig
): ReactFlowNode[] {
  const g = new dagre.graphlib.Graph();
  
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: config.direction || 'TB',
    ranksep: config.rankSpacing || 100,
    nodesep: config.nodeSpacing || 80,
    align: config.align || 'UL'
  });

  // Add nodes to graph
  nodes.forEach((node) => {
    const size = getNodeSize(node.data.type);
    g.setNode(node.id, { width: size.width, height: size.height });
  });

  // Add edges to graph
  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  // Run layout
  dagre.layout(g);

  // Apply positions
  return nodes.map((node) => {
    const graphNode = g.node(node.id);
    return {
      ...node,
      position: {
        x: graphNode.x - graphNode.width / 2,
        y: graphNode.y - graphNode.height / 2
      }
    };
  });
}

/**
 * Apply force-directed layout (simplified implementation)
 */
function applyForceLayout(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  config: LayoutConfig
): ReactFlowNode[] {
  const forceConfig = config.forceConfig || {};
  const iterations = forceConfig.iterations || 100;
  const strength = forceConfig.strength || -1000;
  const distance = forceConfig.distance || 150;

  // Simple force-directed layout simulation
  let layoutNodes = nodes.map(node => ({
    ...node,
    position: {
      x: node.position.x || Math.random() * 800,
      y: node.position.y || Math.random() * 600
    },
    vx: 0,
    vy: 0
  }));

  for (let i = 0; i < iterations; i++) {
    // Repulsion between all nodes
    for (let j = 0; j < layoutNodes.length; j++) {
      for (let k = j + 1; k < layoutNodes.length; k++) {
        const nodeA = layoutNodes[j];
        const nodeB = layoutNodes[k];
        
        const dx = nodeB.position.x - nodeA.position.x;
        const dy = nodeB.position.y - nodeA.position.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const force = strength / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        
        nodeA.vx -= fx;
        nodeA.vy -= fy;
        nodeB.vx += fx;
        nodeB.vy += fy;
      }
    }

    // Attraction along edges
    edges.forEach((edge) => {
      const sourceNode = layoutNodes.find(n => n.id === edge.source);
      const targetNode = layoutNodes.find(n => n.id === edge.target);
      
      if (sourceNode && targetNode) {
        const dx = targetNode.position.x - sourceNode.position.x;
        const dy = targetNode.position.y - sourceNode.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        
        const force = (dist - distance) * 0.1;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        
        sourceNode.vx += fx;
        sourceNode.vy += fy;
        targetNode.vx -= fx;
        targetNode.vy -= fy;
      }
    });

    // Apply velocities with damping
    layoutNodes.forEach((node) => {
      node.position.x += node.vx * 0.1;
      node.position.y += node.vy * 0.1;
      node.vx *= 0.8;
      node.vy *= 0.8;
    });
  }

  return layoutNodes.map(({ vx, vy, ...node }) => node);
}

/**
 * Calculate viewport bounds for a set of nodes
 */
export function calculateViewportBounds(nodes: ReactFlowNode[]): ViewportBounds {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  nodes.forEach((node) => {
    const size = getNodeSize(node.data.type);
    const x1 = node.position.x;
    const y1 = node.position.y;
    const x2 = x1 + size.width;
    const y2 = y1 + size.height;

    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  });

  const padding = 50;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + 2 * padding,
    height: maxY - minY + 2 * padding
  };
}

/**
 * Get the ReactFlow node type for a scene node type
 */
function getNodeType(sceneNodeType: string): string {
  return NODE_TYPES[sceneNodeType as keyof typeof NODE_TYPES] || NODE_TYPES.default;
}

/**
 * Get the ReactFlow edge type for a scene edge type
 */
function getEdgeType(sceneEdgeType?: string): string {
  if (!sceneEdgeType) return 'default';
  return sceneEdgeType;
}

/**
 * Get display label for a node
 */
function getNodeLabel(node: SceneNode): string {
  if (node.properties?.name) return node.properties.name;
  if (node.properties?.label) return node.properties.label;
  if (node.metadata?.name) return node.metadata.name;
  return node.id;
}

/**
 * Get display label for an edge
 */
function getEdgeLabel(edge: SceneEdge): string | undefined {
  if (edge.properties?.label) return edge.properties.label;
  if (edge.properties?.name) return edge.properties.name;
  return undefined;
}

/**
 * Get node size based on type
 */
function getNodeSize(nodeType: string): { width: number; height: number } {
  // Return medium size for all nodes by default
  // Can be enhanced to return different sizes based on type
  return NODE_SIZES.medium;
}

/**
 * Get node color based on type
 */
export function getNodeColor(nodeType: string): string {
  const mappedType = NODE_TYPES[nodeType as keyof typeof NODE_TYPES] || NODE_TYPES.default;
  return NODE_COLORS[mappedType as keyof typeof NODE_COLORS] || NODE_COLORS.default;
}
