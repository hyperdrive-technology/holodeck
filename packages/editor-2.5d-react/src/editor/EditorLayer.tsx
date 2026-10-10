import { useRef } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import { Pipe } from '../../assets/process';
import { SceneGraph } from '../iso/SceneGraph';
import { SceneObjectView } from '../iso/SceneObjectView';
import { gridToWorld } from '../iso/grid';
import type { IsoPlacement } from '../iso/scene';
import type { IsoMetrics } from '../registry/types';
import { useIsoRegistry } from '../registry/react';
import type { Vector3Tuple } from 'three';
import type { ContributionRegistry } from '@holodeck/sdk';
import { manhattanRoute, footprint } from './routing';
import { pointerToGrid } from './snap';
import { stamp, type EditorState } from './editor-state';

function gridFromEvent(event: ThreeEvent<PointerEvent>): { x: number; y: number } {
  return pointerToGrid(event.point.x, event.point.z);
}

export function EditorLayer({
  state,
  target,
  spacePan,
  onCursor,
  onFloorClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onPan,
  metrics,
  readOnly = false,
  onSelectObject,
}: {
  state: EditorState;
  target: Vector3Tuple;
  spacePan: boolean;
  onCursor: (x: number, y: number) => void;
  onFloorClick: (x: number, y: number) => void;
  onDragStart: (id: string, x: number, y: number) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: () => void;
  onPan: (next: Vector3Tuple) => void;
  metrics?: IsoMetrics;
  /** Run mode: no ghost, halo or drags; clicking a part only reports it. */
  readOnly?: boolean;
  onSelectObject?: (id: string) => void;
}) {
  const registry = useIsoRegistry();
  const pan = useRef<{
    wx: number;
    wz: number;
    tx: number;
    tz: number;
  } | null>(null);

  const handleMove = (event: ThreeEvent<PointerEvent>) => {
    const g = gridFromEvent(event);
    onCursor(g.x, g.y);
    if (pan.current) {
      const dx = event.point.x - pan.current.wx;
      const dz = event.point.z - pan.current.wz;
      onPan([pan.current.tx - dx, 0, pan.current.tz - dz]);
      return;
    }
    onDragMove(g.x, g.y);
  };

  const handleUp = (event: ThreeEvent<PointerEvent>) => {
    pan.current = null;
    onDragEnd();
    event.stopPropagation();
  };

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        onPointerDown={(event) => {
          if (event.button === 2 || spacePan) {
            pan.current = { wx: event.point.x, wz: event.point.z, tx: target[0], tz: target[2] };
            event.stopPropagation();
            return;
          }
          if (event.button !== 0) {
            return;
          }
          const g = gridFromEvent(event);
          onFloorClick(g.x, g.y);
        }}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group onPointerMove={handleMove} onPointerUp={handleUp}>
        <SceneGraph
          objects={state.scene.objects}
          metrics={metrics}
          selectedId={readOnly ? null : state.selectedId}
          onObjectPointerDown={(id, event) => {
            if (event.button === 2 || spacePan) {
              pan.current = { wx: event.point.x, wz: event.point.z, tx: target[0], tz: target[2] };
              event.stopPropagation();
              return;
            }
            if (event.button !== 0) {
              return;
            }
            if (readOnly) {
              onSelectObject?.(id);
              event.stopPropagation();
              return;
            }
            if (state.mode !== 'select') {
              const g = gridFromEvent(event);
              onFloorClick(g.x, g.y);
              event.stopPropagation();
              return;
            }
            event.stopPropagation();
            const g = gridFromEvent(event);
            onDragStart(id, g.x, g.y);
          }}
        />
        {state.selectedId && !readOnly
          ? (() => {
              const selected = state.scene.objects.find((o) => o.id === state.selectedId);
              return selected ? <SelectionHalo object={selected} registry={registry} /> : null;
            })()
          : null}
      </group>
      {!readOnly && state.mode === 'place' && state.placing && state.cursor ? (
        <Ghost kind={state.placing} x={state.cursor.x} y={state.cursor.y} registry={registry} />
      ) : null}
      {!readOnly && state.mode === 'draw-pipe' && state.pipeStart && state.cursor ? (
        <PipePreview from={state.pipeStart} to={state.cursor} registry={registry} />
      ) : null}
    </group>
  );
}

function Ghost({
  kind,
  x,
  y,
  registry,
}: {
  kind: NonNullable<EditorState['placing']>;
  x: number;
  y: number;
  registry: ContributionRegistry;
}) {
  const [wx, , wz] = gridToWorld(x, y);
  const { w, h } = footprint(registry, kind);
  return (
    <group>
      <mesh position={[wx, 0.04, wz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial color="#18BAE6" transparent opacity={0.28} />
      </mesh>
      <SceneObjectView object={stamp(registry, kind, x, y, '__ghost')} registry={registry} />
    </group>
  );
}

function PipePreview({
  from,
  to,
  registry,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  registry: ContributionRegistry;
}) {
  const { pipes, elbow } = manhattanRoute(from, to);
  return (
    <group>
      {pipes.map((pipe, i) => {
        const [wx, , wz] = gridToWorld(pipe.x, pipe.y);
        const [tx, , tz] = gridToWorld(pipe.toX, pipe.toY);
        return <Pipe key={i} from={[wx, wz]} to={[tx, tz]} band="#95a5a6" />;
      })}
      {elbow ? <SelectionHalo object={{ id: 'elbow-preview', object: 'elbow', x: elbow.x, y: elbow.y }} registry={registry} /> : null}
    </group>
  );
}

function SelectionHalo({ object, registry }: { object: IsoPlacement; registry: ContributionRegistry }) {
  const [wx, , wz] = gridToWorld(object.x, object.y);
  const { w, h } = footprint(registry, object.object);
  const r = Math.max(w, h) * 0.55;
  return (
    <mesh position={[wx, 0.03, wz]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r * 0.85, r, 24]} />
      <meshBasicMaterial color="#18BAE6" />
    </mesh>
  );
}
