import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Vector3,
  type Camera,
  type Group,
  type Vector3Tuple,
} from 'three';

/**
 * Snapshot used to pin CSS Html to pixel centers. Live/tuner labels sit
 * on the same XZ plane as the supply slab so they follow the 3D point.
 */
export const SnapshotLabelLock = createContext(false);

/** Must match ProcessSceneView.REFERENCE_ZOOM. */
export const LABEL_REFERENCE_ZOOM = 32.5;

/**
 * Screen clockwise degrees of floor type that runs along world +X under
 * the (D,D,D) ortho camera. lookAt builds camera-right = normalize(1,0,-1)
 * and camera-up = normalize(-1,2,-1); +X then projects with
 * atan2(1/√6, 1/√2) = 30° down-right in CSS (y down). Snapshot Html is
 * not on the XZ plane, so without this the overlay dual-ghosts horizontal
 * CSS against Arcentry’s slab labels.
 * Tick 186: drei Html transform on XZ at unprojected pins sat huge mirrored
 * type vs r-deg aisle Helvetica — keep the 30° screen stamp.
 */
export const ISO_LABEL_SCREEN_DEG = 30;

/**
 * CSS px per scene `size` for snapshot Html. 42 made type larger than
 * the reference crop; 36 lands ~11–12px on the 0.32 body labels.
 */
export const LABEL_SCREEN_PX_PER_SIZE = 36;

/** Floor for snapshot Html. 10px clamped Pressure/Steam (size 0.22) so shrinking
 * those rows did nothing — overlay duals stayed at the 10px glyph width. */
export const LABEL_SCREEN_PX_MIN = 8;

/**
 * Two-line slab labels (Holding Tank, Supply Tanks). 1.15 left “Tank”
 * ~8px short of Arcentry’s line gap after the 30° Html rotate; 1.8
 * overshot (Holding AABB 40px). 1.32 still sat “Tank” under Holding in
 * o-hold vs r-hold’s down-right sit. 1.45 is the middle.
 */
export const LABEL_TWO_LINE_HEIGHT = 1.45;

/**
 * Centered two-line put Tank under Holding vs r-hold Tank down-right
 * along the aisle after the 30° rotate. Right-align only; single-line
 * stays center. Do not change transformOrigin.
 */
export const LABEL_TWO_LINE_ALIGN = 'right';

/**
 * Snapshot Html tracking. Unset CSS sat glyphs wide vs r-deg condensed
 * aisle type. Do not change transformOrigin (would unfreeze pin sits).
 */
export const LABEL_LETTER_SPACING = '-0.03em';

/** Snapshot Html used system-ui so glyphs sat round vs r-deg Helvetica aisle type. */
export const LABEL_FONT_FAMILY = 'Helvetica Neue, Helvetica, Arial, sans-serif';

/** 400 sat heavy vs r-deg aisle type. Do not change transformOrigin. */
export const LABEL_FONT_WEIGHT = 300;

/** Floor text is drawn heavier than the snapshot Html (300): thin strokes vanish at 8 px. */
const LABEL_FLOOR_FONT_WEIGHT = 600;

/**
 * In-plane yaw in degrees, clockwise looking down. 0 = world +X (the
 * slab’s long edge). CSS Html used a screen-space aisle that was not
 * on the slab plane.
 */
export const LABEL_BASE_DEG = 0;

/** Just above Area’s plane so type doesn’t z-fight the fill. */
export const LABEL_PLANE_Y = 0.05;

/**
 * Unproject a snapshot pin onto Y = LABEL_PLANE_Y. Tick 186 Html transform
 * on this hit sat huge mirrored CSS. Troika Text uses world fontSize like live.
 */
