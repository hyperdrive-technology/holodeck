import { useEffect, useMemo } from 'react';
import { Edges } from './Edges';
import { mergeFittingParams, type FittingParams } from './fitting-params';
import { buildPipeGeometry } from './pipe-geometry';
import { pipePose } from './pipe-math';
import { WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';

export function Pipe({
  from,
  to,
  radius,
  band,
  params,
}: {
  from: [number, number];
  to: [number, number];
  radius?: number;
  band?: string;
  params?: Partial<FittingParams>;
}) {
  const style = useHolodeckStyle();
  const p = mergeFittingParams({ pipeWireColor: style.colors.pipeWire, pipeBandColor: style.colors.band, ...params });
  const r = radius ?? p.pipeRadius;
  const sides = Math.max(3, Math.round(p.pipeSides));
  const stripe = band ?? p.pipeBandColor;
  const { length, yaw, mid } = pipePose(from, to, r);
  const geometry = useMemo(
    () =>
      buildPipeGeometry({
        length,
        radius: r,
        sides,
        endFlanges: p.pipeShowFlanges,
        flangeScale: p.flangeScale,
        flangeLen: p.flangeLen,
      }),
    [length, r, sides, p.pipeShowFlanges, p.flangeScale, p.flangeLen],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
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
      {p.pipeShowBand && stripe.toLowerCase() !== '#ffffff' ? (
        <mesh position={[0, 0, length * p.bandAlong]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[r * p.bandScale, r * p.bandScale, p.bandLen, sides]} />
          <meshBasicMaterial color={stripe} />
        </mesh>
      ) : null}
    </group>
  );
}
