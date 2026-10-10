import { EdgesGeometry, type BufferGeometry, type ColorRepresentation } from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { Line2NodeMaterial } from 'three/webgpu';
import { HOLODECK_STYLE } from './style';

/**
 * Fat edges for WebGPURenderer, as plain three objects.
 *
 * drei's `Edges` (10.7.9) draws `three-stdlib` Line2, a WebGL ShaderMaterial.
 * WebGPURenderer does not run ShaderMaterial, so those outlines never appear.
 * three r186 ships the replacement: `Line2NodeMaterial` +
 * `three/addons/lines/webgpu/LineSegments2.js`. Pixel width comes from
 * `material.linewidth` (the LineDashedMaterial field the node reads).
 *
 * `LineSegments2` extends `Mesh` (`isMesh === true`). Anything that
 * traverses a scene for meshes must skip `isLineSegments2`, or it will try
 * to style its own outlines.
 */

export type EdgeLineOptions = {
  /** Crease angle in degrees (`EdgesGeometry` thresholdAngle). */
  threshold?: number;
  color?: ColorRepresentation;
  /** CSS px. */
  lineWidth?: number;
  /** Share one material across many lines (applyHolodeckStyle does). */
  material?: Line2NodeMaterial;
};

export function createEdgeMaterial({
  color = HOLODECK_STYLE.colors.edge,
  lineWidth = HOLODECK_STYLE.edges.lineWidth,
}: { color?: ColorRepresentation; lineWidth?: number } = {}): Line2NodeMaterial {
  const material = new Line2NodeMaterial({ color, linewidth: lineWidth });
  material.toneMapped = false;
  return material;
}

/**
 * Outline for `geometry`. Pass `null` to create an empty line and fill it
 * later with `setEdgeLinesSource` (the R3F `Edges` wrapper does this: it
 * only sees the parent mesh geometry after mount).
 */
export function createEdgeLines(
  geometry: BufferGeometry | null,
  { threshold = HOLODECK_STYLE.edges.threshold, color, lineWidth, material }: EdgeLineOptions = {},
): LineSegments2 {
  const segments = new LineSegmentsGeometry();
  // InstancedBufferGeometry starts at instanceCount Infinity. WebGPU's
  // drawIndexed rejects that (Chrome: "Value is infinite"). Stay at 0
  // until setPositions fills real segments.
  segments.instanceCount = 0;
  const line = new LineSegments2(segments, material ?? createEdgeMaterial({ color, lineWidth }));
  // Outlines must not steal picks from the mesh they decorate.
  line.raycast = () => {};
  if (geometry) {
    setEdgeLinesSource(line, geometry, threshold);
  }
  return line;
}

/** Rebuild `line`'s segments from `geometry` at `threshold` degrees. */
export function setEdgeLinesSource(line: LineSegments2, geometry: BufferGeometry, threshold: number): void {
  const edges = new EdgesGeometry(geometry, threshold);
  const points = edges.getAttribute('position').array as Float32Array;
  const segments = line.geometry as LineSegmentsGeometry;
  if (points.length >= 6) {
    segments.setPositions(points);
    line.computeLineDistances();
  } else {
    segments.instanceCount = 0;
  }
  edges.dispose();
}

export function setEdgeLinesAppearance(
  line: LineSegments2,
  { color, lineWidth }: { color?: ColorRepresentation; lineWidth?: number },
): void {
  const material = line.material as Line2NodeMaterial;
  if (color !== undefined) material.color.set(color);
  if (lineWidth !== undefined) material.linewidth = lineWidth;
}
