import { useEffect, useMemo } from 'react';
import { Edges } from './Edges';
import { mergeFittingParams, type FittingParams } from './fitting-params';
import { buildPipeBoreGeometry, buildPipeGeometry, type PipeEndStyle } from './pipe-geometry';
import { pipePose } from './pipe-math';
import { WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';

export function Pipe({
  from,
  to,
  radius,
  band,
  params,
  ends,
}: {
  from: [number, number];
  to: [number, number];
  radius?: number;
  band?: string;
  params?: Partial<FittingParams>;
  /** Per-end finish; `cut` where the run enters a vessel window (src/iso/pipe-runs.ts). Default: flanges. */
  ends?: { from: PipeEndStyle; to: PipeEndStyle };
}) {
  const style = useHolodeckStyle();
  const p = mergeFittingParams({ pipeWireColor: style.colors.pipeWire, pipeBandColor: style.colors.band, ...params });
  const r = radius ?? p.pipeRadius;
  const sides = Math.max(3, Math.round(p.pipeSides));
  const stripe = band ?? p.pipeBandColor;
  const { length, yaw, mid } = pipePose(from, to, r);
  // The flange toggle only applies to ends that are not cut sections.
  const fromEnd = ends?.from === 'cut' ? 'cut' : p.pipeShowFlanges ? 'flange' : 'plain';
  const toEnd = ends?.to === 'cut' ? 'cut' : p.pipeShowFlanges ? 'flange' : 'plain';
  const geometry = useMemo(
    () =>
      buildPipeGeometry({
        length,
        radius: r,
        sides,
        ends: { from: fromEnd, to: toEnd },
        flangeScale: p.flangeScale,
        flangeLen: p.flangeLen,
      }),
    [length, r, sides, fromEnd, toEnd, p.flangeScale, p.flangeLen],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const bore = useMemo(
    () => buildPipeBoreGeometry({ length, radius: r, sides, ends: { from: fromEnd, to: toEnd } }),
    [length, r, sides, fromEnd, toEnd],
  );
  useEffect(() => () => bore?.dispose(), [bore]);
  return (
    <group position={mid} rotation={[0, yaw, 0]}>
      {p.pipeShowFill || p.pipeShowWire ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={geometry}>
          {p.pipeShowFill ? (
            <WhiteFill />
          ) : (
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          )}
          {p.pipeShowWire ? (
            <Edges threshold={style.edges.thresholds.pipe} color={p.pipeWireColor} lineWidth={p.pipeWireWidth} />
          ) : null}
        </mesh>
      ) : null}
      {bore && p.pipeShowFill ? (
        <mesh rotation={[Math.PI / 2, 0, 0]} geometry={bore}>
          <meshBasicMaterial color={style.colors.bore} toneMapped={false} />
        </mesh>
      ) : null}
      {p.pipeShowBand && stripe.toLowerCase() !== '#ffffff' ? (
        <mesh position={[0, 0, length * p.bandAlong]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * p.bandScale, r * p.bandScale, p.bandLen, sides]} />
          <meshBasicMaterial color={stripe} />
        </mesh>
      ) : null}
    </group>
  );
}
