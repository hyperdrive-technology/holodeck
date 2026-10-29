import { useMemo } from 'react';
import { LineSet } from './LineSet';
import { interiorMeridianSegments, interiorRingSegments } from './tank-params';

/**
 * The inner back wall's lines seen through the cutaway (reference.jpg):
 * horizontal rims / hoops at `heights` and the liner's vertical facet seams
 * (every `meridianStep`-th liner vertex), all on `arc` (the back wall
 * opposite the window, `interiorRingArc`) and on the faceted liner surface.
 */
export function InteriorLines({
  radius,
  heights,
  arc,
  facetStart,
  facetStep,
  meridianStep,
  color,
  width,
}: {
  radius: number;
  heights: number[];
  arc: { start: number; len: number };
  facetStart: number;
  facetStep: number;
  /** 0 = no seams. */
  meridianStep: number;
  color: string;
  width: number;
}) {
  const positions = useMemo(() => {
    const rings = interiorRingSegments(radius, heights, arc, facetStart, facetStep);
    const seams =
      meridianStep > 0 && heights.length >= 2
        ? interiorMeridianSegments(radius, heights[0], heights[heights.length - 1], arc, facetStart, facetStep, meridianStep)
        : new Float32Array(0);
    const out = new Float32Array(rings.length + seams.length);
    out.set(rings, 0);
    out.set(seams, rings.length);
    return out;
  }, [radius, heights, arc.start, arc.len, facetStart, facetStep, meridianStep]);
  return positions.length >= 6 ? <LineSet color={color} width={width} positions={positions} /> : null;
}
