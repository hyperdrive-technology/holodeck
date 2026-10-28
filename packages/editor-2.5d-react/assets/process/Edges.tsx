import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BufferGeometry, Mesh } from 'three';
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
  const source = useRef<{ geometry: BufferGeometry; threshold: number } | null>(null);

  // No dependency list on purpose: the parent mesh can swap its geometry
  // (a pipe re-routed while dragging keeps its id but changes length, so
  // PipeRun builds a new geometry) without anything about <Edges> changing.
  // Re-extract only when the source or threshold really changed; the check
  // itself is two reference compares per render.
  useLayoutEffect(() => {
    // The parent mesh geometry only exists once R3F has attached us.
    const geometry = (line.parent as Mesh | null)?.geometry;
    if (!geometry) {
      return;
    }
    if (source.current?.geometry === geometry && source.current.threshold === threshold) return;
    source.current = { geometry, threshold };
    setEdgeLinesSource(line, geometry, threshold);
  });

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
