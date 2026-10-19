/**
 * Renderers for the flat annotation objects: `icon`, `image` and the
 * metadata plane. Each draws a textured plane either flat on the floor or
 * upright, facing the camera (`FaceCamera`).
 */

import { Suspense, useEffect, useMemo } from 'react';
import { CanvasTexture, DoubleSide, SRGBColorSpace, type Texture } from 'three';
import { FaceCamera, FloorText } from '../../assets/process/Label';
import { annotationStyle, type HolodeckStyle } from '../../assets/process/style';
import { assetHoldKey, PendingAsset } from '../iso/render-signal';
import { AssetBoundary, useTrackedTexture } from './assets';
import { retainImageAspect, setImageAspect } from './image-aspect';
import { drawIcon, ICON_TEXTURE_PX } from './icons';
import type { IsoMetaValue } from './validate';

/** Flat marks sit at label height: above areas and connectors. */
export const MARK_Y = 0.05;

export type MarkOrient = 'flat' | 'upright';

/**
 * A `w` x `h` textured plane at (x, z): flat on the floor, grid-aligned
 * (image top toward -Z, its width along +X like floor labels), or standing on
 * the floor facing the camera.
 */
function MarkPlane({
  x,
  z,
  w,
  h,
  orient,
  texture,
  opacity = 1,
  userData,
}: {
  x: number;
  z: number;
  w: number;
  h: number;
  orient: MarkOrient;
  texture: Texture;
  opacity?: number;
  userData?: Record<string, unknown>;
}) {
  const plane = (
    <mesh renderOrder={7} userData={userData}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} side={DoubleSide} />
    </mesh>
  );
  if (orient === 'upright') return <FaceCamera position={[x, h / 2, z]}>{plane}</FaceCamera>;
  return (
    <group position={[x, MARK_Y, z]} rotation={[-Math.PI / 2, 0, 0]}>
      {plane}
    </group>
  );
}

export function IconMark({
  x,
  z,
  icon,
  glyph,
  color,
  size,
  orient,
  style,
}: {
  x: number;
  z: number;
  icon: string;
  glyph: string;
  color: string;
  size: number;
  orient: MarkOrient;
  style: HolodeckStyle;
}) {
  const fill = color || annotationStyle(style).icon;
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = ICON_TEXTURE_PX;
    canvas.height = ICON_TEXTURE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    if (drawIcon(ctx, { icon, glyph, color: fill, px: ICON_TEXTURE_PX }) === 'none') return null;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return t;
  }, [icon, glyph, fill]);
  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;
  return <MarkPlane x={x} z={z} w={size} h={size} orient={orient} texture={texture} userData={{ hdIcon: glyph || icon }} />;
}

export function ImageMark(props: { x: number; z: number; src: string; width: number; height: number; orient: MarkOrient; owner?: string }) {
  if (!props.src) return null;
  return (
    <AssetBoundary resetKey={props.src}>
      <Suspense fallback={<PendingAsset requestKey={assetHoldKey(props.owner, `texture:${props.src}`)} />}>
        <ImageMarkLoaded {...props} />
      </Suspense>
    </AssetBoundary>
  );
}

function ImageMarkLoaded({ x, z, src, width, height, orient, owner }: { x: number; z: number; src: string; width: number; height: number; orient: MarkOrient; owner?: string }) {
  const texture = useTrackedTexture(src, owner);
  const image = texture?.image as { width?: number; height?: number } | undefined;
  const loaded = Boolean(image?.width && image?.height);
  const aspect = loaded ? image!.width! / image!.height! : 1;
  // Hold the aspect entry while mounted so the bounded cache never evicts it (holodeck#132).
  // Declared first: effects run in order, so the entry is retained before it is set.
  useEffect(() => retainImageAspect(src), [src]);
  // Bounds (fit-to-view) read the real aspect from here (holodeck#108). After render, not during it.
  useEffect(() => {
    if (loaded) setImageAspect(src, aspect);
  }, [src, aspect, loaded]);
  if (!texture) return null;
  // height 0 = keep the image's aspect at `width`; both set = letterbox inside width x height.
  const [w, h] = height > 0 ? fitBox(width, height, aspect) : [width, width / aspect];
  return <MarkPlane x={x} z={z} w={w} h={h} orient={orient} texture={texture} userData={{ hdImage: src.slice(0, 120) }} />;
}

/** Largest w x h with `aspect` that fits inside `boxW` x `boxH`. */
export function fitBox(boxW: number, boxH: number, aspect: number): [number, number] {
  if (!Number.isFinite(aspect) || aspect <= 0) return [boxW, boxH];
  return boxW / boxH > aspect ? [boxH * aspect, boxH] : [boxW, boxW / aspect];
}

/** Metadata rows as text lines, `key: value`, in insertion order. */
export function metaLines(meta: Record<string, IsoMetaValue>): string[] {
  return Object.entries(meta).map(([k, v]) => `${k}: ${typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)}`);
}

/**
 * The metadata plane: a small panel of `key: value` rows on the floor just
 * in front of (screen-below) the object's footprint. `depth` is the
 * footprint's grid depth (y extent) so the panel clears the object.
 */
export function MetaPlane({
  x,
  z,
  depth,
  meta,
  style,
}: {
  x: number;
  z: number;
  depth: number;
  meta: Record<string, IsoMetaValue>;
  style: HolodeckStyle;
}) {
  const tokens = annotationStyle(style);
  const lines = metaLines(meta);
  if (lines.length === 0) return null;
  const size = 0.24;
  return (
    <group position={[x, MARK_Y, z + depth / 2 + 0.25 + (lines.length * size * 1.3) / 2]} userData={{ hdMeta: lines.length }}>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <FloorText
          fill={tokens.metaText}
          fontSize={size}
          lineHeight={1.3}
          anchorX="center"
          renderOrder={9}
          textStyle={{ weight: 500, background: { fill: tokens.metaFill, stroke: tokens.metaEdge } }}
        >
          {lines.join('\n')}
        </FloorText>
      </group>
    </group>
  );
}
