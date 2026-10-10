import type { IsoMetrics, IsoPartDefinition } from './types';
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
