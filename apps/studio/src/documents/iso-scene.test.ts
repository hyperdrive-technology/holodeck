import type { HolodeckHost } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStudioHost } from '../host/studio-host';
import { withPart } from '../test-support';
import { libraryDropPoint, LIBRARY_PLACE_GAP, usedIsoContributions } from './iso-scene';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
const empty = (): IsoSceneFile => ({ id: 's', name: 'S', gridCellSize: 1, objects: [] });

describe('iso scene helpers', () => {
  it('drops the first part at the origin, later ones right of the scene', () => {
    expect(libraryDropPoint(empty(), host.registry)).toEqual({ x: 0, y: 0 });
    const scene = withPart(empty(), host.registry, 'tank', 2, 5).scene;
    const at = libraryDropPoint(scene, host.registry);
    expect(at.x).toBeGreaterThanOrEqual(2 + LIBRARY_PLACE_GAP);
    expect(at.y).toBeLessThanOrEqual(5);
  });

  it('usedIsoContributions lists each part once', () => {
    let scene = withPart(empty(), host.registry, 'tank').scene;
    scene = withPart(scene, host.registry, 'tank').scene;
    scene = withPart(scene, host.registry, 'valve').scene;
    expect(usedIsoContributions(scene)).toEqual([
      ['holodeck.iso.part', 'tank'],
      ['holodeck.iso.part', 'valve'],
    ]);
  });
});