export function screenToSlab(
  camera: Camera,
  viewW: number,
  viewH: number,
  screenX: number,
  screenY: number,
  planeY = LABEL_PLANE_Y,
): Vector3Tuple {
  const a = new Vector3((screenX / viewW) * 2 - 1, -(screenY / viewH) * 2 + 1, -1);
  const b = new Vector3((screenX / viewW) * 2 - 1, -(screenY / viewH) * 2 + 1, 1);
  a.unproject(camera);
  b.unproject(camera);
  const dy = b.y - a.y;
  if (Math.abs(dy) < 1e-9) {
    return [a.x, planeY, a.z];
  }
  const t = (planeY - a.y) / dy;
  return [a.x + (b.x - a.x) * t, planeY, a.z + (b.z - a.z) * t];
}

/** Canvas pixels per world unit for floor text; high enough to stay crisp at the 80x max zoom. */
const FLOOR_TEXT_PX_PER_UNIT = 160;
const FLOOR_TEXT_MAX_PX = 2048;

/**
 * Text lying flat on the floor, drawn into a canvas texture on a plane.
 *
 * Why not drei `<Text>` (troika)? Troika renders glyphs through an
 * `onBeforeCompile` GLSL patch, which three's WebGPURenderer (what IsoCanvas
 * uses) ignores: every label showed up as a solid square of the text colour.
 * A canvas texture on a MeshBasicMaterial works on both renderers. The
 * texture is rebuilt only when text or colour changes (a live value label
 * changes at the metrics tick, ~2 Hz).
 */
/** Text styling shared by labels, connector captions and the metadata plane. Defaults = the original floor label. */
export interface FloorTextStyle {
  /** CSS font weight; default 600 (thin strokes vanish at 8 px). */
  weight?: number;
  italic?: boolean;
  /** Halo drawn behind the glyphs (Arcentry "outline"); absent = none. */
  outlineColor?: string;
  /** Halo width as a fraction of the font size (default 0.12). */
  outlineWidth?: number;
  /** Panel behind the text (metadata plane). */
  background?: { fill: string; stroke?: string };
}

/**
 * Text lying flat on the floor, drawn into a canvas texture on a plane.
 *
 * Why not drei `<Text>` (troika)? Troika renders glyphs through an
 * `onBeforeCompile` GLSL patch, which three's WebGPURenderer (what IsoCanvas
 * uses) ignores: every label showed up as a solid square of the text colour.
 * A canvas texture on a MeshBasicMaterial works on both renderers. The
 * texture is rebuilt only when text or style changes (a live value label
 * changes at the metrics tick, ~2 Hz).
 *
 * The plane lies in its local XY plane; callers rotate it onto the floor
 * (-90 degrees about X) or stand it up. `anchorX` picks which edge of the
 * text sits on the local origin.
 */
