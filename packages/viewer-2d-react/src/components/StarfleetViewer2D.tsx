/**
 * Main 2D viewer component for Starfleet scenes
 */

import type { StarfleetViewer2DProps } from '../types';

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

  // TODO: Implement the actual viewer component
  // This is a placeholder implementation

  return (
    <div
      className={className}
      style={{
        width,
        height,
        border: '1px solid #ccc',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9fafb',
        ...style,
      }}
    >
      <div style={{ textAlign: 'center', color: '#6b7280' }}>
        <h3>Starfleet 2D Viewer</h3>
        <p>Scene: {scene.metadata.name}</p>
        <p>Nodes: {scene.scene.nodes.length}</p>
        <p>Edges: {scene.scene.edges.length}</p>
        <p style={{ fontSize: '12px', marginTop: '16px' }}>
          This is a placeholder. The full ReactFlow implementation is coming
          next.
        </p>
      </div>
    </div>
  );
}
