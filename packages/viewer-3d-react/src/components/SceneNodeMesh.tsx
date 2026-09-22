import type { SceneNode, SceneObjectRenderer } from '@holodeck/sdk';
import { type ThreeEvent } from '@react-three/fiber';
import {
  type ComponentType,
  type MutableRefObject,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from 'react';
import type { Group } from 'three';
import { colorToRgb, resolveNodeColor, resolveOpacity } from '../utils/materials';

export interface SceneNodeMeshProps {
  node: SceneNode;
  selected?: boolean;
  objectRenderers?: Record<string, SceneObjectRenderer>;
  objectRefs?: MutableRefObject<Map<string, Group>>;
  onNodeSelect?: (nodes: SceneNode[]) => void;
  children?: ReactNode;
}

function PrimitiveGeometry({ node }: { node: SceneNode }) {
  const geometry = node.geometry;
  const params = geometry?.parameters ?? {};

  switch (geometry?.type) {
    case 'sphere': {
      const radius = Number(params.radius ?? 0.5);
      const widthSegments = Number(params.widthSegments ?? 32);
      const heightSegments = Number(params.heightSegments ?? 16);
      return <sphereGeometry args={[radius, widthSegments, heightSegments]} />;
    }
    case 'cylinder': {
      const radiusTop = Number(params.radiusTop ?? params.radius ?? 0.5);
      const radiusBottom = Number(params.radiusBottom ?? params.radius ?? 0.5);
      const height = Number(params.height ?? 1);
      const radialSegments = Number(params.radialSegments ?? 32);
      return (
        <cylinderGeometry
          args={[radiusTop, radiusBottom, height, radialSegments]}
        />
      );
    }
    case 'plane': {
      const width = Number(params.width ?? 1);
      const height = Number(params.height ?? 1);
      return <planeGeometry args={[width, height]} />;
    }
    case 'box':
    default: {
      const width = Number(params.width ?? 1);
      const height = Number(params.height ?? 1);
      const depth = Number(params.depth ?? 1);
      return <boxGeometry args={[width, height, depth]} />;
    }
  }
}

/**
 * Renders a single SceneNode as a transform group + primitive (or custom pack renderer).
 */
export function SceneNodeMesh({
  node,
  selected = false,
  objectRenderers,
  objectRefs,
  onNodeSelect,
  children,
}: SceneNodeMeshProps) {
  const groupRef = useRef<Group>(null);
  const color = resolveNodeColor(node);
  const { opacity, transparent } = resolveOpacity(node.material);
  const [r, g, b] = colorToRgb(color);
  const visible = node.visible !== false;

  useLayoutEffect(() => {
    const group = groupRef.current;
    const refs = objectRefs?.current;
    if (!group || !refs) {
      return;
    }
    refs.set(node.id, group);
    return () => {
      refs.delete(node.id);
    };
  }, [node, objectRefs]);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onNodeSelect?.([node]);
  };

  const custom = objectRenderers?.[node.type];
  if (custom?.render) {
    const CustomRenderer = custom.render as ComponentType<{
      node: SceneNode;
      selected?: boolean;
      onClick?: (event: ThreeEvent<MouseEvent>) => void;
    }>;
    return (
      <group
        ref={groupRef}
        visible={visible}
        position={[
          node.transform.position.x,
          node.transform.position.y,
          node.transform.position.z,
        ]}
        rotation={[
          node.transform.rotation.x,
          node.transform.rotation.y,
          node.transform.rotation.z,
        ]}
        scale={[
          node.transform.scale.x,
          node.transform.scale.y,
          node.transform.scale.z,
        ]}
      >
        <CustomRenderer
          node={node}
          selected={selected}
          onClick={handleClick}
        />
        {children}
      </group>
    );
  }

  // Skip non-primitive custom geometry when no pack renderer is registered.
  if (node.geometry?.type === 'custom') {
    return (
      <group
        ref={groupRef}
        visible={visible}
        position={[
          node.transform.position.x,
          node.transform.position.y,
          node.transform.position.z,
        ]}
        rotation={[
          node.transform.rotation.x,
          node.transform.rotation.y,
          node.transform.rotation.z,
        ]}
        scale={[
          node.transform.scale.x,
          node.transform.scale.y,
          node.transform.scale.z,
        ]}
      >
        {children}
      </group>
    );
  }

  return (
    <group
      ref={groupRef}
      visible={visible}
      position={[
        node.transform.position.x,
        node.transform.position.y,
        node.transform.position.z,
      ]}
      rotation={[
        node.transform.rotation.x,
        node.transform.rotation.y,
        node.transform.rotation.z,
      ]}
      scale={[
        node.transform.scale.x,
        node.transform.scale.y,
        node.transform.scale.z,
      ]}
      onClick={handleClick}
    >
      <mesh>
        <PrimitiveGeometry node={node} />
        <meshStandardMaterial
          color={[r, g, b]}
          opacity={opacity}
          transparent={transparent}
          metalness={node.material?.metalness ?? 0}
          roughness={node.material?.roughness ?? 0.55}
          wireframe={node.material?.wireframe ?? false}
          emissive={selected ? [0.15, 0.25, 0.45] : [0, 0, 0]}
          emissiveIntensity={selected ? 0.6 : 0}
        />
      </mesh>
      {children}
    </group>
  );
}
