/**
 * Main 2D viewer component for Starfleet scenes
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowInstance,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  Panel,
  Node,
  Edge
} from 'reactflow';
import 'reactflow/dist/style.css';

import type { StarfleetViewer2DProps } from '../types';
import { sceneFileToReactFlow, autoLayoutScene } from '../utils';
import { VIEW_CONFIG } from '../constants';
import { StarfleetNode } from './StarfleetNode';
import { StarfleetEdge } from './StarfleetEdge';

const nodeTypes = {
  server: StarfleetNode,
  database: StarfleetNode,
  storage: StarfleetNode,
  network: StarfleetNode,
  security: StarfleetNode,
  function: StarfleetNode,
  api: StarfleetNode,
  container: StarfleetNode,
  messaging: StarfleetNode,
  cache: StarfleetNode,
  search: StarfleetNode,
  loadBalancer: StarfleetNode,
  cdn: StarfleetNode,
  dns: StarfleetNode,
  stack: StarfleetNode,
  registry: StarfleetNode,
  queue: StarfleetNode,
  stream: StarfleetNode,
  default: StarfleetNode
};

const edgeTypes = {
  default: StarfleetEdge,
  dependency: StarfleetEdge,
  network: StarfleetEdge,
  data: StarfleetEdge,
  security: StarfleetEdge
};

export function StarfleetViewer2D(props: StarfleetViewer2DProps) {
  const {
    scene,
    width = '100%',
    height = '600px',
    showControls = true,
    showMinimap = true,
    interactive = true,
    className,
    style,
    onNodeSelect,
    onEdgeSelect,
    onViewChange,
  } = props;

  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [isLayouting, setIsLayouting] = useState(false);

  // Convert scene to ReactFlow format
  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => sceneFileToReactFlow(scene),
    [scene]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes and edges when scene changes
  useEffect(() => {
    const { nodes: newNodes, edges: newEdges } = sceneFileToReactFlow(scene);
    setNodes(newNodes);
    setEdges(newEdges);
  }, [scene, setNodes, setEdges]);

  // Handle node selection
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (onNodeSelect) {
      const sceneNode = (node as any).data.sceneNode;
      onNodeSelect([sceneNode]);
    }
  }, [onNodeSelect]);

  // Handle edge selection
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    if (onEdgeSelect) {
      const sceneEdge = (edge as any).data.sceneEdge;
      onEdgeSelect([sceneEdge]);
    }
  }, [onEdgeSelect]);

  // Handle selection change
  const onSelectionChange = useCallback((elements: { nodes: Node[]; edges: Edge[] }) => {
    if (onNodeSelect && elements.nodes.length > 0) {
      const sceneNodes = elements.nodes.map(node => (node as any).data.sceneNode);
      onNodeSelect(sceneNodes);
    }
    if (onEdgeSelect && elements.edges.length > 0) {
      const sceneEdges = elements.edges.map(edge => (edge as any).data.sceneEdge);
      onEdgeSelect(sceneEdges);
    }
  }, [onNodeSelect, onEdgeSelect]);

  // Handle view change
  const onMove = useCallback(() => {
    if (onViewChange && reactFlowInstance) {
      const viewport = reactFlowInstance.getViewport();
      onViewChange(viewport);
    }
  }, [onViewChange, reactFlowInstance]);

  // Auto-layout function
  const applyAutoLayout = useCallback(async (layoutType: string = 'dagre') => {
    if (!reactFlowInstance) return;

    setIsLayouting(true);
    try {
      const layoutedScene = autoLayoutScene(scene, layoutType);
      const { nodes: layoutedNodes, edges: layoutedEdges } = sceneFileToReactFlow(layoutedScene);
      
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      
      // Fit view after layout
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.1 });
      }, 100);
    } catch (error) {
      console.error('Layout failed:', error);
    } finally {
      setIsLayouting(false);
    }
  }, [scene, reactFlowInstance, setNodes, setEdges]);

  // Fit view function
  const fitView = useCallback(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.1 });
    }
  }, [reactFlowInstance]);

  // Initialize ReactFlow
  const onInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
    // Fit view on initial load
    setTimeout(() => {
      instance.fitView({ padding: 0.1 });
    }, 100);
  }, []);

  const containerStyle = {
    width,
    height,
    ...style,
  };

  return (
    <div 
      className={className} 
      style={containerStyle}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={interactive ? onNodeClick : undefined}
        onEdgeClick={interactive ? onEdgeClick : undefined}
        onSelectionChange={interactive ? onSelectionChange : undefined}
        onMove={onMove}
        onInit={onInit}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={VIEW_CONFIG.minZoom}
        maxZoom={VIEW_CONFIG.maxZoom}
        defaultViewport={{ x: 0, y: 0, zoom: VIEW_CONFIG.defaultZoom }}
        panOnDrag={interactive && VIEW_CONFIG.panOnDrag}
        zoomOnScroll={interactive && VIEW_CONFIG.zoomOnScroll}
        zoomOnPinch={interactive && VIEW_CONFIG.zoomOnPinch}
        zoomOnDoubleClick={interactive && VIEW_CONFIG.zoomOnDoubleClick}
        nodesDraggable={interactive}
        nodesConnectable={false}
        elementsSelectable={interactive}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={null} // Disable delete
      >
        <Background />
        
        {showControls && (
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={false}
          />
        )}
        
        {showMinimap && (
          <MiniMap
            nodeColor={(node) => {
              const nodeType = (node as any).data?.type || 'default';
              return '#8B949E'; // Default gray color for minimap
            }}
            nodeStrokeWidth={1}
            zoomable
            pannable
          />
        )}

        {/* Custom Controls Panel */}
        <Panel position="top-right" className="starfleet-controls">
          <div style={{ 
            background: 'white', 
            border: '1px solid #e2e8f0', 
            borderRadius: '8px', 
            padding: '8px',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            fontSize: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <button
              onClick={() => applyAutoLayout('dagre')}
              disabled={isLayouting}
              style={{
                padding: '4px 8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                background: '#f9fafb',
                cursor: isLayouting ? 'not-allowed' : 'pointer',
                fontSize: '12px'
              }}
            >
              {isLayouting ? '⚡ Layouting...' : '🔄 Auto Layout'}
            </button>
            
            <button
              onClick={fitView}
              style={{
                padding: '4px 8px',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                background: '#f9fafb',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              📐 Fit View
            </button>

            <span style={{ color: '#6b7280', fontSize: '11px' }}>
              {nodes.length} nodes, {edges.length} edges
            </span>
          </div>
        </Panel>

        {/* Scene Info Panel */}
        <Panel position="top-left" className="starfleet-info">
          <div style={{ 
            background: 'white', 
            border: '1px solid #e2e8f0', 
            borderRadius: '8px', 
            padding: '12px',
            maxWidth: '300px',
            fontSize: '14px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
          }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600' }}>
              {scene.metadata.name || 'Untitled Scene'}
            </h3>
            {scene.metadata.description && (
              <p style={{ margin: '0 0 8px 0', color: '#6b7280', fontSize: '12px' }}>
                {scene.metadata.description}
              </p>
            )}
            <div style={{ fontSize: '12px', color: '#374151' }}>
              <div>Version: {scene.metadata.version}</div>
              {scene.metadata.author && <div>Author: {scene.metadata.author}</div>}
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
