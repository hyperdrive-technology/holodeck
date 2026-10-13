import { useEffect, useLayoutEffect, useState } from 'react';
import type { Mesh } from 'three';
import type { Line2NodeMaterial } from 'three/webgpu';
import { createEdgeLines, setEdgeLinesAppearance, setEdgeLinesSource } from './edge-lines';
import { useHolodeckStyle } from './style-context';

/**
 * Fat edges for WebGPURenderer, as an R3F child of the mesh to outline.
 * Thin wrapper over `createEdgeLines` (edge-lines.ts), which holds the
 * WebGPU notes (why not drei `Edges`, the instanceCount=0 workaround).
 */
export function Edges({
  threshold: thresholdProp,
  color: colorProp,
  lineWidth: lineWidthProp,
}: {
  threshold?: number;
  color?: string;
  lineWidth?: number;
}) {
  const style = useHolodeckStyle();
  const threshold = thresholdProp ?? style.edges.threshold;
  const color = colorProp ?? style.colors.edge;
  const lineWidth = lineWidthProp ?? style.edges.lineWidth;
  const [line] = useState(() => createEdgeLines(null, { color, lineWidth }));

  useLayoutEffect(() => {
    // The parent mesh geometry only exists once R3F has attached us.
    const geometry = (line.parent as Mesh | null)?.geometry;
    if (!geometry) {
      return;
    }
    setEdgeLinesSource(line, geometry, threshold);
  }, [line, threshold]);

  useLayoutEffect(() => {
    setEdgeLinesAppearance(line, { color, lineWidth });
  }, [line, color, lineWidth]);

  // The pre-extraction component never freed these; `<primitive>` does not
  // dispose objects it did not construct.
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as Line2NodeMaterial).dispose();
    },
    [line],
  );

  return <primitive object={line} />;
}