export function FloorText({
  children,
  fill,
  fontSize,
  anchorX = 'center',
  lineHeight,
  renderOrder = 8,
  textStyle,
  opacity = 1,
}: {
  children: string;
  fill: string;
  /** World units (cap height ~ fontSize). */
  fontSize: number;
  anchorX?: 'left' | 'center' | 'right';
  lineHeight: number;
  renderOrder?: number;
  textStyle?: FloorTextStyle;
  opacity?: number;
}) {
  const weight = textStyle?.weight ?? LABEL_FLOOR_FONT_WEIGHT;
  const italic = textStyle?.italic ?? false;
  const outlineColor = textStyle?.outlineColor;
  const outlineWidth = textStyle?.outlineWidth ?? 0.12;
  const bgFill = textStyle?.background?.fill;
  const bgStroke = textStyle?.background?.stroke;
  const baked = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const lines = children.split('\n');
    const fontPx = Math.max(8, Math.round(fontSize * FLOOR_TEXT_PX_PER_UNIT));
    const font = `${italic ? 'italic ' : ''}${weight} ${fontPx}px ${LABEL_FONT_FAMILY}`;
    const probe = document.createElement('canvas').getContext('2d');
    if (!probe) return null;
    probe.font = font;
    const halo = outlineColor ? Math.max(1, outlineWidth * fontPx) : 0;
    const pad = Math.ceil(fontPx * 0.2 + halo + (bgFill ? fontPx * 0.3 : 0));
    const textW = Math.max(1, ...lines.map((l) => probe.measureText(l).width));
    const lineH = fontPx * lineHeight;
    const w = Math.min(FLOOR_TEXT_MAX_PX, Math.ceil(textW + pad * 2));
    const h = Math.min(FLOOR_TEXT_MAX_PX, Math.ceil(lineH * lines.length + pad * 2));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (bgFill) {
      const inset = Math.ceil(fontPx * 0.06);
      ctx.fillStyle = bgFill;
      ctx.fillRect(inset, inset, w - inset * 2, h - inset * 2);
      if (bgStroke) {
        ctx.strokeStyle = bgStroke;
        ctx.lineWidth = Math.max(1, fontPx * 0.06);
        ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
      }
    }
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = anchorX;
    const x = anchorX === 'right' ? w - pad : anchorX === 'left' ? pad : w / 2;
    if (outlineColor) {
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = halo * 2;
      ctx.lineJoin = 'round';
      lines.forEach((line, i) => ctx.strokeText(line, x, pad + lineH * (i + 0.5)));
    }
    ctx.fillStyle = fill;
    lines.forEach((line, i) => ctx.fillText(line, x, pad + lineH * (i + 0.5)));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.anisotropy = 8;
    return { texture, width: w / FLOOR_TEXT_PX_PER_UNIT, height: h / FLOOR_TEXT_PX_PER_UNIT };
  }, [children, fill, fontSize, anchorX, lineHeight, weight, italic, outlineColor, outlineWidth, bgFill, bgStroke]);
  useEffect(() => () => baked?.texture.dispose(), [baked]);
  if (!baked) return null;
  const offsetX = anchorX === 'right' ? -baked.width / 2 : anchorX === 'left' ? baked.width / 2 : 0;
  return (
    <mesh position={[offsetX, 0, 0]} renderOrder={renderOrder}>
      <planeGeometry args={[baked.width, baked.height]} />
      <meshBasicMaterial map={baked.texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function labelYaw(rotationY: number, angleDeg?: number): number {
  const aisle = ((angleDeg ?? LABEL_BASE_DEG) * Math.PI) / 180;
  const extra = rotationY - Math.PI / 4;
  // Three.js Y yaw is CCW; the tuner slider is clockwise looking down.
  return -aisle + extra;
}

function SnapshotSlabText({
  screenX,
  screenY,
  nudgeX,
  nudgeY,
  children,
  fill,
  size,
  rotationY,
  angleDeg,
  labelId,
}: {
  screenX: number;
  screenY: number;
  nudgeX?: number;
  nudgeY?: number;
  children: string;
  fill: string;
  size: number;
  rotationY: number;
  angleDeg?: number;
  labelId?: string;
}) {
  const { camera, size: view } = useThree();
  const slab = useRef<Group>(null);
  const x = screenX + (nudgeX ?? 0);
  const y = screenY + (nudgeY ?? 0);
  const px = Math.max(LABEL_SCREEN_PX_MIN, Math.round(size * LABEL_SCREEN_PX_PER_SIZE));
  const twoLine = children.includes('\n');
  const lineHeight = twoLine ? LABEL_TWO_LINE_HEIGHT : 1.15;
  const yaw = labelYaw(rotationY, angleDeg);

  useFrame(() => {
    if (!slab.current || view.width < 1 || view.height < 1) {
      return;
    }
    const [wx, wy, wz] = screenToSlab(camera, view.width, view.height, x, y);
    slab.current.position.set(wx, wy, wz);
  });

  return (
    <>
      <Html calculatePosition={() => [x, y]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none', opacity: 0 }}>
        <div
          data-label-id={labelId}
          style={{
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              transform: `rotate(${ISO_LABEL_SCREEN_DEG}deg)`,
              transformOrigin: 'center center',
              fontSize: `${px}px`,
              fontFamily: LABEL_FONT_FAMILY,
              fontWeight: LABEL_FONT_WEIGHT,
              textAlign: twoLine ? LABEL_TWO_LINE_ALIGN : 'center',
              whiteSpace: 'pre',
              lineHeight,
              letterSpacing: LABEL_LETTER_SPACING,
            }}
          >
            {children}
          </div>
        </div>
      </Html>
      <group ref={slab} rotation={[0, yaw, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]}>
          <FloorText
            fill={fill}
            fontSize={size * 0.9}
            anchorX={twoLine ? 'right' : 'center'}
            lineHeight={lineHeight}
          >
            {children}
          </FloorText>
        </group>
      </group>
    </>
  );
}

/**
 * Group whose yaw follows the camera so its local +Z faces the viewer (a
 * Y-axis billboard). With the orthographic iso camera every object faces the
 * same way, so the yaw is just the camera's viewing direction; Q/E view
 * rotation keeps upright labels and billboard images readable.
 */
export function FaceCamera({ children, position }: { children: ReactNode; position?: Vector3Tuple }) {
  const group = useRef<Group>(null);
  const dir = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    if (!group.current) return;
    camera.getWorldDirection(dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    if (group.current.rotation.y !== yaw) group.current.rotation.y = yaw;
  });
  return (
    <group ref={group} position={position}>
      {children}
    </group>
  );
}

export type LabelAlign = 'auto' | 'left' | 'center' | 'right';
export type LabelOrient = 'flat' | 'upright';

export function Label({
  position,
  children,
  color = '#666666',
  size = 0.28,
  rotationY = Math.PI / 4,
  angleDeg,
  nudgeX,
  nudgeY,
  screenX,
  screenY,
  labelId,
  textStyle,
  align = 'auto',
  orient = 'flat',
}: {
  position: Vector3Tuple;
  rotationY?: number;
  /** Degrees clockwise on the floor plane. Defaults to LABEL_BASE_DEG. */
  angleDeg?: number;
  children: string;
  color?: string;
  size?: number;
  nudgeX?: number;
  nudgeY?: number;
  screenX?: number;
  screenY?: number;
  labelId?: string;
  /** Bold / italic / outline (label part params). Ignored by the pinned snapshot path. */
  textStyle?: FloorTextStyle;
  /** Which text edge sits on the label point; `auto` = centred (the original look). */
  align?: LabelAlign;
  /** `flat` on the floor (default) or `upright`, standing and facing the camera. */
  orient?: LabelOrient;
}) {
  const pin = useContext(SnapshotLabelLock);
  const fill = color === '#666666' ? '#4a4a4a' : color;
  if (pin && screenX != null && screenY != null) {
    return (
      <SnapshotSlabText
        screenX={screenX}
        screenY={screenY}
        nudgeX={nudgeX}
        nudgeY={nudgeY}
        fill={fill}
        size={size}
        rotationY={rotationY}
        angleDeg={angleDeg}
        labelId={labelId}
      >
        {children}
      </SnapshotSlabText>
    );
  }
  const lineHeight = children.includes('\n') ? LABEL_TWO_LINE_HEIGHT : 1.15;
  const anchorX = align === 'auto' ? 'center' : align;
  const text = (
    <FloorText fill={fill} fontSize={size * 0.9} lineHeight={lineHeight} anchorX={anchorX} textStyle={textStyle}>
      {children}
    </FloorText>
  );
  if (orient === 'upright') {
    // Stand on the floor: lift by half the text block so the bottom line sits at the label point.
    const lift = (children.split('\n').length * lineHeight * size * 0.9) / 2 + size * 0.2;
    return (
      <FaceCamera position={[position[0], lift, position[2]]}>
        <group userData={{ labelId }}>{text}</group>
      </FaceCamera>
    );
  }
  const yaw = labelYaw(rotationY, angleDeg);
  return (
    <group position={position} rotation={[0, yaw, 0]} userData={{ labelId }}>
      <group rotation={[-Math.PI / 2, 0, 0]}>{text}</group>
    </group>
  );
}
