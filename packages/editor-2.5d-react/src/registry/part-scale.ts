import type { IsoPartDefinition } from './types';

/** `def.scale` if it is a finite positive number, else 1 (bad data must not make a part vanish). */
export function partScale(def: Pick<IsoPartDefinition, 'scale'>): number {
  const s = def.scale;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1;
}
