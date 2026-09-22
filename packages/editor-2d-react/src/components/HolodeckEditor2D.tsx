/**
 * Main 2D editor component for Holodeck scenes.
 */

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './holodeck-editor.css';

import { liveOverlayCopy, type SceneNode } from '@holodeck/sdk';
import { useEffect, useMemo, useRef } from 'react';
import { DEFAULT_LAYOUT_CONFIG } from '../constants';
import type { HolodeckEditor2DProps, ReactFlowNodeData } from '../types';
import { autoLayoutScene, sceneFileToReactFlow } from '../utils';

const nodeTypes: Record<string, any> = {
  holodeckNode: HolodeckSceneNode,
};

export function HolodeckEditor2D(props: HolodeckEditor2DProps) {
  const {
    scene,
    width = '100%',
    height = '600px',
    showControls = true,
    showMinimap = true,
    interactive = true,
    className,
    style,
    nodeTypes: customNodeTypes,
    edgeTypes: customEdgeTypes,
    onNodeSelect,
    onNodeClick,
    onNodeDoubleClick,
    onNodeLabelEdit,
    onEdgeSelect,
    onViewChange,
    layout = 'dagre',
    layoutConfig,
    liveConnection,
  } = props;

  const converted = useMemo(() => sceneFileToReactFlow(scene), [scene]);
  const nodes = useMemo(() => {
    const positioned =
      layout === 'manual'
        ? converted.nodes
        : autoLayoutScene(converted.nodes, converted.edges, {
            ...DEFAULT_LAYOUT_CONFIG,
            ...layoutConfig,
          });

    return positioned.map((node) => ({
      ...node,
      type:
        node.type && customNodeTypes?.[node.type] ? node.type : 'holodeckNode',
      draggable: interactive,
      data: {
        ...node.data,
        onLabelEdit: onNodeLabelEdit,
      },
    }));
  }, [
    converted.edges,
    converted.nodes,
    customNodeTypes,
    interactive,
    layout,
    layoutConfig,
    onNodeLabelEdit,
  ]);
  const edges: Edge[] = converted.edges.map((edge) => {
    const customType =
      edge.type && customEdgeTypes?.[edge.type] ? edge.type : undefined;
    const next: Edge = {
      ...edge,
      type: customType ?? 'smoothstep',
    };
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional
    // property, so only set `markerEnd` when we actually want the arrow head.
    if (!customType) next.markerEnd = { type: MarkerType.ArrowClosed };
    if (edge.data?.label) next.label = edge.data.label;
    return next;
  });

  // `ReactFlowInstance` is generic over the node type; `onInit` hands us an
  // instance parameterised by our positioned node shape, so type the ref the
  // same way instead of the default `Node` (which is not assignable because
  // `setNodes` makes the parameter contravariant).
  type FlowNode = (typeof nodes)[number];
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);

  useEffect(() => {
    const instance = flowRef.current;
    if (!instance) return;
    const frame = window.requestAnimationFrame(() => {
      instance.fitView({
        padding: 0.12,
        minZoom: 0.08,
        maxZoom: 1.25,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [nodes, edges]);

  return (
    <div
      className={className}
      style={{ width, height, position: 'relative', ...style }}
      data-testid="holodeck-editor-2d"
      data-connection-state={liveConnection ? 'live' : ''}
      data-runtime-target={liveConnection?.targetId ?? ''}
    >
      {liveConnection ? (
        <div
          className="holodeck-live-banner holodeck-live-banner-live"
          data-testid="holodeck-live-overlay"
          data-connection-state="live"
          data-runtime-target={liveConnection.targetId}
        >
          {liveOverlayCopy(liveConnection)}
        </div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ ...nodeTypes, ...customNodeTypes } as any}
        edgeTypes={customEdgeTypes as any}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: 0.08, maxZoom: 1.25 }}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        elementsSelectable
        onInit={(instance) => {
          flowRef.current = instance;
          window.requestAnimationFrame(() => {
            instance.fitView({
              padding: 0.12,
              minZoom: 0.08,
              maxZoom: 1.25,
            });
          });
        }}
        onNodeClick={(_, node) => onNodeClick?.((node.data as ReactFlowNodeData).sceneNode)}
        onNodeDoubleClick={(_, node) => onNodeDoubleClick?.((node.data as ReactFlowNodeData).sceneNode)}
        onSelectionChange={({ nodes: selectedNodes, edges: selectedEdges }) => {
          if (selectedNodes.length > 0) {
            onNodeSelect?.(selectedNodes.map((node) => (node.data as ReactFlowNodeData).sceneNode));
          }
          if (selectedEdges.length > 0) {
            onEdgeSelect?.(
              selectedEdges
                .map((edge) => edge.data?.sceneEdge)
                .filter((edge): edge is any => Boolean(edge)),
            );
          }
        }}
        onMoveEnd={(_, viewport) => onViewChange?.(viewport)}
        minZoom={0.1}
      >
        <Background gap={18} />
        {showControls ? <Controls showInteractive={interactive} /> : null}
        {showMinimap ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}
      </ReactFlow>
    </div>
  );
}

function HolodeckSceneNode({ data, selected }: NodeProps<any>) {
  const sceneNode = data.sceneNode;
  const liveValue = data.liveValue ?? sceneNode.metadata?.liveValue;
  const projectionKind = sceneNode.metadata?.projectionKind;
  const role = sceneNode.metadata?.role;
  const nodeKind = sceneNode.metadata?.nodeKind ?? sceneNode.type;
  const onLabelEdit = data.onLabelEdit as
    | ((node: SceneNode, nextLabel: string) => void)
    | undefined;
  const className = [
    'holodeck-node',
    selected ? 'holodeck-node-selected' : '',
    sceneNode.metadata?.isActiveStep ? 'holodeck-node-active-step' : '',
    liveValue === ' [+]' ? 'holodeck-node-live-true' : '',
    liveValue === ' [ ]' ? 'holodeck-node-live-false' : '',
    liveValue && liveValue !== ' [+]' && liveValue !== ' [ ]'
      ? 'holodeck-node-live-value'
      : '',
    sceneNode.metadata?.liveFreshness === 'stale' ? 'holodeck-node-stale' : '',
    sceneNode.metadata?.liveFreshness === 'disconnected'
      ? 'holodeck-node-disconnected'
      : '',
  ].filter(Boolean).join(' ');
  const testIdSuffix = `${testIdSlug(String(projectionKind ?? 'scene'))}-${testIdSlug(String(role ?? nodeKind))}-${testIdSlug(sceneNode.name)}`;

  return (
    <div
      className={className}
      data-testid={`holodeck-node-${testIdSuffix}`}
      data-active-step={sceneNode.metadata?.isActiveStep ? 'true' : 'false'}
      data-live-value={liveValue ? String(liveValue) : undefined}
      data-live-freshness={
        typeof sceneNode.metadata?.liveFreshness === 'string'
          ? sceneNode.metadata.liveFreshness
          : undefined
      }
      onDoubleClick={(event) => {
        if (!onLabelEdit || role === 'operator' || role === 'rail') return;
        event.stopPropagation();
        const nextLabel = window.prompt('Edit label', sceneNode.name)?.trim();
        if (nextLabel) onLabelEdit(sceneNode, nextLabel);
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div
        className="holodeck-node-label"
        data-testid={`holodeck-node-label-${testIdSuffix}`}
        title={sceneNode.name}
      >
        {sceneNode.name}
      </div>
      <div className="holodeck-node-kind">{String(nodeKind)}</div>
      {liveValue ? (
        <div className="holodeck-node-live-row">
          <span className="holodeck-node-live">{liveValue}</span>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function testIdSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'value';
}
