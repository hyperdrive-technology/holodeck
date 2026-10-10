import { Edges } from './Edges';
import { useMemo } from 'react';
import { BackSide, BufferAttribute, BufferGeometry, Vector2, type Vector3Tuple } from 'three';
import { ShadedMesh, WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import {
  mergeTankParams,
  liquidShades,
  waterlineRing,
  spherePhiFromCylinderTheta,
  cylinderMeridianSegments,
  cylinderArcSegments,
  cylinderThetasEven,
  cylinderThetasKept,
  FLASK_MERIDIAN_STEP,
  MIXER_WALL_MERIDIAN_STEP,
  sphereMeridiansFromCylinderThetas,
  sphereLatitudeArcs,
  tankWindow,
  LIQUID_THETA_LENGTH,
  windowFillSegments,
  innerCageSpan,
  bodyShoulder,
  bodyOuterBowl,
  heelOverlap,
  shoulderOverlap,
  flaskBowl,
  flaskLathePoints,
  flaskMeridianSegments,
  mixerUpperPoints,
  type TankCap,
  type TankParams,
} from './tank-params';

function LineBag({ positions, color }: { positions: Float32Array; color: string }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={color} toneMapped={false} />
    </lineSegments>
  );
}

function LiquidFill({ color, opacity }: { color: string; opacity: number }) {
  // Bowl rim + cylinder share the flask equator. depthWrite left a z-fight
  // ring vs r-holdbody's smooth U (same class as the waterline disc join).
  return (
    <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
  );
}

