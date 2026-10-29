import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Vector2, type Mesh } from 'three';
import { LineSet } from './LineSet';
import { createFinishMaterial } from './materials';
import { liquidFinish } from './style';
import { useHolodeckStyle } from './style-context';
import {
  bowlLatitudeRings,
  bowlProfile,
  flaskLathePoints,
  flaskMeridianSegments,
  liquidShades,
  waterlineRing,
} from './tank-params';

/**
 * The liquid in a vessel: one closed flask (bowl + wall lathe, flat
 * waterline disc) in the `liquid` finish (style.ts, same tokens as a GLB
 * `hd.liquid` material), plus its outline: the waterline ring and, when
 * `bowlLines` is on, the bowl's meridians + latitude rings that
 * reference.jpg shows on the liquid bottom.
 *
 * The finish has depthWrite off and draws after the shell
 * (`renderOrder`), so everything inside the vessel -- back-wall lines, the
 * impeller, these bowl lines -- shows through, tinted by the liquid.
 */
export function LiquidVolume({
  inner,
  bowlH,
  originY,
  liquidTop,
  stacks,
  segments,
  color,
  opacity,
  edgeColor,
  lineWidth,
  bowlLines,
  meridianThetas,
}: {
  /** Flask radius. */
  inner: number;
  bowlH: number;
  /** Bowl equator (centre of the bowl's half-ellipsoid). */
  originY: number;
  liquidTop: number;
  stacks: number;
  segments: number;
  /** Base liquid colour: the side is drawn a shade darker, the surface lighter (`liquidShades`). */
  color: string;
  /** Overrides the finish opacity (TankParams.liquidOpacity, tuner). */
  opacity?: number;
  edgeColor: string;
  lineWidth: number;
  bowlLines: boolean;
  /** Bowl meridian angles (cylinder theta). */
  meridianThetas: number[];
}) {
  const style = useHolodeckStyle();
  const finish = liquidFinish(style);
  const tones = liquidShades(color);
  const profile = useMemo(
    () => flaskLathePoints(inner, bowlH, originY, liquidTop, stacks),
    [inner, bowlH, originY, liquidTop, stacks],
  );
  // The profile ends (inner, top) -> (0, top); drop that closing radius, the disc replaces it
  // (side and surface get different tones).
  const lathe = useMemo(() => profile.slice(0, -1).map(([x, y]) => new Vector2(x, y)), [profile]);
  const sideMat = useMemo(
    () => createFinishMaterial('liquid', { style, color: tones.side, opacity }),
    [style, tones.side, opacity],
  );
  const surfaceMat = useMemo(
    () => createFinishMaterial('liquid', { style, color: tones.surface, opacity }),
    [style, tones.surface, opacity],
  );
  useEffect(() => () => sideMat.dispose(), [sideMat]);
  useEffect(() => () => surfaceMat.dispose(), [surfaceMat]);
  const side = useRef<Mesh>(null);
  const surface = useRef<Mesh>(null);
  useLayoutEffect(() => {
    if (side.current) side.current.renderOrder = finish.renderOrder;
    if (surface.current) surface.current.renderOrder = finish.renderOrder;
  });
  const waterline = useMemo(() => waterlineRing(inner, liquidTop, 48), [inner, liquidTop]);
  const bowl = useMemo(() => {
    if (!bowlLines || profile.length < 3) return null;
    const yMax = Math.min(originY, liquidTop);
    const meridians = flaskMeridianSegments(bowlProfile(profile, yMax), meridianThetas);
    const rings = bowlLatitudeRings(profile, yMax, BOWL_RING_STEP);
    const out = new Float32Array(meridians.length + rings.length);
    out.set(meridians, 0);
    out.set(rings, meridians.length);
    return out;
  }, [bowlLines, profile, originY, liquidTop, meridianThetas]);
  if (lathe.length < 2) return null;
  return (
    <>
      <mesh ref={side} material={sideMat}>
        <latheGeometry args={[lathe, segments]} />
      </mesh>
      <mesh ref={surface} material={surfaceMat} position={[0, liquidTop, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[inner, segments]} />
      </mesh>
      <LineSet color={edgeColor} width={lineWidth} positions={waterline} />
      {bowl && bowl.length >= 6 ? <LineSet color={edgeColor} width={lineWidth} positions={bowl} /> : null}
    </>
  );
}

/** Every 2nd bowl stack gets a latitude ring (16 stacks: rings would be a hatch). */
export const BOWL_RING_STEP = 2;
