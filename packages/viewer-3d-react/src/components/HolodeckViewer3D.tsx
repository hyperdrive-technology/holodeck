/**
 * Read-only 3D viewer for Holodeck scenes (React Three Fiber).
 */

import type { Color, SceneGraph, SceneNode } from '@holodeck/sdk';
import { Bounds, OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import {
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import type { Group } from 'three';
import type { HolodeckViewer3DProps } from '../types';
import { liveOverlayChrome, liveOverlayCopy } from '../live-overlay';
import { colorToRgb } from '../utils/materials';
import { AnimationRunner } from './AnimationRunner';
import { SceneNodeMesh } from './SceneNodeMesh';

function colorToCss(color: Color | string | undefined, fallback: string): string {
  if (!color) {
    return fallback;
  }
  if (typeof color === 'string') {
    return color;
  }
  const [r, g, b] = colorToRgb(color);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function SceneLights({ lights }: { lights?: SceneGraph['lights'] }) {
  if (!lights?.length) {
    return (
      <>
        <ambientLight intensity={0.45} />
        <directionalLight position={[8, 12, 6]} intensity={0.85} />
      </>
    );
  }

  return (
    <>
      {lights.map((light, index) => {
        const key = `${light.type}-${index}`;
        const intensity = light.intensity ?? 1;
        const color = light.color
          ? colorToRgb(light.color)
          : ([1, 1, 1] as [number, number, number]);
        const position: [number, number, number] = light.position
          ? [light.position.x, light.position.y, light.position.z]
          : [0, 5, 0];

        switch (light.type) {
          case 'ambient':
            return <ambientLight key={key} color={color} intensity={intensity} />;
          case 'directional': {
            const direction = light.direction ?? { x: -1, y: -1, z: -1 };
            return (
              <directionalLight
                key={key}
                color={color}
                intensity={intensity}
                position={[
                  -direction.x * 10,
                  -direction.y * 10,
                  -direction.z * 10,
                ]}
              />
            );
          }
          case 'point':
            return (
              <pointLight
                key={key}
                color={color}
                intensity={intensity}
                position={position}
              />
            );
          case 'spot':
            return (
              <spotLight
                key={key}
                color={color}
                intensity={intensity}
                position={position}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function SceneFog({ fog }: { fog?: NonNullable<SceneGraph['environment']>['fog'] }) {
  if (!fog) {
    return null;
  }
  const [r, g, b] = colorToRgb(fog.color);
  const css = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  return <fog attach="fog" args={[css, fog.near, fog.far]} />;
}

interface SceneTreeProps {
  nodes: SceneNode[];
  objectRenderers?: HolodeckViewer3DProps['objectRenderers'];
  objectRefs: MutableRefObject<Map<string, Group>>;
  selectedNodeIds?: string[];
  onNodeSelect?: HolodeckViewer3DProps['onNodeSelect'];
}

/**
 * Build a parent → children map and render root nodes recursively so
 * hierarchical SceneNode.parent/children relationships nest in the R3F graph.
 */
function SceneTree({
  nodes,
  objectRenderers,
  objectRefs,
  selectedNodeIds,
  onNodeSelect,
}: SceneTreeProps) {
  const { roots, childrenByParent } = useMemo(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const childrenByParent = new Map<string, SceneNode[]>();
    const rooted = new Set<string>();

    for (const node of nodes) {
      if (node.parent && byId.has(node.parent)) {
        const list = childrenByParent.get(node.parent) ?? [];
        list.push(node);
        childrenByParent.set(node.parent, list);
        rooted.add(node.id);
      }
    }

    // Also honour explicit children arrays when parent links are missing.
    for (const node of nodes) {
      for (const childId of node.children ?? []) {
        const child = byId.get(childId);
        if (!child || rooted.has(childId)) {
          continue;
        }
        const list = childrenByParent.get(node.id) ?? [];
        list.push(child);
        childrenByParent.set(node.id, list);
        rooted.add(childId);
      }
    }

    const roots = nodes.filter((node) => !rooted.has(node.id));
    return { roots, childrenByParent };
  }, [nodes]);

  const selected = useMemo(
    () => new Set(selectedNodeIds ?? []),
    [selectedNodeIds]
  );

  const renderNode = (node: SceneNode): ReactNode => {
    const kids = childrenByParent.get(node.id) ?? [];
    return (
      <SceneNodeMesh
        key={node.id}
        node={node}
        selected={selected.has(node.id)}
        objectRenderers={objectRenderers}
        objectRefs={objectRefs}
        onNodeSelect={onNodeSelect}
      >
        {kids.map(renderNode)}
      </SceneNodeMesh>
    );
  };

  return <>{roots.map(renderNode)}</>;
}

function SceneContent({
  scene,
  interactive,
  showGrid,
  objectRenderers,
  animationHooks,
  selectedNodeIds,
  onNodeSelect,
}: {
  scene: SceneGraph;
  interactive: boolean;
  showGrid: boolean;
  objectRenderers?: HolodeckViewer3DProps['objectRenderers'];
  animationHooks?: HolodeckViewer3DProps['animationHooks'];
  selectedNodeIds?: string[];
  onNodeSelect?: HolodeckViewer3DProps['onNodeSelect'];
}) {
  const objectRefs = useRef(new Map<string, Group>());
  const cameraTarget = scene.camera?.target;

  return (
    <>
      <SceneLights lights={scene.lights} />
      <SceneFog fog={scene.environment?.fog} />
      {showGrid ? <gridHelper args={[20, 20]} /> : null}

      <Bounds fit clip observe margin={1.2}>
        <SceneTree
          nodes={scene.nodes}
          objectRenderers={objectRenderers}
          objectRefs={objectRefs}
          selectedNodeIds={selectedNodeIds}
          onNodeSelect={onNodeSelect}
        />
      </Bounds>

      <AnimationRunner
        scene={scene}
        nodes={scene.nodes}
        animationHooks={animationHooks}
        objectRefs={objectRefs}
      />

      <OrbitControls
        makeDefault
        enabled={interactive}
        target={
          cameraTarget
            ? [cameraTarget.x, cameraTarget.y, cameraTarget.z]
            : undefined
        }
      />
    </>
  );
}

export function HolodeckViewer3D(props: HolodeckViewer3DProps) {
  const {
    scene,
    width = '100%',
    height = '600px',
    interactive = true,
    showGrid = false,
    className,
    style,
    onNodeSelect,
    objectRenderers,
    animationHooks,
    selectedNodeIds,
    liveConnection,
  } = props;

  const camera = scene.scene.camera;
  const background = colorToCss(scene.scene.environment?.background, '#0b1020');
  const overlayCopy = liveConnection ? liveOverlayCopy(liveConnection) : null;
  const overlayChrome = liveConnection ? liveOverlayChrome(liveConnection.state) : null;

  return (
    <div
      className={className}
      data-testid="holodeck-viewer-3d"
      data-connection-state={liveConnection?.state ?? ''}
      data-runtime-target={liveConnection?.targetId ?? ''}
      style={{
        width,
        height,
        border: '1px solid #ccc',
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: background,
        position: 'relative',
        ...style,
      }}
    >
      {liveConnection && overlayChrome ? (
        <div
          data-testid="holodeck-live-overlay"
          data-connection-state={liveConnection.state}
          data-runtime-target={liveConnection.targetId}
          style={{
            position: 'absolute',
            zIndex: 2,
            top: 8,
            left: 8,
            borderRadius: 999,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            pointerEvents: 'none',
            background: overlayChrome.background,
            color: overlayChrome.color,
          }}
        >
          {overlayCopy}
        </div>
      ) : null}
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{
          position: camera
            ? [camera.position.x, camera.position.y, camera.position.z]
            : [6, 5, 8],
          fov: camera?.fov ?? 50,
          near: camera?.near ?? 0.1,
          far: camera?.far ?? 2000,
        }}
        style={{ width: '100%', height: '100%' }}
        onPointerMissed={() => onNodeSelect?.([])}
      >
        <color attach="background" args={[background]} />
        <SceneContent
          scene={scene.scene}
          interactive={interactive}
          showGrid={showGrid}
          objectRenderers={objectRenderers}
          animationHooks={animationHooks}
          selectedNodeIds={selectedNodeIds}
          onNodeSelect={onNodeSelect}
        />
      </Canvas>
    </div>
  );
}
