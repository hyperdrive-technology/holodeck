import { Instance, Instances } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import { buildPipeGeometry } from '../../assets/process/pipe-geometry';
import { Edges } from '../../assets/process/Edges';
import type { ThreeEvent } from '@react-three/fiber';
import { STEAM_NUT_BORE_SIDES, STEAM_NUT_EDGE_THRESHOLD, STEAM_NUT_INNER, STEAM_NUT_LEN, STEAM_NUT_R, STEAM_NUT_ROT, STEAM_NUT_ROT_ORDER } from '../../assets/process/EndCap';
import { ShadedFill, WhiteFill, WhiteMesh } from '../../assets/process/Shell';
import { useHolodeckStyle } from '../../assets/process/style-context';
import { sharedValveBody, sharedValveWheel, VALVE_WHEEL_WIRE_SCALE } from '../../assets/process/valve-geometry';
import {
  CAP_LEN,
  CAP_SCALE,
  ELBOW_RADIAL,
  ELBOW_RADIUS,
  ELBOW_SWEEP,
  KNUCKLE_LEN,
  KNUCKLE_RADIUS,
  KNUCKLE_SIDES,
  PIPE_RADIUS,
  PIPE_SIDES,
  PIPE_WIRE_WIDTH,
  WEST_NIPPLE_ID,
  WEST_NIPPLE_ROLL,
  WEST_NIPPLE_SIDES,
  WEST_NUT_LEN,
  WEST_NUT_R,
  WEST_RING_EDGE_THRESHOLD,
  WEST_RING_LEN,
  WEST_RING_RADIAL,
  WEST_TANK_END,
  alongPipe,
  elbowOffsetShift,
  ELBOW_OFFSET,
  pipePose,
  pipeWorldY,
  trimRun,
} from '../../assets/process/pipe-math';
import { INSTANCE_LIMIT, slices } from './partition-scene';
import { gridToWorld } from './grid';
import type { IsoPlacement as ScenePlacement } from './scene';

export type ObjectPointer = (id: string, event: ThreeEvent<PointerEvent>) => void;

/**
 * Along-pipe collars. West mouth (r-west) is a short fat nipple: one sleeve
 * plus three rings at +half (`to`), not a scaled-up whole run.
 * Steam-out used the same fat 1.55 ends; the +X mouth read as a long
 * octagon vs r-steam’s plain tube (overlay o-steam2).
 */
function collarsFor(
  id: string,
  length: number,
): Array<{ z: number; scale: [number, number, number]; nut?: boolean }> {
  const half = length / 2;
  if (id === WEST_NIPPLE_ID) {
    // +z mouth is screen-left (toX −2). Rings used to span −span..+half
    // and read as a threaded whole run vs r-west’s mouth cluster.
    // Packing at mouth - nip*0.04 put the last ring on the tip; r-west
    // has a short clean pipe past the nipple. inset 0.14·half sat
    // tank-ward of r-west; 0.08·half keeps a tip without walking back
    // onto the mouth. Sleeve + four rings (nip 0.38) read as a spread
    // 5-ring vs r-west’s compact 4 (sleeve + three). nip 0.26 still
    // spilled tank-ward in o-west; 0.18 packs the four into the
    // mouth cluster without walking the inset. Sleeve Y 0.40 still
    // read as a long barrel vs r-west’s short first ring; 0.24
    // 6-gon pancakes still aliased to round discs in s-west — the
    // sleeve is a WEST_NUT prism (side faces) plus three hex rings.
    // 2.9–3.4 radial flared into a trumpet past the 0.24 nut vs
    // r-west’s even ridge stack (o-west). Rings hug the nut (~2.18× pipe).
    const mouth = half;
    const inset = Math.max(half * 0.08, 0.06);
    const nip = Math.max(half * 0.18, 0.12);
    const tip = mouth - inset;
    return [
      { z: -half, scale: [WEST_TANK_END[0], WEST_TANK_END[1], WEST_TANK_END[2]] },
      { z: tip - nip, scale: [1, 1, 1], nut: true },
      { z: tip - nip * 0.64, scale: [WEST_RING_RADIAL[0], WEST_RING_LEN[0], WEST_RING_RADIAL[0]] },
      { z: tip - nip * 0.34, scale: [WEST_RING_RADIAL[1], WEST_RING_LEN[1], WEST_RING_RADIAL[1]] },
      { z: tip - nip * 0.06, scale: [WEST_RING_RADIAL[2], WEST_RING_LEN[2], WEST_RING_RADIAL[2]] },
    ];
  }
  // Every other run gets its end flanges from buildPipeGeometry (PipeRun).
  return [];
}

