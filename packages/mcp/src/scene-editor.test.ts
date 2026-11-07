import { describe, expect, it } from 'vitest';
import { resolveRouteEnd, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { ToolError } from './errors';
import { PROTECTED_FIELDS, SceneEditor } from './scene-editor';
import { testHost } from './test-support';

const scene = (objects: IsoSceneFile['objects'] = [], extra: Partial<IsoSceneFile> = {}): IsoSceneFile => ({ id: 's', name: 'S', gridCellSize: 1, objects, ...extra });
const editor = async (objects: IsoSceneFile['objects'] = [], extra: Partial<IsoSceneFile> = {}) => new SceneEditor(scene(objects, extra), (await testHost()).registry);

const refused = (fn: () => unknown): ToolError => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    return error as ToolError;
  }
  throw new Error('expected a refusal');
};

describe('SceneEditor', () => {
  it('starts unchanged and only reports changed after a commit', async () => {
    const ed = await editor();
    expect(ed.changed).toBe(false);
    ed.add('tank', { x: 0, y: 0 });
    expect(ed.changed).toBe(true);
  });

  it('portCell agrees with the editor port snap at every rotation', async () => {
    for (const quarter of [0, 1, 2, 3, -1]) {
      const ed = await editor([{ id: 't', object: 'tank', x: 4, y: 4, rotation: quarter * (Math.PI / 2) }]);
      for (const port of ['east', 'west']) {
        const cell = ed.portCell({ id: 't', port });
        const snapped = resolveRouteEnd(ed.scene, ed.registry, cell);
        expect(snapped, `rotation ${quarter}, ${port}`).toMatchObject({ partId: 't', port, cell });
      }
    }
  });

  it('a value the reducer rejects aborts the call with its notice', async () => {
    const ed = await editor([{ id: 't', object: 'tank', x: 0, y: 0 }]);
    const error = refused(() => ed.setParams('t', { level: 7 }));
    expect(error.code).toBe('invalid_edit');
    expect(error.problems[0]).toMatch(/^Edit rejected: .*level/);
    expect(ed.scene.objects[0]!.params).toBeUndefined();
  });

  it('objects on a locked layer cannot be edited, moved or removed', async () => {
    const ed = await editor([{ id: 't', object: 'tank', x: 0, y: 0, layer: 'locked' } as never], { layers: [{ id: 'locked', name: 'Locked', locked: true }] } as never);
    expect(refused(() => ed.setParams('t', { level: 0.5 })).code).toBe('locked');
    expect(refused(() => ed.move('t', { x: 5, y: 5 })).code).toBe('locked');
    expect(refused(() => ed.remove(['t'])).code).toBe('locked');
  });

  it('unknown objects suggest near ids', async () => {
    const ed = await editor([{ id: 'feed-tank', object: 'tank', x: 0, y: 0 }]);
    const error = refused(() => ed.object('feed'));
    expect(error.code).toBe('not_found');
    expect(error.problems.join()).toContain('feed-tank');
  });

  it('setFields refuses every protected field', async () => {
    const ed = await editor([{ id: 't', object: 'tank', x: 0, y: 0 }]);
    for (const field of PROTECTED_FIELDS) expect(() => ed.setFields('t', { [field]: 1 }), field).toThrow(ToolError);
  });

  it('bind refuses a param the part does not have', async () => {
    const ed = await editor([{ id: 't', object: 'tank', x: 0, y: 0 }]);
    expect(refused(() => ed.bind('t', 'rpm', { connection: 'sim', source: 'sine:1' })).problems.join()).toContain('level');
  });

  it('move of a vessel drags an attached pipe along', async () => {
    const ed = await editor();
    ed.add('tank', { x: 0, y: 0 });
    ed.connect({ id: 'tank-1', port: 'east' }, { x: 6, y: 0 });
    ed.move('tank-1', { x: 0, y: -3 });
    const pipe = ed.scene.objects.find((o) => o.object === 'pipe' && (o as { attach?: { from?: { object: string } } }).attach?.from?.object === 'tank-1');
    expect(pipe).toMatchObject({ x: 1, y: -3 });
  });

  it('rotate takes the short way round', async () => {
    const ed = await editor([{ id: 't', object: 'tank', x: 0, y: 0 }]);
    ed.rotate('t', 270);
    expect(ed.scene.objects[0]!.rotation).toBeCloseTo(-Math.PI / 2);
    expect(ed.state.revision).toBe(1);
    ed.rotate('t', 180);
    expect(ed.scene.objects[0]!.rotation).toBeCloseTo(-Math.PI);
    expect(() => ed.rotate('t', 30)).toThrow(ToolError);
  });
});
