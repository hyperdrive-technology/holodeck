import type { IsoPlacement } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import { buildOccupancy } from './occupancy';

export const registry = getDefaultIsoRegistry();

export const tank = (id: string, x: number, y: number, rotation?: number): IsoPlacement => ({
  id,
  object: 'tank',
  x,
  y,
  ...(rotation === undefined ? {} : { rotation }),
});

export const pipe = (id: string, x: number, y: number, toX: number, toY: number): IsoPlacement => ({
  id,
  object: 'pipe',
  x,
  y,
  toX,
  toY,
});

export const occOf = (objects: IsoPlacement[], opts?: Parameters<typeof buildOccupancy>[2]) =>
  buildOccupancy({ objects }, registry, opts);

/** `Array.prototype.at(-n)` without needing lib es2022. */
export function last<T>(items: readonly T[], fromEnd = 1): T {
  return items[items.length - fromEnd]!;
}
