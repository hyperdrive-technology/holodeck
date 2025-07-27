# @starfleet/viewer-2d-react

> 2D React viewer for Starfleet infrastructure diagrams

A React component library for visualizing infrastructure scenes in 2D using ReactFlow. This package provides interactive viewers for Starfleet scene files, supporting pan, zoom, layout algorithms, and real-time data visualization.

## Features

- **Interactive 2D Visualization**: Pan, zoom, and interact with infrastructure diagrams
- **Multiple Layout Algorithms**: Dagre hierarchical, force-directed, and manual layouts
- **Real-time Data**: Display live metrics and status updates on nodes and edges
- **Customizable Rendering**: Custom node and edge types with extensible styling
- **TypeScript Support**: Fully typed with comprehensive TypeScript definitions
- **React Integration**: Drop-in React components with minimal setup

## Installation

```bash
npm install @starfleet/viewer-2d-react
# or
pnpm add @starfleet/viewer-2d-react
```

## Quick Start

```tsx
import { StarfleetViewer2D } from '@starfleet/viewer-2d-react';
import type { SceneFile } from '@starfleet/sdk';

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
    <StarfleetViewer2D
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

### StarfleetViewer2D

The main viewer component for displaying 2D infrastructure diagrams.

```tsx
<StarfleetViewer2D
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

### StarfleetProvider

Context provider for sharing scene state across multiple components.

```tsx
<StarfleetProvider scene={sceneFile} layout="dagre">
  <StarfleetViewer2D />
  <ViewerControls />
  <ViewerMinimap />
</StarfleetProvider>
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
import { useLayout } from '@starfleet/viewer-2d-react';

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

### useStarfleet

Access the Starfleet store and actions:

```tsx
import { useStarfleet } from '@starfleet/viewer-2d-react';

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
  } = useStarfleet();

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
import { useLayout } from '@starfleet/viewer-2d-react';

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
<StarfleetViewer2D
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
import { NodeRenderer } from '@starfleet/viewer-2d-react';

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

This package is part of the Starfleet monorepo. For development:

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

#### StarfleetViewer2DProps

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

## License

MIT - See [LICENSE](../../LICENSE) for details.

## Related Packages

- [`@starfleet/sdk`](../sdk) - Core types and interfaces
- [`@starfleet/cli`](../cli) - Command-line tools
- [`@starfleet-pro/viewer-3d-react`](https://github.com/hyperdrive-technology/starfleet-pro) - 3D viewer (commercial)
