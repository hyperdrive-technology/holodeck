import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HolodeckHost } from '@holodeck/sdk';
import { createStudioHost } from '../host/studio-host';
import { addPart, libraryDropPoint, LIBRARY_PLACE_GAP, nextPlacementId, removePlacement, updatePlacement, usedIsoContributions } from './iso-scene';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
const empty = (): IsoSceneFile => ({ id: 's', name: 'S', gridCellSize: 1, objects: [] });

describe('iso scene edits', () => {
  it('nextPlacementId picks the first free number and sanitises namespaced ids', () => {
    expect(nextPlacementId('tank', [])).toBe('tank-1');
    expect(nextPlacementId('tank', [{ id: 'tank-1', object: 'tank', x: 0, y: 0 }, { id: 'tank-3', object: 'tank', x: 0, y: 0 }])).toBe('tank-2');
    expect(nextPlacementId('brewery:fermenter', [])).toBe('brewery-fermenter-1');
    expect(nextPlacementId(':::', [])).toBe('object-1');
  });

  it('places the first part at the origin with the part defaults', () => {
    const { scene, id } = addPart(empty(), host.registry, 'tank');
    expect(id).toBe('tank-1');
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]).toMatchObject({ id: 'tank-1', object: 'tank', x: 0, y: 0 });
  });

  it('places later parts to the right of the scene', () => {
    let scene = addPart(empty(), host.registry, 'tank').scene;
    const at = libraryDropPoint(scene, host.registry);
    expect(at.x).toBeGreaterThanOrEqual(LIBRARY_PLACE_GAP);
    scene = addPart(scene, host.registry, 'valve').scene;
    expect(scene.objects[1]).toMatchObject({ id: 'valve-1', x: at.x, y: at.y });
  });

  it('gives run-drawn parts (pipes) a two-cell run', () => {
    const { scene } = addPart(empty(), host.registry, 'pipe', { x: 4, y: 5 });
    expect(scene.objects[0]).toMatchObject({ x: 4, y: 5, toX: 6, toY: 5 });
  });

  it('deep-copies defaults so placements never share params', () => {
    let scene = addPart(empty(), host.registry, 'tank').scene;
    scene = addPart(scene, host.registry, 'tank').scene;
    const [a, b] = scene.objects;
    if (a?.params && b?.params) expect(a.params).not.toBe(b.params);
  });

  it('refuses parts that are not installed and does not mutate its input', () => {
    const scene = empty();
    expect(() => addPart(scene, host.registry, 'acme:nope')).toThrow('not installed');
    addPart(scene, host.registry, 'tank');
    expect(scene.objects).toEqual([]);
  });

  it('updatePlacement merges fields and params; unknown ids are a no-op', () => {
    let scene = addPart(empty(), host.registry, 'tank').scene;
    scene = updatePlacement(scene, 'tank-1', { params: { level: 0.5 } });
    scene = updatePlacement(scene, 'tank-1', { x: 7, params: { temp: 20 } });
    expect(scene.objects[0]).toMatchObject({ x: 7, params: expect.objectContaining({ level: 0.5, temp: 20 }) });
    expect(updatePlacement(scene, 'missing', { x: 1 })).toBe(scene);
  });

  it('removePlacement removes by id; unknown ids are a no-op', () => {
    const scene = addPart(empty(), host.registry, 'tank').scene;
    expect(removePlacement(scene, 'tank-1').objects).toEqual([]);
    expect(removePlacement(scene, 'missing')).toBe(scene);
  });

  it('usedIsoContributions lists each part once', () => {
    let scene = addPart(empty(), host.registry, 'tank').scene;
    scene = addPart(scene, host.registry, 'tank').scene;
    scene = addPart(scene, host.registry, 'valve').scene;
    expect(usedIsoContributions(scene)).toEqual([
      ['holodeck.iso.part', 'tank'],
      ['holodeck.iso.part', 'valve'],
    ]);
  });
});