/**
 * Fittings that repeat hundreds of times: one InstancedMesh (plus a
 * wireframe pass) per pool of INSTANCE_LIMIT. Tanks/mixers stay unique
 * meshes — fill, height, and cutouts differ.
 */
export function InstancedPipes({
  items,
  elbows = [],
  onObjectPointerDown,
}: {
  items: ScenePlacement[];
  elbows?: ScenePlacement[];
  onObjectPointerDown?: ObjectPointer;
}) {
  const style = useHolodeckStyle();
  const bends = new Set(
    elbows.filter((e) => e.rotation != null).map((e) => `${e.x},${e.y}`),
  );
  const posed = items.map((object) => {
    const [wx, , wz] = gridToWorld(object.x, object.y);
    const [tx, , tz] = gridToWorld(object.toX ?? object.x, object.toY ?? object.y);
    const trimmed = trimRun(
      [wx, wz],
      [tx, tz],
      bends.has(`${object.x},${object.y}`),
      bends.has(`${object.toX},${object.toY}`),
    );
    const pose = pipePose(trimmed.from, trimmed.to);
    return { object, pose };
  });
  return (
    <>
      {slices(posed).map((slice, pool) => {
        const bands = slice.filter(
          ({ object }) => (object.band ?? style.colors.bandInstanced).toLowerCase() !== '#ffffff',
        );
        const westNipples = slice.filter(({ object }) => object.id === WEST_NIPPLE_ID);
        return (
        <group key={`pipe-body-${pool}`}>
          {/*
            One merged mesh per run (body + joint rings + end flanges, see
            pipe-geometry.ts). Used to be a pooled InstancedMesh body plus a
            separate Edges mesh per pipe; the edge mesh per run made the pool
            save no draw calls, and rings need real (unscaled) geometry.
            The west nipple gets its own hex collars below, so no end flanges.
          */}
          {slice.map(({ object, pose }) => (
            <PipeRun
              key={object.id}
              object={object}
              pose={pose}
              endFlanges={object.id !== WEST_NIPPLE_ID}
              onObjectPointerDown={onObjectPointerDown}
            />
          ))}
          {westNipples.flatMap(({ object, pose }) =>
            collarsFor(object.id, pose.length).map((collar, i) => (
              <group
                key={`${object.id}-hex${i}`}
                position={alongPipe(pose.mid, pose.yaw, collar.z)}
                rotation={pose.rotation}
                rotation-order={pose.rotationOrder}
                scale={collar.nut ? [1, 1, 1] : collar.scale}
              >
                <WhiteMesh rotation={[0, WEST_NIPPLE_ROLL, 0]}>
                  <cylinderGeometry
                    args={
                      collar.nut
                        ? [WEST_NUT_R, WEST_NUT_R, WEST_NUT_LEN, WEST_NIPPLE_SIDES]
                        : [PIPE_RADIUS, PIPE_RADIUS, 1, WEST_NIPPLE_SIDES]
                    }
                  />
                  <Edges
                    threshold={collar.nut ? style.edges.thresholds.nut : WEST_RING_EDGE_THRESHOLD}
                   
                    lineWidth={PIPE_WIRE_WIDTH}
                  />
                </WhiteMesh>
              </group>
            )),
          )}
          {bands.length > 0 ? (
          <Instances limit={INSTANCE_LIMIT} range={bands.length} frustumCulled={false}>
            <cylinderGeometry args={[PIPE_RADIUS, PIPE_RADIUS, 1, PIPE_SIDES]} />
            <meshBasicMaterial toneMapped={false} />
            {bands.map(({ object, pose }) => (
              <Instance
                key={`${object.id}-b`}
                position={alongPipe(pose.mid, pose.yaw, pose.length * 0.22)}
                rotation={pose.rotation}
                rotation-order={pose.rotationOrder}
                scale={[1.18, 0.07, 1.18]}
                color={object.band ?? style.colors.bandInstanced}
              />
            ))}
          </Instances>
          ) : null}
        </group>
        );
      })}
    </>
  );
}