export function Tank({
  position,
  fill,
  fillColor,
  height,
  radius,
  cap = 'dome',
  alarm = false,
  params,
}: {
  position: Vector3Tuple;
  fill?: number;
  fillColor?: string;
  height?: number;
  radius?: number;
  cap?: TankCap;
  alarm?: boolean;
  params?: Partial<TankParams>;
}) {
  const style = useHolodeckStyle();
  // Theme tokens are the base; explicit params (tuner sliders, mixer shape) win.
  const p = mergeTankParams({
    edgeColor: style.colors.edge,
    fillColor: style.colors.liquid,
    shadeMin: style.finishes.vessel.shadeMin,
    shadeMax: style.finishes.vessel.shadeMax,
    hubWhite: style.finishes.vessel.hubWhite,
    ...params,
  });
  const tankH = height ?? p.height;
  const tankR = radius ?? p.radius;
  const level = Math.min(1, Math.max(0.02, fill ?? p.fill));
  const color = alarm ? style.colors.alarm : (fillColor ?? p.fillColor);
  const liquidTones = liquidShades(color);
  const inner = tankR * p.innerRatio;
  const liner = tankR * p.linerRatio;
  const capH = cap === 'flat' ? tankH * p.capHeightRatio : 0;
  const capR = tankR * p.capRadiusRatio;
  const bodyH = tankH - capH;
  const y0 = -tankH / 2;
  const bodyMid = y0 + bodyH / 2;
  const bodyTop = y0 + bodyH;
  const liquidH = bodyH * level;
  const liquidTop = y0 + liquidH;
  const { keepStart, keepLen } = tankWindow(p.windowDeg, p.windowYawDeg);
  const domePhiStart = spherePhiFromCylinderTheta(keepStart);
  const segs = Math.max(3, Math.round(p.radialSegments));
  const fillSegs = windowFillSegments(segs);
  const bodySegs = Math.max(1, Math.round(p.bodyHeightSegments));
  const domeSegs = Math.max(1, Math.round(p.domeHeightSegments));
  const keptThetas = cylinderThetasKept(segs, keepStart, keepLen, FLASK_MERIDIAN_STEP);
  // Round 3 trial: the cap is denser than the wall (reference dome ~ every 2nd of 15 facets + 3 latitude rings).
  const domeThetas = cylinderThetasKept(segs, keepStart, keepLen, 2);
  const mixerWallThetas = cylinderThetasKept(segs, keepStart, keepLen, MIXER_WALL_MERIDIAN_STEP);
  const flaskThetas = cylinderThetasEven(segs, 0, LIQUID_THETA_LENGTH, true, FLASK_MERIDIAN_STEP);
  const ullageCage = innerCageSpan(y0, bodyTop, liquidTop);
  const windowArgs = [segs, bodySegs, true, keepStart, keepLen] as const;
  const shade = { shadeMin: p.shadeMin, shadeMax: p.shadeMax, hubWhite: p.hubWhite };
  const shoulder = bodyShoulder(bodyH, tankR, p);
  const outer = bodyOuterBowl(shoulder.cylH, p.outerBowlHeight);
  const heelOl = heelOverlap(outer.bowlH);
  const shOl = shoulderOverlap(shoulder.shoulderH);
  const wallH = outer.cylH + heelOl + shOl;
  const useShoulder = cap === 'dome' && shoulder.shoulderH > 1e-4;
  const topR = useShoulder ? shoulder.topR : tankR;
  const domeR = topR * p.domeRadiusScale;
  const domePhi = (p.domePhiDeg * Math.PI) / 180;
  // Spherical-cap height at scale 1; we then squash/stretch Y so the slider is world units.
  const domeCapH = domeR * (1 - Math.cos(Math.min(Math.max(domePhi, 0), Math.PI)));
  const domeScaleY = domeCapH > 1e-6 ? p.domeHeight / domeCapH : 1;
  const flask = flaskBowl(y0, inner, outer.bowlH, p.bowlHeight, p.bowlYOffset);
  const flaskStacks = Math.max(4, Math.round(p.bowlHeightSegments) * 4);
  const flaskProfile = flaskLathePoints(inner, flask.bowlH, flask.originY, liquidTop, flaskStacks);
  const flaskMeridians = flaskProfile.length > 2 ? flaskMeridianSegments(flaskProfile, flaskThetas) : null;
  const lathePts = useMemo(
    () =>
      flaskLathePoints(inner, flask.bowlH, flask.originY, liquidTop, flaskStacks).map(
        ([x, y]) => new Vector2(x, y),
      ),
    [inner, flask.bowlH, flask.originY, liquidTop, flaskStacks],
  );
  const waterline = useMemo(() => waterlineRing(inner, liquidTop, 48), [inner, liquidTop]);
  const shoulderLathes = useMemo(() => {
    if (shoulder.shoulderH < 1e-4) {
      return { wall: [] as Vector2[], liner: [] as Vector2[] };
    }
    // Start below the heel equator. Tick 113 used y0+bowlH and the join rang.
    const yWall0 = y0 + outer.bowlH - heelOl;
    const yShoulder0 = y0 + shoulder.cylH;
    const yDomeOrigin = bodyTop + p.domeYOffset;
    return {
      wall: mixerUpperPoints(
        tankR,
        topR,
        yWall0,
        yShoulder0,
        bodyTop,
        yDomeOrigin,
        domeR,
        domeScaleY,
        domePhi,
      ).map(([x, y]) => new Vector2(x, y)),
      liner: mixerUpperPoints(
        liner,
        topR * p.linerRatio,
        yWall0,
        yShoulder0,
        bodyTop,
        yDomeOrigin,
        0,
        domeScaleY,
        domePhi,
      ).map(([x, y]) => new Vector2(x, y)),
    };
  }, [
    y0,
    outer.bowlH,
    heelOl,
    shoulder.cylH,
    shoulder.shoulderH,
    bodyTop,
    p.domeYOffset,
    tankR,
    topR,
    domeR,
    domeScaleY,
    domePhi,
    liner,
    p.linerRatio,
  ]);
  const meshKey = `${segs}-${bodySegs}-${domeSegs}-${p.windowDeg}-${p.windowYawDeg}-${tankH}-${tankR}-${cap}-${p.domeHeight}-${p.bowlHeight}-${level}-${p.shoulderRatio}-${p.shoulderTopRatio}-${p.outerBowlHeight}`;
  const bodyRingFs = Array.from({ length: Math.max(0, Math.round(p.bodyRings)) }, (_, i) => {
    const n = Math.max(1, Math.round(p.bodyRings));
    return (i + 1) / (n + 1);
  });
  return (
    <group position={position} key={meshKey}>
      {useShoulder ? (
        <>
          {outer.bowlH > 1e-4 ? (
            <group
              position={[0, y0 + outer.bowlH, 0]}
              scale={[1, tankR > 1e-6 ? outer.bowlH / tankR : 1, 1]}
            >
              {p.showWall ? (
                <ShadedMesh radius={tankR} {...shade}>
                  <sphereGeometry
                    args={[tankR, segs, Math.max(4, domeSegs), 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
                  />
                </ShadedMesh>
              ) : null}
              {p.showLiner ? (
                <mesh>
                  <sphereGeometry
                    args={[liner, segs, Math.max(4, domeSegs), 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
                  />
                  <meshBasicMaterial color={p.linerColor} side={BackSide} toneMapped={false} />
                </mesh>
              ) : null}
              {p.showCage ? (
                <LineBag
                  color={p.edgeColor}
                  positions={sphereMeridiansFromCylinderThetas(
                    tankR,
                    // bottleThetas was every radial vs r-mixer's sparse heel.
                    flaskThetas,
                    Math.PI / 2 + 0.15,
                    Math.PI / 2 - 0.15,
                    Math.max(4, domeSegs),
                  )}
                />
              ) : null}
            </group>
          ) : null}
          <group position={[0, y0 + outer.bowlH - heelOl + wallH / 2, 0]}>
            {bodyRingFs.map((f) => (
              <mesh
                key={`br-${f}`}
                position={[0, -wallH / 2 + heelOl + outer.cylH * f, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
              >
                <ringGeometry args={[tankR - p.bodyRingWidth, tankR, 48, 1, keepStart - Math.PI / 2, keepLen]} />
                <meshBasicMaterial color={p.edgeColor} />
              </mesh>
            ))}
          </group>
          {p.showCage && shoulderLathes.wall.length > 2 ? (
            <LineBag
              color={p.edgeColor}
              positions={flaskMeridianSegments(
                shoulderLathes.wall.map((v) => [v.x, v.y] as [number, number]),
                mixerWallThetas,
              )}
            />
          ) : null}
          {p.showWall && shoulderLathes.wall.length > 2 ? (
            <ShadedMesh radius={(tankR + topR) / 2} {...shade}>
              <latheGeometry args={[shoulderLathes.wall, segs, keepStart, keepLen]} />
            </ShadedMesh>
          ) : null}
          {p.showLiner && shoulderLathes.liner.length > 2 ? (
            <mesh>
              <latheGeometry args={[shoulderLathes.liner, segs, keepStart, keepLen]} />
              <meshBasicMaterial color={p.linerColor} side={BackSide} toneMapped={false} />
            </mesh>
          ) : null}
        </>
      ) : (
      <group position={[0, bodyMid, 0]}>
        {p.showCage ? (
          <>
            <LineBag
              color={p.edgeColor}
              // Step 2 on 15 segs read dense vs r-holdbody outer cage.
              positions={cylinderMeridianSegments(tankR, -bodyH / 2, bodyH / 2, keepStart, keepLen, segs, false, FLASK_MERIDIAN_STEP)}
            />
            <LineBag
              color={p.edgeColor}
              positions={cylinderArcSegments(tankR, -bodyH / 2, keepStart, keepLen, segs)}
            />
            <LineBag
              color={p.edgeColor}
              positions={cylinderArcSegments(tankR, bodyH / 2, keepStart, keepLen, segs)}
            />
          </>
        ) : null}
        {p.showWall ? (
          <ShadedMesh radius={tankR} {...shade}>
            <cylinderGeometry args={[tankR, tankR, bodyH, ...windowArgs]} />
            {p.showCage ? null : (
              <Edges threshold={p.wallThreshold} color={p.edgeColor} lineWidth={p.lineWidth} />
            )}
          </ShadedMesh>
        ) : null}
        {p.showLiner ? (
          <mesh>
            <cylinderGeometry args={[liner, liner, bodyH, ...windowArgs]} />
            <meshBasicMaterial color={p.linerColor} side={BackSide} toneMapped={false} />
          </mesh>
        ) : null}
        {bodyRingFs.map((f) => (
          <mesh key={`br-${f}`} position={[0, -bodyH / 2 + bodyH * f, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            {/* Ring theta is not cylinder theta; −π/2 lines the arc up with the back wall. */}
            <ringGeometry args={[tankR - p.bodyRingWidth, tankR, 48, 1, keepStart - Math.PI / 2, keepLen]} />
            <meshBasicMaterial color={p.edgeColor} />
          </mesh>
        ))}
      </group>
      )}
      {cap === 'dome' && p.showDome && !useShoulder ? (
        <group position={[0, bodyTop + p.domeYOffset, 0]} scale={[1, domeScaleY, 1]}>
          <mesh>
            <sphereGeometry
              args={[domeR, segs, domeSegs, domePhiStart, keepLen, 0, domePhi]}
            />
            <WhiteFill />
          </mesh>
          <LineBag
            color={p.edgeColor}
            positions={sphereMeridiansFromCylinderThetas(
              domeR,
              // Default step 2 on the cap vs r-holdbody sparse dome (wall is already step 3).
              domeThetas,
              0,
              Math.max(0.05, domePhi - (useShoulder ? 0.12 : 0)),
              domeSegs,
            )}
          />
          <LineBag
            color={p.edgeColor}
            positions={sphereLatitudeArcs(
              domeR,
              domePhiStart,
              keepLen,
              Array.from({ length: domeSegs + 1 }, (_, i) => (domePhi * i) / domeSegs).filter(
                (_p, i, arr) => !useShoulder || (i > 0 && i < arr.length - 1),
              ),
              segs,
            )}
          />
        </group>
      ) : null}
      {cap === 'flat' ? (
        <group position={[0, bodyTop + capH / 2, 0]}>
          <mesh>
            <cylinderGeometry args={[capR, capR, Math.max(capH, 0.02), segs, 1, true]} />
            <WhiteFill />
            <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
          </mesh>
          <mesh position={[0, capH / 2 + p.capLidThickness / 2, 0]}>
            <cylinderGeometry args={[capR, capR, Math.max(p.capLidThickness, 0.004), segs]} />
            <WhiteFill />
            <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
          </mesh>
          <mesh position={[0, capH / 2 + p.capLidThickness, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[capR * 0.92, capR, segs]} />
            <meshBasicMaterial color={p.edgeColor} toneMapped={false} />
          </mesh>
        </group>
      ) : null}
      {/* One lathe — bowl+cylinder rims were an equator ring vs r-holdbody. */}
      {p.showLiquid && lathePts.length > 2 ? (
        <>
          {/* Round 3: side/bowl lathe (darker) + separate waterline disc (lighter). Was one lathe with the
              disc as its last profile segment, so a 17% fill was one flat colour. The profile ends
              (inner, top) -> (0, top); slice(0,-1) drops that waterline radius, the disc replaces it. */}
          <mesh>
            <latheGeometry args={[lathePts.slice(0, -1), fillSegs]} />
            <LiquidFill color={liquidTones.side} opacity={p.liquidOpacity} />
          </mesh>
          <mesh position={[0, liquidTop, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[inner, fillSegs]} />
            <LiquidFill color={liquidTones.surface} opacity={Math.max(0, p.liquidOpacity - 0.1)} />
          </mesh>
          <LineBag color={p.edgeColor} positions={waterline} />
        </>
      ) : null}
      {(p.showLiquid || p.showBowl) && flaskMeridians ? (
        <LineBag color={p.edgeColor} positions={flaskMeridians} />
      ) : null}
      {p.showCage && ullageCage ? (
        <LineBag
          color={p.edgeColor}
          // Default step 2 made the neck denser than the flask U vs r-holdbody.
          positions={cylinderMeridianSegments(inner, ullageCage.y0, ullageCage.y1, keepStart, keepLen, segs, false, FLASK_MERIDIAN_STEP)}
        />
      ) : null}
    </group>
  );
}
