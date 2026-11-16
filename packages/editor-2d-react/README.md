# @holodeck/editor-2d-react

> 2D React editor for Holodeck infrastructure diagrams

A React component library for visualizing infrastructure scenes in 2D using ReactFlow. This package provides interactive viewers for Holodeck scene files, supporting pan, zoom, layout algorithms, and real-time data visualization.

## Features

- **Interactive 2D editing**: Pan, zoom, and interact with infrastructure diagrams
- **Multiple Layout Algorithms**: Dagre hierarchical, force-directed, and manual layouts
- **Real-time Data**: Display live metrics and status updates on nodes and edges
- **Customizable Rendering**: Custom node and edge types with extensible styling
- **TypeScript Support**: Fully typed with comprehensive TypeScript definitions
- **React Integration**: Drop-in React components with minimal setup

## Installation

```bash
npm install @holodeck/editor-2d-react
# or
pnpm add @holodeck/editor-2d-react
```

## Quick Start

```tsx
import { HolodeckEditor2D } from '@holodeck/editor-2d-react';
import type { SceneFile } from '@holodeck/sdk';

const scene: SceneFile = {
  version: '1.0.0',
  metadata: {
    name: 'My Infrastructure',
    description: 'A sample infrastructure diagram'
  },
  scene: {
    nodes: [
      {
        id: 'web-server',
        type: 'server',
        name: 'Web Server',
        transform: {
          position: { x: 100, y: 100, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 }
        }
      }
    ],
    edges: []
  }
};

function App() {
  return (
    <HolodeckEditor2D
      scene={scene}
      width="100%"
      height="600px"
      showControls={true}
      showMinimap={true}
      onNodeSelect={(nodes) => console.log('Selected nodes:', nodes)}
    />
  );
}
```

## Components

### HolodeckEditor2D

The main editor component for displaying 2D infrastructure diagrams.

```tsx
<HolodeckEditor2D
  scene={sceneFile}
  width="800px"
  height="600px"
  showControls={true}
  showMinimap={true}
  interactive={true}
  onNodeSelect={handleNodeSelection}
  onEdgeSelect={handleEdgeSelection}
  onViewChange={handleViewportChange}
/>
```

### HolodeckProvider

Context provider for sharing scene state across multiple components.

```tsx
<HolodeckProvider scene={sceneFile} layout="dagre">
  <HolodeckEditor2D />
  <ViewerControls />
  <ViewerMinimap />
</HolodeckProvider>
```

## Node Types

The viewer supports various infrastructure node types out of the box:

- **server**: Application servers, web servers
- **database**: SQL/NoSQL databases, data stores
- **network**: Load balancers, routers, gateways
- **storage**: File systems, object storage, CDNs
- **function**: Serverless functions, lambdas
- **container**: Docker containers, pods
- **queue**: Message queues, event streams
- **cache**: Redis, Memcached, CDN caches

### AWS Node Types

- **aws-ec2**: EC2 instances
- **aws-rds**: RDS databases
- **aws-s3**: S3 buckets
- **aws-lambda**: Lambda functions
- **aws-elb**: Load balancers
- **aws-vpc**: VPC networks
- **aws-sqs**: SQS queues
- **aws-sns**: SNS topics

## Layout Algorithms

### Dagre Hierarchical Layout

```tsx
import { useLayout } from '@holodeck/editor-2d-react';

const { applyLayout } = useLayout();

// Apply hierarchical layout
applyLayout('dagre', {
  direction: 'TB',     // Top to bottom
  nodeSpacing: 100,    // Space between nodes
  rankSpacing: 150,    // Space between ranks
  align: 'UL'          // Upper left alignment
});
```

### Force-Directed Layout

```tsx
// Apply force-directed layout
applyLayout('force', {
  forceConfig: {
    strength: -800,    // Repulsion strength
    distance: 200,     // Link distance
    iterations: 300    // Simulation steps
  }
});
```

### Manual Layout

```tsx
// Use manual positioning from scene file
applyLayout('manual');
```

## Hooks

### useHolodeck

Access the Holodeck store and actions:

