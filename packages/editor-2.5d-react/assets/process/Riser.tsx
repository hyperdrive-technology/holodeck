import { useEffect, useMemo } from 'react';
import { Edges } from './Edges';
import { mergeFittingParams, type FittingParams } from './fitting-params';
import { Pipe } from './Pipe';
import { buildPipeGeometry } from './pipe-geometry';
import { WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';

/** The geometry a riser needs (src/routing/vessel-risers.ts `PipeRiser`, structurally). */
export interface RiserShape {
  /** World (x, z) of the riser axis. */
  at: [number, number];
  /** World Y of the drawn bottom and top. */
  bottomY: number;
  topY: number;
  /** Side risers: horizontal stub from the riser into the shell. */
  nozzle?: { y: number; from: [number, number]; to: [number, number]; shellEnd: 'flange' | 'cut' };
}

/**
 * A pipe riser: a vertical tube with a flange ring at each end (so its
 * vertical outline lines end on rings, the vessel line rule) and, for a side
 * riser, a short flanged nozzle stub into the shell. Same tube geometry,
 * fill and outline threshold as `Pipe` (style layer: `edges.thresholds.pipe`,
 * `colors.pipeWire`), so a riser reads as part of the run that feeds it.
 *
 * `buildPipeGeometry` lays the tube along local Y already; a floor run turns
 * it onto its side, the riser just leaves it standing.
 */
export function Riser({
  riser,
  radius,
  params,
}: {
  riser: RiserShape;
  radius?: number;
  params?: Partial<FittingParams>;
}) {
  const style = useHolodeckStyle();
  const p = mergeFittingParams({ pipeWireColor: style.colors.pipeWire, pipeBandColor: style.colors.band, ...params });
  const r = radius ?? p.pipeRadius;
  const sides = Math.max(3, Math.round(p.pipeSides));
  const length = Math.max(0.01, riser.topY - riser.bottomY);
  const geometry = useMemo(
    () =>
      buildPipeGeometry({
        length,
        radius: r,
        sides,
        ends: { from: 'flange', to: 'flange' },
        flangeScale: p.flangeScale,
        flangeLen: p.flangeLen,
      }),
    [length, r, sides, p.flangeScale, p.flangeLen],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const midY = (riser.bottomY + riser.topY) / 2;
  return (
    <group>
      {p.pipeShowFill || p.pipeShowWire ? (
        <mesh position={[riser.at[0], midY, riser.at[1]]} geometry={geometry}>
          {p.pipeShowFill ? <WhiteFill /> : <meshBasicMaterial transparent opacity={0} depthWrite={false} />}
          {p.pipeShowWire ? (
            <Edges threshold={style.edges.thresholds.pipe} color={p.pipeWireColor} lineWidth={p.pipeWireWidth} />
          ) : null}
        </mesh>
      ) : null}
      {riser.nozzle ? (
        <Pipe
          from={riser.nozzle.from}
          to={riser.nozzle.to}
          y={riser.nozzle.y}
          radius={r}
          // White = no band stripe (Pipe skips it): a stub this short has no room for one.
          band="#ffffff"
          params={params}
          ends={{ from: 'flange', to: riser.nozzle.shellEnd }}
        />
      ) : null}
    </group>
  );
}
