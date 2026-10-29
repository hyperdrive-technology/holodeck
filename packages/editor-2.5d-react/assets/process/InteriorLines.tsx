import { useMemo } from 'react';
import { LineSet } from './LineSet';
import { interiorLineSegments } from './tank-params';

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
  const positions = useMemo(
    () => interiorLineSegments(radius, heights, arc, facetStart, facetStep, meridianStep),
    [radius, heights, arc.start, arc.len, facetStart, facetStep, meridianStep],
  );
  return positions.length >= 6 ? <LineSet color={color} width={width} positions={positions} /> : null;
}
