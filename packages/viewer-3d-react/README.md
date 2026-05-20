# @starfleet/viewer-3d-react

> 3D React viewer for Starfleet infrastructure scenes

A React component library for visualizing Starfleet scene files in 3D using **React Three Fiber v10**, with an explicit upgrade path to **WebGPU** when the browser supports it.

## Stack

| Package | Version | Role |
|---------|---------|------|
| `@react-three/fiber` | `10.0.0-alpha.2` | R3F v10 — dual WebGL / WebGPU renderer protocol |
| `three` | `^0.184` | Scene graph, materials, geometries |
| `@react-three/drei` | `^10` | Controls, grid, helpers |
| `react` | `^19` | Required by R3F v10 |

## Installation

```bash
pnpm add @starfleet/viewer-3d-react @starfleet/sdk three react react-dom
```

Peer dependencies: `react`, `react-dom`, `three`, `@starfleet/sdk`.

## Quick Start (WebGL default, WebGPU-ready)

```tsx
import { StarfleetViewer3D } from '@starfleet/viewer-3d-react';
import type { SceneFile } from '@starfleet/sdk';

const scene: SceneFile = { /* ... */ };

export function App() {
  return (
    <StarfleetViewer3D
      scene={scene}
      width="100%"
      height="600px"
      backend="auto"
    />
  );
}
```

## Renderer backends

The `backend` prop selects how Three.js renders:

| Value | Behavior |
|-------|----------|
| `auto` (default) | R3F v10 default import; passes `renderer` so WebGPU is used when available, otherwise WebGL |
| `webgpu` | Same as `auto` — explicitly opts into the WebGPU protocol |
| `webgl` | Legacy `@react-three/fiber/legacy` — `WebGLRenderer` only, no deprecation warnings |

```tsx
// Force WebGPU protocol (falls back per R3F/Three when unsupported)
<StarfleetViewer3D scene={scene} backend="webgpu" />

// Strict WebGL for older targets or testing
<StarfleetViewer3D scene={scene} backend="webgl" />
```

### Low-level Canvas

```tsx
import { StarfleetCanvas, SceneGraph } from '@starfleet/viewer-3d-react';

<StarfleetCanvas backend="webgpu" camera={{ position: [10, 10, 10], fov: 50 }}>
  <SceneGraph scene={scene} />
</StarfleetCanvas>
```

### WebGPU / TSL entry point

For TSL shaders and WebGPU-specific hooks (`useUniforms`, `useNodes`, …), import from the dedicated subpath:

```tsx
import { Canvas, useUniforms, StarfleetViewer3D } from '@starfleet/viewer-3d-react/webgpu';
```

## R3F v10 notes

- Use `state.renderer` instead of deprecated `state.gl` in `useThree()` / `useFrame()`.
- To stay on WebGL only without warnings: `import { Canvas } from '@react-three/fiber/legacy'`.
- WebGPU is **opt-in** via the `renderer` prop on `Canvas` (handled by `StarfleetCanvas` when `backend` is `webgpu` or `auto`).

See the [R3F v10 migration guide](https://github.com/pmndrs/react-three-fiber/blob/v10/docs/v10-migration.md).

## Related packages

- [`@starfleet/viewer-2d-react`](../viewer-2d-react) — 2D diagram viewer (ReactFlow)
- [`@starfleet/sdk`](https://github.com/hyperdrive-technology/starfleet-sdk) — Scene file types and utilities
