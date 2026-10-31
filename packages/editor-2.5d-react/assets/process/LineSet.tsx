import { useEffect, useLayoutEffect, useState } from 'react';
import type { Line2NodeMaterial } from 'three/webgpu';
import { createLineSet, setEdgeLinesAppearance, setLineSetPositions } from './edge-lines';

/**
 * Fat line segments from precomputed positions (vessel meridians, rim and
 * hoop rings, the waterline). Replaces Tank's 1-device-pixel `LineBag`
 * (lineBasicMaterial): at the review shots' DPR 2 those read about half as
 * heavy as the Edges creases next to them, so interior lines looked faint
 * vs reference.jpg. Same Line2NodeMaterial as `Edges`, so one weight token.
 */
export function LineSet({
  positions,
  color,
  width,
  renderOrder,
}: {
  positions: Float32Array;
  color: string;
  /** CSS px. */
  width: number;
  renderOrder?: number;
}) {
  const [line] = useState(() => createLineSet(null, { color, lineWidth: width }));
  useLayoutEffect(() => setLineSetPositions(line, positions), [line, positions]);
  useLayoutEffect(() => setEdgeLinesAppearance(line, { color, lineWidth: width }), [line, color, width]);
  useLayoutEffect(() => {
    line.renderOrder = renderOrder ?? 0;
  }, [line, renderOrder]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as Line2NodeMaterial).dispose();
    },
    [line],
  );
  return <primitive object={line} />;
}
