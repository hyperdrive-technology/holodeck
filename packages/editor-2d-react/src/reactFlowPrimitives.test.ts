import * as xyflow from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import * as editor from './index';

// Node/edge renderer packages rely on these re-exports being the *same*
// objects as React Flow's own (one store/context), not look-alikes.
describe('React Flow primitive re-exports', () => {
  const names = [
    'BaseEdge',
    'EdgeLabelRenderer',
    'Handle',
    'Position',
    'ReactFlowProvider',
    'getBezierPath',
    'getSmoothStepPath',
    'getStraightPath',
  ] as const;

  it.each(names)('re-exports %s from @xyflow/react by identity', (name) => {
    expect(editor[name]).toBeDefined();
    expect(editor[name]).toBe(xyflow[name]);
  });

  it('exposes the Position enum values renderers place handles with', () => {
    expect(editor.Position.Left).toBe('left');
    expect(editor.Position.Right).toBe('right');
    expect(editor.Position.Top).toBe('top');
    expect(editor.Position.Bottom).toBe('bottom');
  });
});
