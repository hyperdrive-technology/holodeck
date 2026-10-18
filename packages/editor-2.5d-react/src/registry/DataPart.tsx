import { Suspense, useEffect, useMemo } from 'react';
import { DoubleSide } from 'three';
import { Edges } from '../../assets/process/Edges';
import { HolodeckModel } from '../anim/HolodeckModel';
import { useTrackedGLTF } from '../../assets/process/HolodeckModel';
import { createFinishMaterial } from '../../assets/process/materials';
import type { HolodeckStyle } from '../../assets/process/style';
import { gridToWorld } from '../iso/grid';
import { PendingAsset } from '../iso/render-signal';
import { AssetBoundary, useTrackedTexture } from '../objects/assets';
import { fitAspect, logoAnchorForBlock, logoAnchorFromModel, logoPlaneQuaternion, type LogoAnchor } from '../objects/logo';
import { partScale } from './part-scale';
import type { IsoPartDefinition, IsoPartLogo, IsoPartProps } from './types';

/** Block height for a data-only part with no model and no `blockHeight`. */
export const DATA_BLOCK_HEIGHT = 1;

/**
 * Renderer for **data-only** parts: definitions with no `component`, only
 * `model` and/or `logo` + `colors` (holodeck#36, the contract lane A1's
 * archetypes and A2's AWS catalogue build on). A pack can therefore ship
 * hundreds of components as JSON.
 *
 * - `model` set: the GLB, styled by the active theme (`applyHolodeckStyle`),
 *   with `colors.body` / `colors.accent` / `colors.edge` as per-part overrides.
 *   A placement's `color` beats `colors.accent` (per-instance brand stripe).
 * - no `model`: a plain block, footprint-sized and `blockHeight` tall.
 * - `logo` set: a textured plane on the top face (see `logoAnchorFromModel`
 *   for the `logo` empty contract).
 */
export function DataPart({ placement, params, style, def }: IsoPartProps) {
  const [wx, , wz] = gridToWorld(placement.x, placement.y);
  const yaw = placement.rotation ?? 0;
  return (
    <group position={[wx, 0, wz]} rotation={[0, yaw, 0]}>
      {def.model ? (
        // useLoader suspends; the fallback holds the canvas's rendered signal until the model is in.
        <AssetBoundary resetKey={def.model}>
          <Suspense fallback={<PendingAsset />}>
            <DataModel
              def={def}
              params={params}
              style={style}
              // Resolved params include provider bindings (threshold colours in
              // Studio's cloud sample). They take precedence over static colour; an empty
              // string (a valid 'no colour' default) falls back to placement / package colour.
              accent={typeof params.color === 'string' && params.color !== '' ? params.color : placement.color}
              animation={placement.animation}
            />
          </Suspense>
        </AssetBoundary>
      ) : (
        <DataBlock def={def} style={style} />
      )}
    </group>
  );
}

function DataModel({
  def,
  params,
  style,
  accent,
  animation,
}: {
  def: IsoPartDefinition;
  params: Record<string, unknown>;
  style: HolodeckStyle;
  accent: string | undefined;
  animation: IsoPartProps['placement']['animation'];
}) {
  const gltf = useTrackedGLTF(def.model!, { holdRequest: false }); // the <PendingAsset/> fallback holds
  const scale = partScale(def);
  // Measured on the cached, never-rendered source scene: placement-independent.
  const anchor = useMemo(() => logoAnchorFromModel(gltf.scene), [gltf]);
  return (
    <>
      <HolodeckModel
        url={def.model!}
        // The surrounding group carries position and yaw.
        position={[0, 0, 0]}
        scale={scale}
        accent={accent ?? def.colors?.accent}
        body={def.colors?.body}
        edgeColor={def.colors?.edge}
        style={style}
        def={def}
        params={params}
        animation={animation}
      />
      {def.logo && anchor ? <LogoPlane logo={def.logo} anchor={anchor} scale={scale} /> : null}
    </>
  );
}

function DataBlock({ def, style }: { def: IsoPartDefinition; style: HolodeckStyle }) {
  const { w, h } = def.footprint;
  const height = def.blockHeight ?? DATA_BLOCK_HEIGHT;
  const material = useMemo(
    () => createFinishMaterial('white', { style, color: def.colors?.body, offset: true }),
    [style, def.colors?.body],
  );
  useEffect(() => () => material.dispose(), [material]);
  return (
    <>
      <mesh position={[0, height / 2, 0]} material={material}>
        <boxGeometry args={[w, height, h]} />
        <Edges color={def.colors?.edge} />
      </mesh>
      {def.logo ? <LogoPlane logo={def.logo} anchor={logoAnchorForBlock(w, h, height)} scale={1} /> : null}
    </>
  );
}

/** The logo plane, in the part group's frame. Loads lazily; a bad URL draws nothing. */
export function LogoPlane({ logo, anchor, scale }: { logo: IsoPartLogo; anchor: LogoAnchor; scale: number }) {
  return (
    <AssetBoundary resetKey={logo.url}>
      <Suspense fallback={<PendingAsset />}>
        <LogoMesh logo={logo} anchor={anchor} scale={scale} />
      </Suspense>
    </AssetBoundary>
  );
}

function LogoMesh({ logo, anchor, scale }: { logo: IsoPartLogo; anchor: LogoAnchor; scale: number }) {
  const texture = useTrackedTexture(logo.url);
  const quaternion = useMemo(() => logoPlaneQuaternion(anchor), [anchor]);
  if (!texture) return null;
  const image = texture.image as { width?: number; height?: number } | undefined;
  const aspect = image?.width && image?.height ? image.width / image.height : 1;
  // logo.size is world units (already final); the anchor size is in model units.
  const [pw, pd] = fitAspect(logo.size ?? anchor.size * scale, aspect);
  const [x, y, z] = anchor.position;
  // On the slot's face, in the slot's orientation (holodeck#138): top-face
  // slots lie flat with the image top toward the part's -Z, an upright sign's
  // front-face slot stands up. Reads like a sticker and turns with the part.
  return (
    <group position={[x * scale, y * scale, z * scale]} userData={{ hdLogo: logo.url.slice(0, 120) }}>
      <mesh quaternion={quaternion} renderOrder={6}>
        <planeGeometry args={[pw, pd]} />
        <meshBasicMaterial
          map={texture}
          transparent
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  );
}
