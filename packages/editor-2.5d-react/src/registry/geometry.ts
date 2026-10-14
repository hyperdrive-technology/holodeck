import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from './types';

/** Installed definitions own geometry; endpoints only identify runs for missing parts. */
export function isRunPlacement(
  placement: Pick<IsoPlacement, 'toX' | 'toY'>,
  def: Pick<IsoPartDefinition, 'draw'> | undefined,
): boolean {
  return def ? def.draw === 'run' : typeof placement.toX === 'number' && typeof placement.toY === 'number';
}
