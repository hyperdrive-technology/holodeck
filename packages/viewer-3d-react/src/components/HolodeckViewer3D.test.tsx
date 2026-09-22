/**
 * Mounts HolodeckViewer3D (Canvas mocked — this is not the R3F scene test).
 * Overlay copy must stay `Live · <selected target>`.
 */

import { createElement, type ReactNode } from 'react';
import { createTransform, type SceneFile } from '@holodeck/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: ReactNode }) =>
    createElement('div', { 'data-testid': 'r3f-canvas' }, children),
  useFrame: () => undefined,
}));

vi.mock('@react-three/drei', () => ({
  Bounds: ({ children }: { children?: ReactNode }) => children ?? null,
  OrbitControls: () => null,
}));

import { HolodeckViewer3D } from './HolodeckViewer3D';

const scene: SceneFile = {
  version: '0.1.0',
  metadata: { name: 'Overlay fixture' },
  scene: {
    nodes: [
      {
        id: 'inbound',
        type: 'factory:conveyor',
        name: 'Inbound',
        transform: createTransform(),
      },
    ],
  },
};

describe('HolodeckViewer3D overlay', () => {
  it('shows Live · inbound for the selected live target', () => {
    const html = renderToStaticMarkup(
      createElement(HolodeckViewer3D, {
        scene,
        liveConnection: {
          state: 'live',
          targetId: 'inbound',
          targetLabel: 'inbound',
        },
      }),
    );
    expect(html).toContain('data-testid="holodeck-viewer-3d"');
    expect(html).toContain('data-testid="holodeck-live-overlay"');
    expect(html).toContain('Live · inbound');
    expect(html).not.toContain('Deploy without Connect');
  });
});
