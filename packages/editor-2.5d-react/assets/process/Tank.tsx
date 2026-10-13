import { Edges } from './Edges';
import { useMemo } from 'react';
import { BackSide, BufferAttribute, BufferGeometry, Vector2, type Vector3Tuple } from 'three';
import { ShadedMesh, WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import { TankAgitator } from './TankAgitator';
import {
  mergeTankParams,
  liquidShades,
  waterlineRing,
  spherePhiFromCylinderTheta,
  cylinderMeridianSegments,
  cylinderArcSegments,
  cylinderThetasEven,
  cylinderThetasKept,
  frustumMeridianSegments,
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
  tankLayout,
  frustumProfile,
  dishProfile,
  legPositions,
  type TankCap,
  type TankParams,
} from './tank-params';

/**
 * Base vessel. One cutaway path for every preset (HLT, mash tun, kettle,
 * whirlpool, the built-in tank and the mixer body): a windowed shell on the
 * kept arc, a white liner on its inside, a solid liquid flask, and outline
 * lines that are only ever generated on the kept arc. On top of that the
 * params pick a top closure (dome / flat lid / cone), a bottom closure
 * (flat / dish / cone) drawn below the straight wall, a stand (legs / skirt),
 * an optional agitator (the mixer's hat + shaft + impeller) and a tangential
 * nozzle.
 *
 * Why the cutout used to show "mesh lines": the liquid flask was drawn
 * translucent with `depthWrite` off and two extra line bags were drawn at
 * every theta — the flask meridians (`flaskMeridianSegments` over the full
 * 360°) and the ullage inner cage (`cylinderMeridianSegments` at the inner
 * radius). Both sat inside the window and composited through the liquid.
 * The flask is now opaque with depth writes, and those two bags are off by
 * default (`showBowl` / `showInnerCage`); the wall, dome, cone and rim lines
 * are all generated from the same `tankWindow()` kept arc as the shell.
 *
 * Local frame: origin at the straight wall's mid-height. `tankLayout()`
 * gives the floor point so a part can seat the vessel on the ground.
 */

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
  // Opaque with depth writes so nothing behind the flask (back-wall lines,
  // the liner, pipes) prints through the cutout. A sub-1 opacity (the mixer
  // keeps 0.84 so its shaft reads through the flask) still writes depth, so
  // only the first surface blends.
  const solid = opacity >= 0.999;
  return (
    <meshBasicMaterial color={color} transparent={!solid} opacity={opacity} depthWrite toneMapped={false} />
  );
}

