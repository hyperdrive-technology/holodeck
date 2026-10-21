import type { IsoPlacement } from '../iso/scene';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { createIsoRegistryWithBuiltins, getDefaultIsoRegistry } from '../registry/default';
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

/** A 1x1 part whose east and west ports both sit at its centre (holodeck#47). */
export function coincidentPortRegistry(order: ReadonlyArray<'east' | 'west'>) {
  const reg = createIsoRegistryWithBuiltins();
  const all = { east: { x: 0, y: 0, dir: 'e' as const }, west: { x: 0, y: 0, dir: 'w' as const } };
  reg.install({ id: `test.coincident-${order.join('-')}`, version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [{
    id: 'test:coincident', label: 'Coincident', footprint: { w: 1, h: 1 },
    ports: Object.fromEntries(order.map((name) => [name, all[name]])),
    params: {}, component: () => null,
  } as Record<string, unknown> & { id: string }] } });
  return reg;
}
