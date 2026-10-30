import { Edges } from './Edges';
import { useMemo } from 'react';
import { InteriorLines } from './InteriorLines';
import { LineSet } from './LineSet';
import { LiquidVolume } from './LiquidVolume';
import { NozzleStub } from './NozzleStub';
import { Supports } from './Supports';
import { bowlMeridianThetas, bowlWindow, flatLidHatch, tankLinePlan } from './tank-lines';
import { BackSide, BufferAttribute, BufferGeometry, Vector2, type Vector3Tuple } from 'three';
import { ShadedMesh, WhiteFill } from './Shell';
import { useHolodeckStyle } from './style-context';
import { AgitatedVessel } from './AgitatedVessel';
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
  interiorRingArc,
  interiorRimHeights,
  interiorRingSegments,
  INTERIOR_RING_INSET,
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
  heelSurfaceY,
  tankNozzlePose,
  TANK_NOZZLE_JAMB_OFFSET,
  TANK_NOZZLE_LENGTH,
  TANK_NOZZLE_RADIUS,
  TANK_LINE_WIDTH,
  LINER_SHADE,
  TANK_DOME_MERIDIAN_STEP,
  TANK_WALL_MERIDIAN_STEP,
  LEG_RADIUS_RATIO,
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

/** Cage / rim lines: fat Line2 at TANK_LINE_WIDTH (was 1-device-px lineBasic, too faint vs reference.jpg). */
function LineBag({ positions, color }: { positions: Float32Array; color: string }) {
  return <LineSet positions={positions} color={color} width={TANK_LINE_WIDTH} />;
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
  // fill <= 0 (or not a number) is an EMPTY vessel: no liquid, no waterline, no bowl lines. Round 5
  // (2026-10-30): the 2% floor used to apply to 0 too, so an empty whirlpool showed a small floating disc.
  // Any positive fill keeps that floor so a nearly empty vessel still shows a film.
  const requested = fill ?? p.fill;
  const empty = !(requested > 0);
  const level = Math.min(1, Math.max(0.02, empty ? 0 : requested));
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
  const domeThetas = cylinderThetasKept(segs, keepStart, keepLen, TANK_DOME_MERIDIAN_STEP);
  const mixerWallThetas = cylinderThetasKept(segs, keepStart, keepLen, MIXER_WALL_MERIDIAN_STEP);
  const flaskThetas = cylinderThetasEven(segs, 0, LIQUID_THETA_LENGTH, true, FLASK_MERIDIAN_STEP);
  // Bowl radials on the liquid lathe's vertex grid, only those seen whole through the window (tank-lines.ts).
  const bowlThetas = useMemo(() => bowlMeridianThetas(fillSegs), [fillSegs]);
  const bowlWin = useMemo(
    () => bowlWindow(p, tankR),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p is rebuilt every render; key on what bowlWindow reads.
    [p.windowDeg, p.windowYawDeg, p.linerRatio, tankR],
  );
  const ullageCage = innerCageSpan(y0, bodyTop, liquidTop);
  const windowArgs = [segs, bodySegs, true, keepStart, keepLen] as const;
  const shade = { shadeMin: p.shadeMin, shadeMax: p.shadeMax, hubWhite: p.hubWhite };
  const linerShade = LINER_SHADE;
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
  // Interior rim + hoop lines on the inner back wall (seen through the window). The straight wall runs
  // y0..bodyTop on a plain tank; on a shouldered body (mixer) it runs from the heel join to the shoulder.
  // Interior rim + hoop lines (and facet seams) on the inner back wall, seen through the window. The straight
  // wall runs y0..bodyTop on a plain tank; on a shouldered body (mixer) from the heel join to the shoulder.
  const interiorLines = useMemo(() => {
    if (!p.showInteriorRings || !p.showLiner) return null;
    const yBottom = useShoulder ? y0 + outer.bowlH : y0 + 0.004;
    const yTop = useShoulder ? y0 + shoulder.cylH : bodyTop - 0.004;
    const heights = interiorRimHeights(yBottom, yTop);
    if (heights.length === 0) return null;
    return { radius: liner * INTERIOR_RING_INSET, heights, arc: interiorRingArc(p.windowDeg, p.windowYawDeg) };
  }, [p.showInteriorRings, p.showLiner, p.windowDeg, p.windowYawDeg, useShoulder, y0, outer.bowlH, shoulder.cylH, bodyTop, liner]);
  // Every line set (except the retired shoulder path's) comes from tank-lines.ts, where the
  // line-termination rule is tested.
  const linePlan = useMemo(
    () => tankLinePlan(p, top, tankH, tankR, empty ? 0 : level),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- p is rebuilt every render; key on what the plan reads.
    [JSON.stringify(p), top, tankH, tankR, level, empty],
  );
  const meshKey = `${segs}-${bodySegs}-${domeSegs}-${p.windowDeg}-${p.windowYawDeg}-${tankH}-${tankR}-${top}-${p.bottom}-${p.support}-${p.domeHeight}-${p.bowlHeight}-${level}-${p.shoulderRatio}-${p.shoulderTopRatio}-${p.outerBowlHeight}-${layout.bottomDepth}-${layout.topHeight}`;
  const skirtTop = p.bottom === 'flat' ? y0 : y0 - layout.bottomDepth * 0.5;
  // A rounded heel (mixer bottle) curves up away from the floor point: run each leg up to the heel
  // surface at the leg's INNER edge (the lowest point of the shell over the leg). Any higher and the leg
  // top pokes through the shell into the cutaway (it showed through the liquid as a hex outline).
  const legTop =
    useShoulder && outer.bowlH > 1e-4
      ? heelSurfaceY(y0, tankR, outer.bowlH, Math.max(0, tankR * LEG_RADIUS_RATIO - p.legRadius))
      : p.bottom === 'flat'
        ? y0
        : layout.bottomY + layout.bottomDepth * 0.6;
  // Inlet nozzle stub on the camera-left wall (tankNozzlePose has the placement history).
  const nozzleR = Math.max(0.05, tankR * TANK_NOZZLE_RADIUS);
  const nozzle = tankNozzlePose(
    tankR,
    keepStart + keepLen - TANK_NOZZLE_JAMB_OFFSET,
    y0 + bodyH * 0.3,
    Math.max(0.2, tankR * TANK_NOZZLE_LENGTH),
    nozzleR,
  );
  if (p.agitator) {
    // Agitated vessels are the Blender mixer (AgitatedVessel / mixer.glb) since 2026-10-30; the
    // procedural bottle + TankAgitator path is retired. Floor = the layout floor (mixer.glb has no stand).
    return (
      <group position={position}>
        <AgitatedVessel
          radius={tankR}
          height={tankH}
          floorY={layout.floorY}
          fill={empty ? 0 : level}
          color={color}
          opacity={p.liquidOpacity}
          edgeColor={p.edgeColor}
        />
      </group>
    );
  }
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
                  <ShadedMesh radius={liner} {...linerShade} inside>
                    <sphereGeometry
                      args={[liner, segs, Math.max(4, domeSegs), 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]}
                    />
                  </ShadedMesh>
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
              <ShadedMesh radius={liner} {...linerShade} inside>
                <latheGeometry args={[shoulderLathes.liner, segs, keepStart, keepLen]} />
              </ShadedMesh>
            ) : null}
          </>
        ) : (
          <group position={[0, bodyMid, 0]}>
            {/* Wall meridians end on the bottom rim (full circle: it also outlines the liner floor seen through
                the window) and the kept-arc top rim (tank-lines.ts). Positions are in the Tank frame (bodyMid = 0). */}
            <LineBag color={p.edgeColor} positions={linePlan.wallMeridians} />
            <LineBag color={p.edgeColor} positions={linePlan.bottomRim} />
            <LineBag color={p.edgeColor} positions={linePlan.topRim} />
            {p.showWall ? (
              <ShadedMesh radius={tankR} {...shade}>
                <cylinderGeometry args={[tankR, tankR, bodyH, ...windowArgs]} />
                {p.showCage ? null : (
                  <Edges threshold={p.wallThreshold} color={p.edgeColor} lineWidth={p.lineWidth} />
                )}
              </ShadedMesh>
            ) : null}
            {p.showLiner ? (
              <ShadedMesh radius={liner} {...linerShade} inside>
                <cylinderGeometry args={[liner, liner, bodyH, ...windowArgs]} />
              </ShadedMesh>
            ) : null}
            {/* Floor disc closes the open cylinder so the ground grid / a dish bottom never shows through the window. */}
            {p.showLiner ? (
              <mesh position={[0, -bodyH / 2 + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <circleGeometry args={[liner, fillSegs]} />
                <meshBasicMaterial color={p.linerColor} toneMapped={false} />
              </mesh>
            ) : null}
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
            {p.showLiner ? (
              // Dome liner: hides the far side's outer meridians, which used to show through the window as
              // lines running past the interior top rim into nowhere (Des 2026-10-30 line-termination rule).
              <ShadedMesh radius={liner} {...linerShade} inside>
                <sphereGeometry args={[domeR * p.linerRatio, segs, domeSegs, domePhiStart, keepLen, 0, domePhi]} />
              </ShadedMesh>
            ) : null}
          </group>
        ) : null}
        {top === 'dome' && p.showDome && !useShoulder ? (
          <>
            {/* Meridians from the apex down to the equator ring (domeRings includes it). */}
            <LineBag color={p.edgeColor} positions={linePlan.domeMeridians} />
            <LineBag color={p.edgeColor} positions={linePlan.domeRings} />
          </>
        ) : null}
        {top === 'flat' ? (
          <LineBag color={p.edgeColor} positions={linePlan.hatchBase} />
        ) : null}
        {top === 'flat' ? (
          <TankFlatLid tankR={tankR} bodyTop={bodyTop} segs={segs} fillSegs={fillSegs} params={p} />
        ) : null}
        {top === 'cone' && coneTop.length > 1 ? (
          <>
            <ShadedMesh radius={tankR} {...shade}>
              <latheGeometry args={[coneTop, segs, keepStart, keepLen]} />
            </ShadedMesh>
            <ShadedMesh radius={liner} {...linerShade} inside>
              <latheGeometry
                args={[coneTop.map((v) => new Vector2(v.x * p.linerRatio, v.y)), segs, keepStart, keepLen]}
              />
            </ShadedMesh>
            <LineBag color={p.edgeColor} positions={linePlan.coneTop} />
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
            <LineBag color={p.edgeColor} positions={linePlan.bottom} />
          </>
        ) : null}
        <Supports
          kind={p.support}
          tankR={tankR}
          floorY={layout.floorY}
          top={p.support === 'skirt' ? skirtTop : legTop}
          legCount={p.legCount}
          legRadius={p.legRadius}
          segs={segs}
          edgeColor={p.edgeColor}
          lineWidth={p.capLineWidth}
          edgeThreshold={style.edges.threshold}
          shade={shade}
        />
        {p.nozzle === 'tangential' ? (
          <NozzleStub
            position={nozzle.position}
            quaternion={nozzle.quaternion}
            length={nozzle.length}
            radius={nozzleR}
            edgeColor={p.edgeColor}
            lineWidth={p.capLineWidth}
            shade={shade}
          />
        ) : null}
        {p.showLiquid && !empty ? (
          <LiquidVolume
            inner={inner}
            bowlH={flask.bowlH}
            originY={flask.originY}
            liquidTop={liquidTop}
            stacks={flaskStacks}
            segments={fillSegs}
            color={color}
            opacity={p.liquidOpacity}
            edgeColor={p.edgeColor}
            lineWidth={TANK_LINE_WIDTH}
            bowlLines={p.showBowl}
            meridianThetas={bowlThetas}
            window={bowlWin}
          />
        ) : null}
        {/* Interior rims + seams (shouldered bodies keep InteriorLines on their heel..shoulder wall). */}
        {useShoulder && interiorLines ? (
          <InteriorLines
            {...interiorLines}
            facetStart={keepStart}
            facetStep={keepLen / segs}
            meridianStep={p.interiorMeridianStep}
            color={p.edgeColor}
            width={TANK_LINE_WIDTH}
          />
        ) : (
          <LineBag color={p.edgeColor} positions={linePlan.interior} />
        )}
        {p.showCage && p.showInnerCage && ullageCage ? (
          <LineBag
            color={p.edgeColor}
            // Default step 2 made the neck denser than the flask U vs r-holdbody.
            positions={cylinderMeridianSegments(inner, ullageCage.y0, ullageCage.y1, keepStart, keepLen, segs, false, FLASK_MERIDIAN_STEP)}
          />
        ) : null}
      </group>
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
  // Shared with tank-lines.ts (hatchBase ring sits exactly at neckY0).
  const { capH, capR, lidT, neckY0 } = flatLidHatch(tankR, p);
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
      <mesh position={[0, neckY0 + capH / 2, 0]}>
        <cylinderGeometry args={[capR, capR, capH, segs, 1, true]} />
        <WhiteFill />
        <Edges threshold={style.edges.threshold} color={p.edgeColor} lineWidth={p.capLineWidth} />
      </mesh>
      <mesh position={[0, neckY0 + capH + lidT / 2, 0]}>
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