export function Tank({
  position,
  fill,
  fillColor,
  height,
  radius,
  cap,
  alarm = false,
  params,
}: {
  position: Vector3Tuple;
  fill?: number;
  fillColor?: string;
  height?: number;
  radius?: number;
  /** Legacy: 'dome' | 'flat'. Overrides `params.top` when given. */
  cap?: TankCap;
  alarm?: boolean;
  params?: Partial<TankParams>;
}) {
  const style = useHolodeckStyle();
  // Theme tokens are the base; explicit params (tuner sliders, presets) win.
  const p = mergeTankParams({
    edgeColor: style.colors.edge,
    fillColor: style.colors.liquid,
    shadeMin: style.finishes.vessel.shadeMin,
    shadeMax: style.finishes.vessel.shadeMax,
    hubWhite: style.finishes.vessel.hubWhite,
    ...params,
  });
  const top = cap ?? p.top;
  const tankH = height ?? p.height;
  const tankR = radius ?? p.radius;
  const level = Math.min(1, Math.max(0.02, fill ?? p.fill));
  const color = alarm ? style.colors.alarm : (fillColor ?? p.fillColor);
  const liquidTones = liquidShades(color);
  const inner = tankR * p.innerRatio;
  const liner = tankR * p.linerRatio;
  const layout = tankLayout(tankH, tankR, p);
  const bodyH = tankH;
  const y0 = layout.y0;
  const bodyMid = 0;
  const bodyTop = layout.bodyTop;
  const liquidH = bodyH * level;
  const liquidTop = y0 + liquidH;
  const { keepStart, keepLen } = tankWindow(p.windowDeg, p.windowYawDeg);
  const domePhiStart = spherePhiFromCylinderTheta(keepStart);
  const segs = Math.max(3, Math.round(p.radialSegments));
  const fillSegs = windowFillSegments(segs);
  const bodySegs = Math.max(1, Math.round(p.bodyHeightSegments));
  const domeSegs = Math.max(1, Math.round(p.domeHeightSegments));
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
  const useShoulder = top === 'dome' && shoulder.shoulderH > 1e-4;
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
  // Closure lathes (cone lid, dish / cone bottom) as Vector2 profiles.
  const coneTop = useMemo(
    () => frustumProfile(tankR, bodyTop, layout.topR, layout.apexY).map(([x, y]) => new Vector2(x, y)),
    [tankR, bodyTop, layout.topR, layout.apexY],
  );
  const bottomProfile = useMemo(() => {
    const pts =
      p.bottom === 'dish'
        ? dishProfile(tankR, y0, layout.bottomDepth, 3)
        : p.bottom === 'cone'
          ? frustumProfile(tankR, y0, layout.bottomR, layout.bottomY)
          : [];
    return pts.map(([x, y]) => new Vector2(x, y));
  }, [p.bottom, tankR, y0, layout.bottomDepth, layout.bottomR, layout.bottomY]);
  const meshKey = `${segs}-${bodySegs}-${domeSegs}-${p.windowDeg}-${p.windowYawDeg}-${tankH}-${tankR}-${top}-${p.bottom}-${p.support}-${p.domeHeight}-${p.bowlHeight}-${level}-${p.shoulderRatio}-${p.shoulderTopRatio}-${p.outerBowlHeight}-${layout.bottomDepth}-${layout.topHeight}`;
  const bodyRingFs = Array.from({ length: Math.max(0, Math.round(p.bodyRings)) }, (_, i) => {
    const n = Math.max(1, Math.round(p.bodyRings));
    return (i + 1) / (n + 1);
  });
  const skirtR = tankR * 0.9;
  const skirtTop = p.bottom === 'flat' ? y0 : y0 - layout.bottomDepth * 0.5;
  const skirtH = Math.max(0.01, skirtTop - layout.floorY);
  const legTop = p.bottom === 'flat' ? y0 : layout.bottomY + layout.bottomDepth * 0.6;
  const legH = Math.max(0.01, legTop - layout.floorY);
  // Tangential inlet: on the kept arc just past the camera-left jamb (keepStart + keepLen is the
  // window's start, so subtracting walks onto the wall) so it reads against the shell.
  const nozzleTheta = keepStart + keepLen - 0.38;
  const nozzleLen = Math.max(0.3, tankR * 0.45);
  const nozzleR = Math.max(0.04, tankR * 0.06);
  const nozzleY = y0 + bodyH * 0.3;
  const nozzleTangent = [Math.cos(nozzleTheta), 0, -Math.sin(nozzleTheta)] as const;
  const nozzleCenter: Vector3Tuple = [
    tankR * Math.sin(nozzleTheta) + nozzleTangent[0] * (nozzleLen / 2 - nozzleR),
    nozzleY,
    tankR * Math.cos(nozzleTheta) + nozzleTangent[2] * (nozzleLen / 2 - nozzleR),
  ];
  return (
    <group position={position}>
      <group key={meshKey}>
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
                {/* Bottom rim all the way round: the window has no wall at the front, so a kept-arc
                    rim left the base without a ground-contact line there (the liner floor disc is
                    what you see through the cutout, and this is its outline). */}
                <LineBag
                  color={p.edgeColor}
                  positions={cylinderArcSegments(tankR, -bodyH / 2, 0, Math.PI * 2, Math.max(segs, 32))}
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
            {/* Floor disc closes the open cylinder so the ground grid / a dish bottom never shows through the window. */}
            {p.showLiner ? (
              <mesh position={[0, -bodyH / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[liner, fillSegs]} />
                <meshBasicMaterial color={p.linerColor} toneMapped={false} />
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
        {top === 'dome' && p.showDome && !useShoulder ? (
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
        {top === 'flat' ? (
          <TankFlatLid tankR={tankR} bodyTop={bodyTop} segs={segs} fillSegs={fillSegs} params={p} />
        ) : null}
        {top === 'cone' && coneTop.length > 1 ? (
          <>
            <ShadedMesh radius={tankR} {...shade}>
              <latheGeometry args={[coneTop, segs, keepStart, keepLen]} />
            </ShadedMesh>
            <mesh>
              <latheGeometry
                args={[coneTop.map((v) => new Vector2(v.x * p.linerRatio, v.y)), segs, keepStart, keepLen]}
              />
              <meshBasicMaterial color={p.linerColor} side={BackSide} toneMapped={false} />
            </mesh>
            <LineBag
              color={p.edgeColor}
              positions={frustumMeridianSegments(tankR, layout.topR, bodyTop, layout.apexY, keepStart, keepLen, segs, false)}
            />
            <LineBag color={p.edgeColor} positions={cylinderArcSegments(layout.topR, layout.apexY, keepStart, keepLen, segs)} />
            <mesh position={[0, layout.apexY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[layout.topR, segs]} />
              <WhiteFill />
              <Edges threshold={1} color={p.edgeColor} lineWidth={p.capLineWidth} />
            </mesh>
          </>
        ) : null}
        {bottomProfile.length > 1 ? (
          <>
            {/* Bottom closures are solid all round: the cutaway spans the straight wall only. */}
            <ShadedMesh radius={tankR} {...shade}>
              <latheGeometry args={[bottomProfile, segs]} />
            </ShadedMesh>
            {p.bottom === 'cone' ? (
              <>
                <LineBag
                  color={p.edgeColor}
                  positions={cylinderMeridianSegmentsFrustum(tankR, layout.bottomR, y0, layout.bottomY, segs)}
                />
                <LineBag color={p.edgeColor} positions={cylinderArcSegments(layout.bottomR, layout.bottomY, 0, Math.PI * 2, segs)} />
              </>
            ) : (
              <LineBag
                color={p.edgeColor}
                positions={sphereLikeDishLines(bottomProfile, cylinderThetasEven(segs, 0, Math.PI * 2, true, FLASK_MERIDIAN_STEP))}
              />
            )}
          </>
        ) : null}
        {p.support === 'legs'
          ? legPositions(tankR, p.legCount).map(([lx, lz], i) => (
              <mesh key={`leg-${i}`} position={[lx, layout.floorY + legH / 2, lz]}>
                <cylinderGeometry args={[p.legRadius, p.legRadius, legH, 6]} />
                <WhiteFill />
                <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
              </mesh>
            ))
          : null}
        {p.support === 'skirt' ? (
          <>
            <ShadedMesh radius={skirtR} {...shade} position={[0, layout.floorY + skirtH / 2, 0]}>
              <cylinderGeometry args={[skirtR, skirtR, skirtH, segs, 1, true]} />
            </ShadedMesh>
            <LineBag color={p.edgeColor} positions={cylinderArcSegments(skirtR, layout.floorY, 0, Math.PI * 2, segs)} />
          </>
        ) : null}
        {p.nozzle === 'tangential' ? (
          <group position={nozzleCenter} rotation={[0, nozzleTheta, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[nozzleR, nozzleR, nozzleLen, 8]} />
              <WhiteFill />
              <Edges threshold={style.edges.thresholds.pipe} color={p.edgeColor} lineWidth={p.capLineWidth} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]} position={[nozzleLen / 2 - nozzleR * 0.6, 0, 0]}>
              <cylinderGeometry args={[nozzleR * 1.35, nozzleR * 1.35, nozzleR * 1.2, 8]} />
              <WhiteFill />
              <Edges threshold={style.edges.thresholds.pipe} color={p.edgeColor} lineWidth={p.capLineWidth} />
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
              <LiquidFill color={liquidTones.surface} opacity={p.liquidOpacity} />
            </mesh>
            <LineBag color={p.edgeColor} positions={waterline} />
          </>
        ) : null}
        {p.showBowl && flaskMeridians ? <LineBag color={p.edgeColor} positions={flaskMeridians} /> : null}
        {p.showCage && p.showInnerCage && ullageCage ? (
          <LineBag
            color={p.edgeColor}
            // Default step 2 made the neck denser than the flask U vs r-holdbody.
            positions={cylinderMeridianSegments(inner, ullageCage.y0, ullageCage.y1, keepStart, keepLen, segs, false, FLASK_MERIDIAN_STEP)}
          />
        ) : null}
      </group>
      {/* Outside the keyed group so the `anim.agitator` node survives level / size changes (findAnimNodes memoises on the root). */}
      {p.agitator ? (
        <TankAgitator tankH={tankH} fill={level} params={{ ...p, radius: tankR }} apexY={layout.apexY} />
      ) : null}
    </group>
  );
}

/** Flat lid: a full disc on the body top with an outline rim and the small hatch cylinder. */
function TankFlatLid({
  tankR,
  bodyTop,
  segs,
  fillSegs,
  params: p,
}: {
  tankR: number;
  bodyTop: number;
  segs: number;
  fillSegs: number;
  params: TankParams;
}) {
  const style = useHolodeckStyle();
  const capH = Math.max(0.02, p.height * p.capHeightRatio * 0.35);
  const capR = tankR * p.capRadiusRatio * 0.6;
  const lidT = Math.max(p.capLidThickness, 0.004);
  return (
    <group position={[0, bodyTop, 0]}>
      <mesh position={[0, lidT / 2, 0]}>
        <cylinderGeometry args={[tankR, tankR, lidT, fillSegs]} />
        <WhiteFill />
      </mesh>
      <mesh position={[0, lidT + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[tankR - 0.012, tankR, fillSegs]} />
        <meshBasicMaterial color={p.edgeColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, lidT + capH / 2, 0]}>
        <cylinderGeometry args={[capR, capR, capH, segs, 1, true]} />
        <WhiteFill />
        <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </mesh>
      <mesh position={[0, lidT + capH + lidT / 2, 0]}>
        <cylinderGeometry args={[capR, capR, lidT, segs]} />
        <WhiteFill />
        <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </mesh>
    </group>
  );
}

/** Sparse meridians down a full-circle cone bottom. */
function cylinderMeridianSegmentsFrustum(r0: number, r1: number, y0: number, y1: number, segs: number): Float32Array {
  const thetas = cylinderThetasEven(segs, 0, Math.PI * 2, true, FLASK_MERIDIAN_STEP);
  const pts: number[] = [];
  for (const th of thetas) {
    const s = Math.sin(th);
    const c = Math.cos(th);
    pts.push(r0 * s, y0, r0 * c, r1 * s, y1, r1 * c);
  }
  return new Float32Array(pts);
}

/** Sparse meridians along a dish profile (rim -> pole). */
function sphereLikeDishLines(profile: Vector2[], thetas: number[]): Float32Array {
  return flaskMeridianSegments(
    profile.map((v) => [v.x, v.y] as [number, number]),
    thetas,
  );
}
