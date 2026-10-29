import { useEffect, useMemo, type ReactNode } from 'react';
import { BackSide, type Side } from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { Edges } from './Edges';
import { createFinishMaterial, createIsoShadeMaterial, setIsoShade, type IsoShadeParams } from './materials';
import { HOLODECK_STYLE } from './style';
import { useHolodeckStyle } from './style-context';

/**
 * Process-plant materials as R3F wrappers over the plain factories in
 * materials.ts. Token values (and why each was picked) live in style.ts;
 * the names below are kept as aliases for existing imports.
 */
export const EDGE = HOLODECK_STYLE.colors.edge;
export const BODY = HOLODECK_STYLE.colors.body;
export const FILL = HOLODECK_STYLE.colors.liquid;

const SHADED = HOLODECK_STYLE.finishes.shaded;

/** Iso material whose uniforms follow props every render; offset is baked (new material on change). */
function useIsoShadeMaterial({ offset, inside = false, ...shade }: IsoShadeParams & { offset: boolean; inside?: boolean }) {
  // Shade numbers are uniforms (set below), so only `offset` / `inside` rebuild.
  const material = useMemo(() => {
    const m = createIsoShadeMaterial({ ...shade, offset, inside });
    // A liner is seen from inside the vessel: draw its back faces.
    if (inside) m.side = BackSide;
    return m;
  }, [offset, inside]);
  setIsoShade(material, shade);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

/** Dispose-on-unmount wrapper for a factory material. */
function useOwnedMaterial(create: () => MeshBasicNodeMaterial, deps: unknown[]) {
  const material = useMemo(create, deps);
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

export function ShadedFill({
  radius,
  whiteHub = SHADED.whiteHub,
  shadeMin = SHADED.shadeMin,
  shadeMax = SHADED.shadeMax,
  hubWhite = SHADED.hubWhite,
  // Tanks need this so Edges win; pipes must not — offset lets the
  // floor Grid steal the underside and reads as ground-only shade.
  offset = SHADED.offset,
  inside = false,
}: {
  radius: number;
  whiteHub?: boolean;
  shadeMin?: number;
  shadeMax?: number;
  hubWhite?: number;
  offset?: boolean;
  /** Liner: back faces, shaded with the inward normal (createIsoShadeMaterial `inside`). */
  inside?: boolean;
}) {
  const material = useIsoShadeMaterial({
    radius,
    whiteHub,
    shadeMin,
    shadeMax,
    hubWhite,
    offset,
    inside,
  });
  return <primitive object={material} attach="material" />;
}

export function ShadedMesh({
  radius,
  position,
  rotation,
  whiteHub = false,
  shadeMin,
  shadeMax,
  hubWhite,
  offset,
  inside,
  children,
}: {
  radius: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  whiteHub?: boolean;
  shadeMin?: number;
  shadeMax?: number;
  hubWhite?: number;
  offset?: boolean;
  inside?: boolean;
  children: ReactNode;
}) {
  return (
    <mesh position={position} rotation={rotation}>
      {children}
      <ShadedFill
        radius={radius}
        whiteHub={whiteHub}
        shadeMin={shadeMin}
        shadeMax={shadeMax}
        hubWhite={hubWhite}
        offset={offset}
        inside={inside}
      />
    </mesh>
  );
}

export function Shell({
  color,
  side,
  threshold,
  children,
}: {
  color?: string;
  side?: Side;
  threshold?: number;
  children: ReactNode;
}) {
  const style = useHolodeckStyle();
  return (
    <mesh>
      {children}
      <meshPhongMaterial
        color={color ?? style.colors.body}
        side={side}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
        toneMapped={false}
      />
      <Edges threshold={threshold ?? style.edges.threshold} />
    </mesh>
  );
}

/** Unlit white fill. Iso shade is tanks-only — pipes read as grey if they share it. */
export function WhiteFill() {
  const style = useHolodeckStyle();
  const material = useOwnedMaterial(() => createFinishMaterial('white', { style }), [style]);
  return <primitive object={material} attach="material" />;
}

/** Unlit flat colour (valve handwheels). Same as the old `<meshBasicMaterial color toneMapped={false} />`. */
export function AccentFill({ color: colorProp }: { color?: string }) {
  const style = useHolodeckStyle();
  const color = colorProp ?? style.finishes.accent.color;
  const material = useOwnedMaterial(() => createFinishMaterial('accent', { color, style }), [style]);
  material.color.set(color);
  return <primitive object={material} attach="material" />;
}

export function WhiteMesh({
  position,
  rotation,
  rotationOrder,
  children,
}: {
  position?: [number, number, number];
  rotation?: [number, number, number];
  rotationOrder?: 'XYZ' | 'YXZ' | 'ZYX';
  children: ReactNode;
}) {
  return (
    <mesh position={position} rotation={rotation} rotation-order={rotationOrder}>
      {children}
      <WhiteFill />
    </mesh>
  );
}

export const BODY_PROPS = {
  color: BODY,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
  toneMapped: false,
} as const;