function PipeRun({
  object,
  pose,
  endFlanges,
  onObjectPointerDown,
}: {
  object: ScenePlacement;
  pose: ReturnType<typeof pipePose>;
  endFlanges: boolean;
  onObjectPointerDown?: ObjectPointer;
}) {
  const style = useHolodeckStyle();
  const geometry = useMemo(
    () => buildPipeGeometry({ length: pose.length, endFlanges }),
    [pose.length, endFlanges],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={pose.mid}
      rotation={pose.rotation}
      rotation-order={pose.rotationOrder}
      onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
    >
      <WhiteFill />
      <Edges threshold={style.edges.thresholds.pipe} lineWidth={PIPE_WIRE_WIDTH} />
    </mesh>
  );
}

/**
 * Tank-face collar pose: *-front sits on an X-run; the rest sit on +Y/-Y runs.
 * Spheres read as blobs on overlay-50.png; a short fat flange ring is the stub end.
 */
function knucklePose(object: ScenePlacement): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const [wx, , wz] = gridToWorld(object.x, object.y);
  return {
    position: [wx, pipeWorldY(), wz],
    rotation: object.id.includes('-front') ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
  };
}

export function InstancedElbows({
  items,
  onObjectPointerDown,
}: {
  items: ScenePlacement[];
  onObjectPointerDown?: ObjectPointer;
}) {
  const style = useHolodeckStyle();
  return (
    <>
      {slices(items).map((slice, pool) => {
        const bends = slice.filter((o) => o.rotation != null);
        const knuckles = slice.filter((o) => o.rotation == null);
        return (
          <group key={`elbow-${pool}`}>
            {bends.length > 0 ? (
              <>
              <Instances limit={INSTANCE_LIMIT} range={bends.length} frustumCulled={false}>
                <torusGeometry args={[ELBOW_RADIUS, PIPE_RADIUS, ELBOW_RADIAL, ELBOW_SWEEP, Math.PI / 2]} />
                <WhiteFill />
                {bends.map((object) => {
                  const [wx, , wz] = gridToWorld(object.x, object.y);
                  const yaw = object.rotation ?? 0;
                  const [dx, dz] = elbowOffsetShift(yaw, ELBOW_OFFSET);
                  return (
                    <Instance
                      key={object.id}
                      position={[wx + dx, pipeWorldY(), wz + dz]}
                      rotation={[Math.PI / 2, yaw, 0]}
                      rotation-order="XYZ"
                      onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
                    />
                  );
                })}
              </Instances>
              {bends.map((object) => {
                const [wx, , wz] = gridToWorld(object.x, object.y);
                const yaw = object.rotation ?? 0;
                const [dx, dz] = elbowOffsetShift(yaw, ELBOW_OFFSET);
                return (
                  <mesh
                    key={`${object.id}-e`}
                    position={[wx + dx, pipeWorldY(), wz + dz]}
                    rotation={[Math.PI / 2, yaw, 0]}
                    rotation-order="XYZ"
                  >
                    <torusGeometry args={[ELBOW_RADIUS, PIPE_RADIUS, ELBOW_RADIAL, ELBOW_SWEEP, Math.PI / 2]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                    <Edges threshold={style.edges.thresholds.elbow} lineWidth={PIPE_WIRE_WIDTH} />
                  </mesh>
                );
              })}
              </>
            ) : null}
            {knuckles.length > 0 ? (
              <>
                <Instances limit={INSTANCE_LIMIT} range={knuckles.length} frustumCulled={false}>
                  <cylinderGeometry args={[KNUCKLE_RADIUS, KNUCKLE_RADIUS, KNUCKLE_LEN, KNUCKLE_SIDES]} />
                  <WhiteFill />
                  {knuckles.map((object) => (
                    <Instance
                      key={object.id}
                      {...knucklePose(object)}
                      onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
                    />
                  ))}
                </Instances>
                {knuckles.map((object) => (
                  <mesh key={`${object.id}-e`} {...knucklePose(object)}>
                    <cylinderGeometry args={[KNUCKLE_RADIUS, KNUCKLE_RADIUS, KNUCKLE_LEN, KNUCKLE_SIDES]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                    <Edges threshold={style.edges.thresholds.pipe} lineWidth={PIPE_WIRE_WIDTH} />
                  </mesh>
                ))}
              </>
            ) : null}
          </group>
        );
      })}
    </>
  );
}

export function InstancedCaps({
  items,
  onObjectPointerDown,
}: {
  items: ScenePlacement[];
  onObjectPointerDown?: ObjectPointer;
}) {
  const style = useHolodeckStyle();
  return (
    <>
      {slices(items).map((slice, pool) => {
        const steam = slice.filter((o) => o.id.includes('steam'));
        const plain = slice.filter((o) => !o.id.includes('steam'));
        return (
          <group key={`cap-${pool}`}>
            {plain.length > 0 ? (
              <>
                <Instances limit={INSTANCE_LIMIT} range={plain.length} frustumCulled={false}>
                  <cylinderGeometry args={[PIPE_RADIUS * CAP_SCALE, PIPE_RADIUS * CAP_SCALE, CAP_LEN, PIPE_SIDES]} />
                  <WhiteFill />
                  {plain.map((object) => {
                    const [wx, , wz] = gridToWorld(object.x, object.y);
                    return (
                      <Instance
                        key={object.id}
                        position={[wx, pipeWorldY(), wz]}
                        rotation={[0, object.rotation ?? 0, Math.PI / 2]}
                        onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
                      />
                    );
                  })}
                </Instances>
                {plain.map((object) => {
                  const [wx, , wz] = gridToWorld(object.x, object.y);
                  return (
                    <mesh
                      key={`${object.id}-e`}
                      position={[wx, pipeWorldY(), wz]}
                      rotation={[0, object.rotation ?? 0, Math.PI / 2]}
                    >
                      <cylinderGeometry args={[PIPE_RADIUS * CAP_SCALE, PIPE_RADIUS * CAP_SCALE, CAP_LEN, PIPE_SIDES]} />
                      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                      <Edges threshold={style.edges.thresholds.pipe} lineWidth={PIPE_WIRE_WIDTH} />
                    </mesh>
                  );
                })}
              </>
            ) : null}
            {steam.length > 0 ? (
              <>
              <Instances limit={INSTANCE_LIMIT} range={steam.length} frustumCulled={false}>
                <cylinderGeometry args={[STEAM_NUT_R, STEAM_NUT_R, STEAM_NUT_LEN, 6]} />
                {/* Unlit like pipes — ShadedFill read as a grey plate vs r-steam. */}
                <WhiteFill />
                {steam.map((object) => {
                  const [wx, , wz] = gridToWorld(object.x, object.y);
                  return (
                    <Instance
                      key={object.id}
                      position={[wx, pipeWorldY(), wz]}
                      rotation={STEAM_NUT_ROT}
                      rotation-order={STEAM_NUT_ROT_ORDER}
                      onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
                    />
                  );
                })}
              </Instances>
              <Instances limit={INSTANCE_LIMIT} range={steam.length} frustumCulled={false}>
                <cylinderGeometry args={[STEAM_NUT_INNER, STEAM_NUT_INNER, STEAM_NUT_LEN * 1.05, STEAM_NUT_BORE_SIDES]} />
                <meshBasicMaterial color={style.colors.bore} toneMapped={false} />
                {steam.map((object) => {
                  const [wx, , wz] = gridToWorld(object.x, object.y);
                  return (
                    <Instance
                      key={`${object.id}-bore`}
                      position={[wx, pipeWorldY(), wz]}
                      rotation={STEAM_NUT_ROT}
                      rotation-order={STEAM_NUT_ROT_ORDER}
                    />
                  );
                })}
              </Instances>
              {steam.map((object) => {
                const [wx, , wz] = gridToWorld(object.x, object.y);
                return (
                  <mesh
                    key={`${object.id}-e`}
                    position={[wx, pipeWorldY(), wz]}
                    rotation={STEAM_NUT_ROT}
                    rotation-order={STEAM_NUT_ROT_ORDER}
                  >
                    <cylinderGeometry args={[STEAM_NUT_R, STEAM_NUT_R, STEAM_NUT_LEN, 6]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                    <Edges threshold={STEAM_NUT_EDGE_THRESHOLD} lineWidth={PIPE_WIRE_WIDTH} />
                  </mesh>
                );
              })}
              </>
            ) : null}
          </group>
        );
      })}
    </>
  );
}

export function InstancedValves({
  items,
  onObjectPointerDown,
}: {
  items: ScenePlacement[];
  onObjectPointerDown?: ObjectPointer;
}) {
  const style = useHolodeckStyle();
  return (
    <>
      {slices(items).map((slice, pool) => (
        <group key={`valve-${pool}`}>
          {/*
            Two pooled meshes per valve instead of five: merged white body
            (barrel + flanges + bonnet + stem) and the handwheel disc, the only
            per-instance tinted element. Geometry is code-built (valve-geometry.ts);
            GLB instancing was not attempted. Edges are one mesh per valve and
            geometry because Line2 segments cannot be instanced here.
          */}
          <Instances limit={INSTANCE_LIMIT} range={slice.length} frustumCulled={false}>
            <primitive object={sharedValveBody()} attach="geometry" />
            <WhiteFill />
            {slice.map((object) => (
              <Instance
                key={object.id}
                {...valvePose(object)}
                onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
              />
            ))}
          </Instances>
          <Instances limit={INSTANCE_LIMIT} range={slice.length} frustumCulled={false}>
            <primitive object={sharedValveWheel()} attach="geometry" />
            <meshBasicMaterial toneMapped={false} />
            {slice.map((object) => (
              <Instance
                key={`${object.id}-h`}
                {...valvePose(object)}
                color={object.handwheel ?? style.colors.accent}
              />
            ))}
          </Instances>
          {slice.map((object) => (
            <group key={`${object.id}-e`} {...valvePose(object)}>
              <mesh geometry={sharedValveBody()}>
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                <Edges threshold={style.edges.thresholds.valve} lineWidth={PIPE_WIRE_WIDTH} />
              </mesh>
              <mesh geometry={sharedValveWheel()}>
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                <Edges threshold={style.edges.thresholds.valveWheel} lineWidth={PIPE_WIRE_WIDTH * VALVE_WHEEL_WIRE_SCALE} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

function valvePose(object: ScenePlacement): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const [wx, , wz] = gridToWorld(object.x, object.y);
  return { position: [wx, pipeWorldY(), wz], rotation: [0, object.rotation ?? 0, 0] };
}
