import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CircleGeometry, Matrix4, MeshBasicMaterial, type InstancedMesh } from 'three';
import { FloorText } from '../../assets/process/Label';
import { annotationStyle, type HolodeckStyle } from '../../assets/process/style';
import { useHolodeckStyle } from '../../assets/process/style-context';
import { gridToWorld } from '../iso/grid';
import { StrokeMeshView } from './StrokeMeshView';
import { pointAt, polylineLength, type DashStyle, type TipStyle, type Vec2 } from './stroke';

/** Connector ribbons sit between the area slab (below 0) and floor labels (0.05). */
export const CONNECTOR_Y = 0.03;
/** Most flow dots on one connector; longer lines space them out instead. */
export const MAX_FLOW_DOTS = 200;

export interface ConnectorLook {
  color: string;
  width: number;
  dash: DashStyle;
  startTip: TipStyle;
  endTip: TipStyle;
  label: string;
  labelSize: number;
  flow: boolean;
  /** Cells per second along the line; negative runs backwards. */
  flowSpeed: number;
}

/** Resolved connector params -> look, with theme defaults for empty colour / width. */
export function connectorLook(params: Record<string, unknown>, style: HolodeckStyle): ConnectorLook {
  const tokens = annotationStyle(style);
  const str = (v: unknown, d: string) => (typeof v === 'string' && v !== '' ? v : d);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const oneOf = <T extends string>(v: unknown, options: readonly T[], d: T): T =>
    typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : d;
  const width = num(params.width, 0);
  return {
    color: str(params.color, tokens.connector),
    width: width > 0 ? width : tokens.connectorWidth,
    dash: oneOf(params.dash, ['solid', 'dashed', 'dotted'] as const, 'solid'),
    startTip: oneOf(params.startTip, ['none', 'arrow', 'dot'] as const, 'none'),
    endTip: oneOf(params.endTip, ['none', 'arrow', 'dot'] as const, 'arrow'),
    label: typeof params.label === 'string' ? params.label : '',
    labelSize: num(params.labelSize, 0.28),
    flow: params.flow === true,
    flowSpeed: num(params.flowSpeed, 1),
  };
}

/** Grid polyline -> world (x, z) pairs. */
export function gridPolylineToWorld(points: readonly Vec2[]): Vec2[] {
  return points.map(([x, y]) => {
    const [wx, , wz] = gridToWorld(x, y);
    return [wx, wz] as const;
  });
}

/**
 * Caption placement: the midpoint of the line, turned along the segment it
 * sits on but never upside down (yaw kept within +-90 degrees of +x), and
 * pushed off the line by half the text height plus the ribbon width.
 */
export function captionPose(world: readonly Vec2[], width: number, size: number): { x: number; z: number; yaw: number } | null {
  const length = polylineLength(world);
  const mid = pointAt(world, length / 2);
  if (!mid) return null;
  let [dx, dz] = mid.dir;
  if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dz > 0)) {
    dx = -dx;
    dz = -dz;
  }
  // Three's Y yaw is counter-clockwise looking down; text runs along local +x.
  const yaw = Math.atan2(-dz, dx);
  const off = width / 2 + size * 0.75;
  // Normal on the screen-upper side of the line (-z after the flip above keeps it consistent).
  return { x: mid.p[0] + dz * off, z: mid.p[1] - dx * off, yaw };
}

export function Connector({ points, look, opacity = 1 }: { points: readonly Vec2[]; look: ConnectorLook; opacity?: number }) {
  const world = useMemo(() => gridPolylineToWorld(points), [points]);
  const caption = look.label ? captionPose(world, look.width, look.labelSize) : null;
  const style = { width: look.width, dash: look.dash, startTip: look.startTip, endTip: look.endTip };
  return (
    <group userData={{ hdConnector: true }}>
      <StrokeMeshView points={world} y={CONNECTOR_Y} color={look.color} options={style} opacity={opacity} />
      {look.flow ? <FlowDots world={world} look={look} /> : null}
      {caption ? (
        <group position={[caption.x, CONNECTOR_Y + 0.01, caption.z]} rotation={[0, caption.yaw, 0]}>
          <group rotation={[-Math.PI / 2, 0, 0]}>
            <FloorText fill={look.color} fontSize={look.labelSize * 0.9} lineHeight={1.15} opacity={opacity}>
              {look.label}
            </FloorText>
          </group>
        </group>
      ) : null}
    </group>
  );
}

/** Spacing between flow dots for a ribbon width, widened so a line never carries more than MAX_FLOW_DOTS. */
export function flowSpacing(width: number, length: number): number {
  return Math.max(0.6, width * 8, length / MAX_FLOW_DOTS);
}

/** Arc-length offset of the first dot at `elapsed` seconds: wraps into [0, spacing). */
export function flowOffset(elapsed: number, speed: number, spacing: number): number {
  const raw = (elapsed * speed) % spacing;
  return raw < 0 ? raw + spacing : raw;
}

/** Dots running along the line (Arcentry's animated flow). One InstancedMesh, matrices updated per frame. */
function FlowDots({ world, look }: { world: readonly Vec2[]; look: ConnectorLook }) {
  const tokens = annotationStyle(useHolodeckStyle());
  const mesh = useRef<InstancedMesh>(null);
  const length = polylineLength(world);
  const spacing = flowSpacing(look.width, length);
  const count = Math.max(1, Math.min(MAX_FLOW_DOTS, Math.floor(length / spacing)));
  const radius = Math.max(0.05, look.width * 0.9);
  const geometry = useMemo(() => new CircleGeometry(radius, 12).rotateX(-Math.PI / 2), [radius]);
  const material = useMemo(() => new MeshBasicMaterial({ color: tokens.flow, toneMapped: false }), [tokens.flow]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  const m = useMemo(() => new Matrix4(), []);
  useFrame(({ clock }) => {
    const target = mesh.current;
    if (!target) return;
    const offset = flowOffset(clock.elapsedTime, look.flowSpeed, spacing);
    for (let i = 0; i < count; i += 1) {
      const at = pointAt(world, (offset + i * spacing) % Math.max(length, 1e-6));
      if (!at) continue;
      m.makeTranslation(at.p[0], CONNECTOR_Y + 0.005, at.p[1]);
      target.setMatrixAt(i, m);
    }
    target.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} renderOrder={6} userData={{ hdFlowDots: count }} frustumCulled={false} />;
}
