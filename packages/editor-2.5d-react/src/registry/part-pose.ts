import { pipeWorldY } from '../../assets/process/pipe-math';
import type { HolodeckStyle } from '../../assets/process/style';
import type { IsoPartDefinition } from './types';

/**
 * World Y of a GLB part's origin (`IsoPartDefinition.origin`). `'pipe-axis'`
 * parts are authored with the origin on the pipe axis and sit at
 * `pipeWorldY(pipeRadius)`, the same height the code-built valve uses, so a
 * GLB valve lines up with the pipe it is placed on. Anything else is the
 * floor (Y = 0), where floor parts are authored.
 */
export function partOriginY(def: Pick<IsoPartDefinition, 'origin'>, pipeRadius?: number): number {
  return def.origin === 'pipe-axis' ? pipeWorldY(pipeRadius) : 0;
}

/**
 * The `hd.accent` colour of one data-only placement, highest first:
 *
 * 1. the theme's alarm colour while the part's `alarmParam` is true
 *    (a faulted motor band, a cabinet beacon);
 * 2. a non-empty `color` param (a provider binding with a threshold
 *    transform, Studio's cloud sample);
 * 3. the placement's static `color`;
 * 4. the definition's `colors.accent`;
 * 5. `undefined`: the model's own accent / the theme.
 *
 * An empty `color` (the param's "no colour" default) falls through.
 */
export function partAccent(
  def: Pick<IsoPartDefinition, 'alarmParam' | 'colors'>,
  params: Readonly<Record<string, unknown>>,
  style: Pick<HolodeckStyle, 'colors'>,
  placementColor?: string,
): string | undefined {
  if (def.alarmParam && params[def.alarmParam] === true) return style.colors.alarm;
  if (typeof params.color === 'string' && params.color !== '') return params.color;
  return placementColor ?? def.colors?.accent;
}
