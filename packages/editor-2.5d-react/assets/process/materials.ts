import { Color, type ColorRepresentation, type Side } from 'three';
import { clamp, float, length, max, min, mix, normalView, positionLocal, uniform, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { HOLODECK_STYLE, type Finish, type FinishName, type HolodeckStyle, type IsoFinish } from './style';

/**
 * Plain (non-React) material factories for the Holodeck iso look.
 *
 * `Shell.tsx` wraps these for R3F; `applyHolodeckStyle` calls them directly
 * on GLB scenes. Everything is a node material because the canvases run
 * `WebGPURenderer` only — see the notes on `createIsoShadeMaterial`.
 */

/** Live uniforms on an iso material. Mutate `.value`; no recompile. */
export type IsoUniforms = {
  uRadius: { value: number };
  uWhiteHub: { value: number };
  uShadeMin: { value: number };
  uShadeMax: { value: number };
  uHubWhite: { value: number };
};

export type IsoShadeParams = {
  /** Hub radius in local XZ units. Only read when `whiteHub` is on. */
  radius: number;
  whiteHub: boolean;
  shadeMin: number;
  shadeMax: number;
  hubWhite: number;
};

/**
 * View-space iso gradient on a node material.
 *
 * The previous version patched MeshBasicMaterial in `onBeforeCompile`.
 * That hook is a WebGL program callback. WebGPURenderer never calls it,
 * so the fill would render flat white. `normalView` is the old
 * `transformedNormal` (view space, instance-rotated). `positionLocal` is
 * the un-instanced mesh position, which is what the hub radius needs —
 * instance Y-scale used to collapse a world-XZ shade into a dark band
 * where a pipe met the floor.
 *
 * The gradient runs on the GPU (not CPU vertex colours) so it works on
 * both Mesh and InstancedMesh: CPU colours mutated a shared R3F geometry
 * cache and could not instance.
 *
 * `offset` is baked at creation (polygon offset changes the pipeline);
 * the shade numbers are uniforms, so `setIsoShade` can retune them live.
 */
export function createIsoShadeMaterial(
  params: IsoShadeParams & { offset: boolean },
): MeshBasicNodeMaterial {
  const uRadius = uniform(params.radius);
  const uWhiteHub = uniform(params.whiteHub ? 1 : 0);
  const uShadeMin = uniform(params.shadeMin);
  const uShadeMax = uniform(params.shadeMax);
  const uHubWhite = uniform(params.hubWhite);
  const n = normalView;
  const t = clamp(n.x.mul(0.65).add(n.y.mul(0.35)), -1, 1).mul(0.5).add(0.5);
  const rim = mix(uShadeMin, uShadeMax, t);
  const localRadial = vec3(positionLocal.x, float(0), positionLocal.z);
  const hub = min(float(1), length(localRadial).div(max(uRadius, float(1e-6))));
  const g = mix(uHubWhite, rim, mix(float(1), hub, uWhiteHub));
  const mat = new MeshBasicNodeMaterial();
  mat.colorNode = vec3(g);
  mat.toneMapped = false;
  setPolygonOffset(mat, params.offset);
  mat.userData.iso = { uRadius, uWhiteHub, uShadeMin, uShadeMax, uHubWhite } satisfies IsoUniforms;
  return mat;
}

/** Retune an iso material made by `createIsoShadeMaterial`. Unknown materials are ignored. */
export function setIsoShade(material: MeshBasicNodeMaterial, params: Partial<IsoShadeParams>): void {
  const iso = material.userData.iso as IsoUniforms | undefined;
  if (!iso) {
    return;
  }
  if (params.radius !== undefined) iso.uRadius.value = params.radius;
  if (params.whiteHub !== undefined) iso.uWhiteHub.value = params.whiteHub ? 1 : 0;
  if (params.shadeMin !== undefined) iso.uShadeMin.value = params.shadeMin;
  if (params.shadeMax !== undefined) iso.uShadeMax.value = params.shadeMax;
  if (params.hubWhite !== undefined) iso.uHubWhite.value = params.hubWhite;
}

/** Unlit flat colour, same settings as the old `<meshBasicMaterial toneMapped={false} />`. */
export function createUnlitMaterial({
  color,
  offset,
}: {
  color: ColorRepresentation | Color;
  offset: boolean;
}): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial();
  if (color instanceof Color) {
    // Copy, don't `.set(hex)`: a GLB base colour is already linear and a
    // hex round-trip would re-apply the sRGB → linear conversion.
    mat.color.copy(color);
  } else {
    mat.color.set(color);
  }
  mat.toneMapped = false;
  setPolygonOffset(mat, offset);
  return mat;
}

export type FinishMaterialOptions = {
  /** Token source when `finish` is a name. Defaults to `HOLODECK_STYLE`. */
  style?: HolodeckStyle;
  /** Unlit finishes only: overrides the finish colour (accent per instance). */
  color?: ColorRepresentation | Color;
  /** Overrides the finish's polygon offset. */
  offset?: boolean;
  /** Iso finishes only: hub radius. Defaults to 1 (unused unless `whiteHub`). */
  radius?: number;
  /** Iso finishes only: overrides `finish.whiteHub`. */
  whiteHub?: boolean;
  /** Iso finishes only: per-call shade overrides (tuner sliders). */
  shade?: Partial<Pick<IsoFinish, 'shadeMin' | 'shadeMax' | 'hubWhite'>>;
  side?: Side;
};

/**
 * One material for a named finish (`'vessel'`) or a finish token. The
 * returned material records the finish in `userData.hdFinish` so tests and
 * `applyHolodeckStyle` can tell styled materials apart.
 */
export function createFinishMaterial(
  finish: FinishName | Finish,
  opts: FinishMaterialOptions = {},
): MeshBasicNodeMaterial {
  const style = opts.style ?? HOLODECK_STYLE;
  const token = typeof finish === 'string' ? style.finishes[finish] : finish;
  const offset = opts.offset ?? token.offset;
  const mat =
    token.kind === 'iso'
      ? createIsoShadeMaterial({
          radius: opts.radius ?? 1,
          whiteHub: opts.whiteHub ?? token.whiteHub,
          shadeMin: opts.shade?.shadeMin ?? token.shadeMin,
          shadeMax: opts.shade?.shadeMax ?? token.shadeMax,
          hubWhite: opts.shade?.hubWhite ?? token.hubWhite,
          offset,
        })
      : createUnlitMaterial({ color: opts.color ?? token.color, offset });
  if (opts.side !== undefined) {
    mat.side = opts.side;
  }
  mat.userData.hdFinish = typeof finish === 'string' ? finish : token.kind;
  return mat;
}

function setPolygonOffset(mat: MeshBasicNodeMaterial, offset: boolean): void {
  mat.polygonOffset = offset;
  mat.polygonOffsetFactor = offset ? 1 : 0;
  mat.polygonOffsetUnits = offset ? 1 : 0;
}