```tsx
import { useHolodeck } from '@holodeck/editor-2d-react';

function MyComponent() {
  const {
    scene,
    nodes,
    edges,
    selectedNodes,
    setSelectedNodes,
    fitView,
    zoomIn,
    zoomOut
  } = useHolodeck();

  return (
    <div>
      <button onClick={fitView}>Fit View</button>
      <button onClick={zoomIn}>Zoom In</button>
      <button onClick={zoomOut}>Zoom Out</button>
    </div>
  );
}
```

### useLayout

Manage layout operations:

```tsx
import { useLayout } from '@holodeck/editor-2d-react';

function LayoutControls() {
  const {
    applyLayout,
    fitToView,
    resetLayout,
    currentLayout
  } = useLayout();

  return (
    <div>
      <button onClick={() => applyLayout('dagre')}>
        Dagre Layout
      </button>
      <button onClick={() => applyLayout('force')}>
        Force Layout
      </button>
      <button onClick={resetLayout}>
        Reset Layout
      </button>
      <span>Current: {currentLayout}</span>
    </div>
  );
}
```

## Styling

The viewer uses CSS modules and supports custom styling:

```tsx
<HolodeckEditor2D
  className="my-viewer"
  style={{
    border: '2px solid #blue',
    borderRadius: '8px',
    backgroundColor: '#f0f0f0'
  }}
  scene={scene}
/>
```

### Custom Node Rendering

```tsx
import { NodeRenderer } from '@holodeck/editor-2d-react';

function CustomServerNode({ node, selected }) {
  return (
    <div
      className={`custom-server ${selected ? 'selected' : ''}`}
      style={{
        backgroundColor: node.status === 'healthy' ? 'green' : 'red',
        padding: '8px',
        borderRadius: '4px'
      }}
    >
      <strong>{node.name}</strong>
      <div>CPU: {node.metrics?.cpu}%</div>
      <div>Memory: {node.metrics?.memory}%</div>
    </div>
  );
}
```

## Development

This package is part of the Holodeck monorepo. For development:

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run tests
pnpm test

# Watch mode for development
pnpm dev
```

## API Reference

### Props

#### HolodeckEditor2DProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `scene` | `SceneFile` | **required** | Scene file to render |
| `width` | `number \| string` | `"100%"` | Width of the viewer |
| `height` | `number \| string` | `"600px"` | Height of the viewer |
| `showControls` | `boolean` | `true` | Show zoom/pan controls |
| `showMinimap` | `boolean` | `true` | Show minimap |
| `interactive` | `boolean` | `true` | Enable user interaction |
| `nodeTypes` | `Record<string, ComponentType>` | - | Custom node components |
| `edgeTypes` | `Record<string, ComponentType>` | - | Custom edge components |
| `onNodeSelect` | `(nodes: SceneNode[]) => void` | - | Node selection callback |
| `onEdgeSelect` | `(edges: SceneEdge[]) => void` | - | Edge selection callback |
| `onViewChange` | `(viewport: ViewportState) => void` | - | Viewport change callback |
| `onNodesMoved` | `(moves: HolodeckNodeMove[], source: 'drag' \| 'keyboard') => void` | - | Fired once per completed drag (every node of a multi-selection drag in one call) or arrow-key nudge; never per frame |
| `snapGrid` | `number \| [number, number] \| false` | `false` | Snap drags (and nudges) to a grid in flow units |

### Persisting node positions

`onNodesMoved` reports where the user left nodes. Positions are flow coordinates of
the node's top-left corner, the same space as `SceneNode.transform.position.{x,y}`.

```tsx
<HolodeckEditor2D
  scene={scene}
  layout="manual"
  snapGrid={20}
  onNodesMoved={(moves) => setScene((s) => movePositions(s, moves))}
/>
```

Write the positions back into `scene` and the editor keeps them: no snap-back and no
refit (the view refits only when nodes or edges are added or removed, or `layout`
changes). Without write-back, moved nodes stay where the user left them until the host
gives a node a different position than it had before the move (undo, reset, re-layout).
With `layout="dagre"` the layout recomputes positions from the graph, so persist with
`layout="manual"`.

## License

MIT - See [LICENSE](../../LICENSE) for details.

## Related Packages

- [`@holodeck/sdk`](https://github.com/hyperdrive-technology/holodeck-sdk) - Core types and interfaces
- [`@holodeck/cli`](../cli) - Command-line tools
- [`@holodeck-pro/viewer-3d-react`](https://github.com/hyperdrive-technology/holodeck-pro) - 3D viewer (commercial)
