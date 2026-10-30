/**
 * Core's brewhouse HMI scene (tests/fixtures/brewery/brewhouse.iso.json) as
 * built-in parts only, for routing-brewhouse-render.test.ts.
 *
 * - Every `brewery:<vessel>` becomes a built-in `tank` with the SAME preset
 *   core's brewery pack draws it with (`params.preset`: mash tun = mixer.glb,
 *   whirlpool = flat lid on a skirt...), its radius / height and its level
 *   (core: 0..100 percent; `tank`: a 0..1 fraction). A vessel with no level
 *   is empty, not a default 40%.
 * - Pumps / the heat exchanger (brewery GLBs this package does not ship) are
 *   dropped; everything else is kept, minus core's `extensions`.
 * - Labels show what their binding would read: core binds a label and its
 *   vessel to the same PLC metric (`hyperdrive.bindings`), but the file
 *   stores the label's value as a stale 0 -- so the render said "Level 0.0 %"
 *   under a half-full HLT (Des, round 5). With no PLC here, a label bound to a
 *   metric that a placement also binds takes that placement's value.
 *
 * Core's binding format is read here only, in test support: holodeck itself
 * stays free of Hyperdrive code.
 */
import type { IsoPlacement, IsoSceneFile } from '../iso/scene';
import { TANK_PRESETS, type TankPresetId } from '../../assets/process/tank-presets';

const BINDINGS_EXT = 'hyperdrive.bindings';
/** Brewery parts that are not vessels (GLBs this package does not ship). */
const NON_VESSELS = new Set(['brewery:pump', 'brewery:heat-exchanger']);

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** `param name -> metric id` of a placement's core binding, or {}. */
export function boundMetrics(o: IsoPlacement): Record<string, string> {
  const ext = (o.extensions as Record<string, unknown> | undefined)?.[BINDINGS_EXT] as
    | { metrics?: Record<string, unknown> }
    | undefined;
  const out: Record<string, string> = {};
  for (const [param, metric] of Object.entries(ext?.metrics ?? {})) {
    if (typeof metric === 'string') out[param] = metric;
  }
  return out;
}

/** The preset core's brewery pack builds `brewery:<id>` from (ids match TANK_PRESETS keys), if any. */
export function breweryVesselPreset(object: string): TankPresetId | undefined {
  if (!object.startsWith('brewery:') || NON_VESSELS.has(object)) return undefined;
  const id = object.slice('brewery:'.length);
  return Object.prototype.hasOwnProperty.call(TANK_PRESETS, id) ? (id as TankPresetId) : undefined;
}

/**
 * Every metric a non-label placement binds, with the value that placement
 * holds for it (vessel level / temperature, pump running...). A metric bound
 * by two placements with different values keeps the first.
 */
export function metricSnapshot(objects: readonly IsoPlacement[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const o of objects) {
    if (o.object === 'label') continue;
    for (const [param, metric] of Object.entries(boundMetrics(o))) {
      const value = o.params?.[param];
      if (value !== undefined && !out.has(metric)) out.set(metric, value);
    }
  }
  return out;
}

export function builtinBrewhouse(raw: IsoSceneFile): IsoSceneFile {
  const snapshot = metricSnapshot(raw.objects);
  const objects: IsoPlacement[] = [];
  for (const o of raw.objects) {
    const preset = breweryVesselPreset(o.object);
    if (preset) {
      const pct = num(o.params?.level) ?? 0;
      const radius = num(o.params?.radius);
      const height = num(o.params?.height) ?? num(o.height);
      objects.push({
        id: o.id,
        object: 'tank',
        x: o.x,
        y: o.y,
        ...(o.rotation !== undefined ? { rotation: o.rotation } : {}),
        ...(height !== undefined ? { height } : {}),
        params: {
          preset,
          level: Math.min(1, Math.max(0, pct / 100)),
          ...(radius !== undefined ? { radius } : {}),
        },
      });
      continue;
    }
    if (o.object.startsWith('brewery:')) continue;
    const { extensions: _drop, ...rest } = o;
    const metric = o.object === 'label' ? boundMetrics(o).value : undefined;
    if (metric !== undefined && snapshot.has(metric)) {
      objects.push({ ...rest, params: { ...rest.params, value: snapshot.get(metric) } });
    } else {
      objects.push(rest);
    }
  }
  return { id: raw.id, name: raw.name, gridCellSize: raw.gridCellSize, objects };
}
