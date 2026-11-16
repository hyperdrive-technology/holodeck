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
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
  type NodeProps,
  type OnNodeDrag,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './holodeck-editor.css';

import type { SceneNode } from '@holodeck/sdk';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { DEFAULT_LAYOUT_CONFIG } from '../constants';
import type { HolodeckEditor2DProps, ReactFlowNodeData } from '../types';
import { mergeFlowComponents } from '../registry/merge';
import {
  useFlowEdgeTypeContributions,
  useFlowNodeTypeContributions,
  useFlowPaletteContributions,
  useOptionalFlowRegistry,
} from '../registry/react';
import {
  autoLayoutScene,
  createSceneNodeFromPaletteItem,
  resolvePaletteDrop,
  sceneFileToReactFlow,
} from '../utils';
import { HolodeckPalette } from './HolodeckPalette';
import {
  applyPositionOverrides,
  buildMoves,
  graphStructureKey,
  normalizeSnapGrid,
  recordOverrides,
  type PositionOverride,
  type XY,
} from './nodeMoves';

const FIT_VIEW_OPTIONS = { padding: 0.12, minZoom: 0.08, maxZoom: 1.25 } as const;

const nodeTypes: Record<string, any> = {
  holodeckNode: HolodeckSceneNode,
};

// useReactFlow() (needed for screenToFlowPosition on drop) requires a provider
// above the component; the `onInit` instance is async and unavailable until the
// viewport has measured dimensions, so it is not reliable for drop handling.
export function HolodeckEditor2D(props: HolodeckEditor2DProps) {
  return (
    <ReactFlowProvider>
      <HolodeckEditor2DInner {...props} />
    </ReactFlowProvider>
  );
}

