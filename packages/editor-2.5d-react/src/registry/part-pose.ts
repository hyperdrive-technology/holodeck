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
export function partOriginY(
  def: Pick<IsoPartDefinition, 'origin' | 'heightParam'>,
  pipeRadius?: number,
  params: Readonly<Record<string, unknown>> = {},
): number {
  const base = def.origin === 'pipe-axis' ? pipeWorldY(pipeRadius) : 0;
  // `heightParam`: a per-placement lift (mounted instruments). Non-finite values are ignored.
  const lift = def.heightParam ? params[def.heightParam] : undefined;
  return base + (typeof lift === 'number' && Number.isFinite(lift) ? lift : 0);
}

/**
 * The state-driven accent alone (rules 1 and 1b of `partAccent`): the theme
 * alarm colour while `alarmParam` is true, else the first true
 * `stateColors` entry, else `undefined`. Only a real `true` counts.
 */
export function stateAccent(
  def: Pick<IsoPartDefinition, 'alarmParam' | 'stateColors'>,
  params: Readonly<Record<string, unknown>>,
  style: Pick<HolodeckStyle, 'colors'>,
): string | undefined {
  if (def.alarmParam && params[def.alarmParam] === true) return style.colors.alarm;
  for (const state of def.stateColors ?? []) if (params[state.param] === true) return state.color;
  return undefined;
}

/**
 * The `hd.accent` colour of one data-only placement, highest first:
 *
 * 1. the theme's alarm colour while the part's `alarmParam` is true
 *    (a faulted motor band, a cabinet beacon);
 * 1b. the colour of the first `stateColors` entry whose param is true
 *    (an energised solenoid coil, a running drive);
 * 2. a non-empty `color` param (a provider binding with a threshold
 *    transform, Studio's cloud sample);
 * 3. the placement's static `color`;
 * 4. the definition's `colors.accent`;
 * 5. `undefined`: the model's own accent / the theme.
 *
 * An empty `color` (the param's "no colour" default) falls through.
 */
export function partAccent(
  def: Pick<IsoPartDefinition, 'alarmParam' | 'stateColors' | 'colors'>,
  params: Readonly<Record<string, unknown>>,
  style: Pick<HolodeckStyle, 'colors'>,
  placementColor?: string,
): string | undefined {
  const state = stateAccent(def, params, style);
  if (state !== undefined) return state;
  if (typeof params.color === 'string' && params.color !== '') return params.color;
  return placementColor ?? def.colors?.accent;
}
