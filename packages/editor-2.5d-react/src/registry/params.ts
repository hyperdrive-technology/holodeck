import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoMetrics, IsoPartDefinition, IsoPartPort } from './types';
import type { IsoPlacement } from '../iso/scene';

/**
 * Effective param values for one placement. Precedence, highest first:
 * live `metrics[placement.id]`, static `placement.params`, the part's spec
 * default. `undefined` falls through to the next layer; `null` is a value
 * (a host can use it to say "no reading").
 *
 * Keys that are not in `def.params` pass through too, so a host can drive an
 * `animNodes` param the part did not bother to declare.
 */
export function resolveParams(
  def: Pick<IsoPartDefinition, 'params'>,
  placement: Pick<IsoPlacement, 'id' | 'params'>,
  metrics?: IsoMetrics,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(def.params)) {
    out[name] = spec.default;
  }
  for (const layer of [placement.params, metrics?.[placement.id]]) {
    if (!layer) continue;
    for (const [name, value] of Object.entries(layer)) {
      if (value !== undefined) out[name] = value;
    }
  }
  return out;
}

/**
 * Footprint of one placement: `def.footprintOf(placement)` when the part
 * sizes itself from a param, else the static `def.footprint`. Unknown parts
 * are 1x1. Rotation is not applied (see `rotatedFootprint` in routing).
 */
export function placementFootprint(
  registry: ContributionRegistry,
  placement: IsoPlacement,
): { w: number; h: number } {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, placement.object);
  if (!def) return { w: 1, h: 1 };
  return def.footprintOf?.(placement) ?? def.footprint;
}

/** Clamp + snap a dragged value to a number param's spec (`min`, `max`, `step`). */
export function snapParamValue(
  spec: Pick<import('./types').IsoPartParamSpec, 'min' | 'max' | 'step'> | undefined,
  value: number,
): number {
  let v = value;
  if (spec?.step && spec.step > 0) {
    v = Math.round(v / spec.step) * spec.step;
    // Avoid 0.30000000000000004 in the scene file.
    const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(spec.step))));
    v = Number(v.toFixed(decimals));
  }
  if (spec?.min !== undefined) v = Math.max(spec.min, v);
  if (spec?.max !== undefined) v = Math.min(spec.max, v);
  return v;
}

/**
 * Ports of one placement: `def.portsOf(placement)` when the part sizes them
 * from a param, else the static `def.ports`. Every consumer (routing ends,
 * attach, connect, port snap, replan, connectors) goes through this.
 */
export function placementPorts(
  def: Pick<IsoPartDefinition, 'ports' | 'portsOf'> | undefined,
  placement: IsoPlacement,
): Record<string, IsoPartPort> {
  return def?.portsOf?.(placement) ?? def?.ports ?? {};
}