function HolodeckEditor2DInner(props: HolodeckEditor2DProps) {
  const {
    scene,
    width = '100%',
    height = '600px',
    showControls = true,
    showMinimap = true,
    interactive = true,
    className,
    style,
    nodeTypes: explicitNodeTypes,
    edgeTypes: explicitEdgeTypes,
    registry: registryProp,
    showPalette = false,
    paletteItems: paletteItemsProp,
    onDropPaletteItem,
    onNodeSelect,
    onNodeClick,
    onNodeDoubleClick,
    onNodeLabelEdit,
    onEdgeSelect,
    onViewChange,
    onNodesMoved,
    snapGrid: snapGridProp,
    layout = 'dagre',
    layoutConfig,
  } = props;

  const contextRegistry = useOptionalFlowRegistry();
  const registry = registryProp ?? contextRegistry;
  const nodeContribs = useFlowNodeTypeContributions(registry);
  const edgeContribs = useFlowEdgeTypeContributions(registry);
  const registryPalette = useFlowPaletteContributions(registry);
  const customNodeTypes = useMemo(
    () => mergeFlowComponents<any>('nodeTypes', {}, nodeContribs, explicitNodeTypes),
    [nodeContribs, explicitNodeTypes],
  );
  const customEdgeTypes = useMemo(
    () => mergeFlowComponents<any>('edgeTypes', {}, edgeContribs, explicitEdgeTypes),
    [edgeContribs, explicitEdgeTypes],
  );
  const paletteItems = useMemo(
    () => [...registryPalette, ...(paletteItemsProp ?? [])],
    [registryPalette, paletteItemsProp],
  );

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
        node.type && (customNodeTypes[node.type] || node.type === 'holodeckNode') ? node.type : 'holodeckNode',
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
  const edges = useMemo<Edge[]>(
    () =>
      converted.edges.map((edge) => {
        const customType =
          edge.type && customEdgeTypes[edge.type] ? edge.type : undefined;
        const next: Edge = {
          ...edge,
          type: customType ?? 'smoothstep',
        };
        // `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional
        // property, so only set `markerEnd` when we actually want the arrow head.
        if (!customType) next.markerEnd = { type: MarkerType.ArrowClosed };
        if (edge.data?.label) next.label = edge.data.label;
        return next;
      }),
    [converted.edges, customEdgeTypes],
  );

  // `ReactFlowInstance` is generic over the node type; `onInit` hands us an
  // instance parameterised by our positioned node shape, so type the ref the
  // same way instead of the default `Node` (which is not assignable because
  // `setNodes` makes the parameter contravariant).
  type FlowNode = (typeof nodes)[number];
  const flowRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);

  // --- Node positions -------------------------------------------------------
  // React Flow in controlled mode (`nodes` prop) only moves or selects a node
  // when `onNodesChange` writes the change back, so the editor keeps the nodes
  // it renders in local state: `nodes` (from `scene` + layout) seeds it, and
  // user moves are kept as overrides until the host writes them back or sets a
  // different position (see `applyPositionOverrides`).
  const overridesRef = useRef<Map<string, PositionOverride>>(new Map());
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(
    () => applyPositionOverrides(nodes, overridesRef.current).nodes,
  );
  const flowNodesRef = useRef(flowNodes);
  flowNodesRef.current = flowNodes;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const onNodesMovedRef = useRef(onNodesMoved);
  onNodesMovedRef.current = onNodesMoved;
  // Non-null while a drag is in progress: the node under the pointer and the
  // positions of every dragged node at drag start. React Flow calls
  // onNodeDragStart/Stop for single-node and selection drags alike.
  const dragRef = useRef<{ grabbedId: string; start: Map<string, XY> } | null>(null);

  // Layout effect, not effect: a scene update must not paint one frame with
  // stale node positions.
  const seededNodesRef = useRef(nodes);
  useLayoutEffect(() => {
    if (seededNodesRef.current === nodes) return;
    seededNodesRef.current = nodes;
    const merged = applyPositionOverrides(nodes, overridesRef.current);
    overridesRef.current = merged.overrides;

    // A drag in progress survives unrelated scene updates (live values arrive
    // every scan). If the host removed the node under the pointer, React Flow
    // unmounts its drag handler and never calls onNodeDragStop, so end the drag
    // here; otherwise keyboard nudges would be mistaken for drag frames forever.
    const drag = dragRef.current;
    if (drag) {
      const incoming = new Set(nodes.map((node) => node.id));
      if (!incoming.has(drag.grabbedId)) {
        dragRef.current = null;
      } else {
        for (const id of drag.start.keys()) if (!incoming.has(id)) drag.start.delete(id);
      }
    }
    const dragging = dragRef.current?.start;

    setFlowNodes((prev) => {
      // Carry React Flow's per-node UI state (selection, measured size, and the
      // live position of nodes being dragged) over to the fresh node objects.
      const prevById = new Map(prev.map((node) => [node.id, node]));
      return merged.nodes.map((node) => {
        const before = prevById.get(node.id);
        if (!before) return node;
        const next = { ...node };
        if (before.selected !== undefined) next.selected = before.selected;
        if (before.measured !== undefined) next.measured = before.measured;
        if (dragging?.has(node.id)) {
          next.position = before.position;
          if (before.dragging !== undefined) next.dragging = before.dragging;
        }
        return next;
      });
    });
  }, [nodes]);

  const report = useCallback(
    (moved: ReadonlyArray<{ id: string; position: XY; data?: unknown }>, previous: ReadonlyMap<string, XY>, source: 'drag' | 'keyboard') => {
      const moves = buildMoves(moved, previous);
      if (moves.length === 0) return;
      const sceneById = new Map(nodesRef.current.map((node) => [node.id, node.position]));
      overridesRef.current = recordOverrides(
        overridesRef.current,
        moves.map((move) => ({
          nodeId: move.nodeId,
          position: move.position,
          base: sceneById.get(move.nodeId) ?? move.previousPosition,
        })),
      );
      onNodesMovedRef.current?.(moves, source);
    },
    [],
  );

  const onNodeDragStart = useCallback<OnNodeDrag<FlowNode>>((_event, grabbed, dragged) => {
    dragRef.current = {
      grabbedId: grabbed.id,
      start: new Map(dragged.map((node) => [node.id, { ...node.position }])),
    };
  }, []);
  const onNodeDragStop = useCallback<OnNodeDrag<FlowNode>>(
    (_event, _node, dragged) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag) report(dragged, drag.start, 'drag');
    },
    [report],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      // Arrow-key nudges arrive as `position` changes with `dragging: false`
      // outside a drag (a drag's final change also has `dragging: false`, but
      // dragRef is still set then and onNodeDragStop reports it).
      if (!dragRef.current) {
        const nudged: Array<{ id: string; position: XY; data?: unknown }> = [];
        const previous = new Map<string, XY>();
        const current = new Map(flowNodesRef.current.map((node) => [node.id, node]));
        for (const change of changes) {
          if (change.type !== 'position' || !change.position || change.dragging) continue;
          const node = current.get(change.id);
          if (!node) continue;
          previous.set(node.id, node.position);
          nudged.push({ id: node.id, position: change.position, data: node.data });
        }
        if (nudged.length > 0) report(nudged, previous, 'keyboard');
      }
      // Nodes come from `scene`; only the host may remove them. React Flow's
      // delete key is off (deleteKeyCode={null}) and any other `remove` change
      // is dropped too, until there is a delete contract that tells the host.
      const kept = changes.filter((change) => change.type !== 'remove');
      if (kept.length > 0) setFlowNodes((prev) => applyNodeChanges(kept, prev));
    },
    [report],
  );

  const snapGrid = normalizeSnapGrid(snapGridProp);

  // Fit the graph into view when it is a different graph (nodes/edges added or
  // removed, layout mode changed) — never because a node moved.
  const structureKey = graphStructureKey(nodes, edges, layout);
  useEffect(() => {
    const instance = flowRef.current;
    if (!instance) return;
    const frame = window.requestAnimationFrame(() => {
      instance.fitView(FIT_VIEW_OPTIONS);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [structureKey]);

  const { screenToFlowPosition } = useReactFlow();
  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('application/holodeck-palette-item')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const onDrop = useCallback(
    (event: DragEvent) => {
      const hit = resolvePaletteDrop(event, paletteItems, screenToFlowPosition);
      if (!hit) return;
      event.preventDefault();
      onDropPaletteItem?.(hit.item, hit.position, createSceneNodeFromPaletteItem(hit.item, hit.position));
    },
    [paletteItems, onDropPaletteItem, screenToFlowPosition],
  );

  return (
    <div
      className={[className, showPalette ? 'holodeck-editor-with-palette' : ''].filter(Boolean).join(' ') || undefined}
      style={{ width, height, ...style }}
    >
      {showPalette ? <HolodeckPalette items={paletteItems} /> : null}
      <div className="holodeck-editor-canvas" style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodes={flowNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        deleteKeyCode={null}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        snapToGrid={snapGrid !== undefined}
        {...(snapGrid ? { snapGrid } : {})}
        nodeTypes={{ ...nodeTypes, ...customNodeTypes } as any}
        edgeTypes={customEdgeTypes as any}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        nodesDraggable={interactive}
        nodesConnectable={interactive}
        elementsSelectable
        onInit={(instance) => {
          flowRef.current = instance;
          window.requestAnimationFrame(() => {
            instance.fitView(FIT_VIEW_OPTIONS);
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
        <Background gap={snapGrid ?? 18} />
        {showControls ? <Controls showInteractive={interactive} /> : null}
        {showMinimap ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}
      </ReactFlow>
      </div>
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
  ].filter(Boolean).join(' ');
  const testIdSuffix = `${testIdSlug(String(projectionKind ?? 'scene'))}-${testIdSlug(String(role ?? nodeKind))}-${testIdSlug(sceneNode.name)}`;

  return (
    <div
      className={className}
      data-testid={`holodeck-node-${testIdSuffix}`}
      data-active-step={sceneNode.metadata?.isActiveStep ? 'true' : 'false'}
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
