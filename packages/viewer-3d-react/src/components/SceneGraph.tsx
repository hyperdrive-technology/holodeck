/**
 * Renders the full Starfleet scene graph in 3D
 */

import { useMemo, useState } from 'react';
import type { SceneEdge, SceneNode } from '@starfleet/sdk';
import type { SceneGraphProps } from '../types';
import { buildNodePositions } from '../utils/sceneToThree';
import { SceneEdgeLine } from './SceneEdgeLine';
import { SceneNodeMesh } from './SceneNodeMesh';

export function SceneGraph({
  scene,
  onNodeSelect,
  onEdgeSelect,
}: SceneGraphProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const nodePositions = useMemo(
    () => buildNodePositions(scene.scene.nodes),
    [scene.scene.nodes]
  );

  const handleNodeSelect = (node: SceneNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    onNodeSelect?.([node]);
  };

  const handleEdgeSelect = (edge: SceneEdge) => {
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
    onEdgeSelect?.([edge]);
  };

  return (
    <group>
      {scene.scene.nodes.map((node) => (
        <SceneNodeMesh
          key={node.id}
          node={node}
          selected={selectedNodeId === node.id}
          onSelect={handleNodeSelect}
        />
      ))}
      {scene.scene.edges.map((edge) => (
        <SceneEdgeLine
          key={edge.id}
          edge={edge}
          nodePositions={nodePositions}
          selected={selectedEdgeId === edge.id}
          onSelect={handleEdgeSelect}
        />
      ))}
    </group>
  );
}
