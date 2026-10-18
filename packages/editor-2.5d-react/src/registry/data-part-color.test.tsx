import { Group } from 'three';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HOLODECK_STYLE } from '../../assets/process/style';
import { DataPart } from './DataPart';
import { resolveParams } from './params';
import type { IsoPartDefinition } from './types';

const model = vi.hoisted(() => vi.fn(() => null));
vi.mock('../anim/HolodeckModel', () => ({ HolodeckModel: model }));
vi.mock('../../assets/process/HolodeckModel', () => ({ useTrackedGLTF: () => ({ scene: new Group() }) }));

describe('data-only model colour bindings', () => {
  it('passes resolved live colours to the model, with placement and package fallbacks', () => {
    const def: IsoPartDefinition = {
      id: 'cloud:server', label: 'Server', footprint: { w: 2, h: 2 }, params: {},
      model: '/server.glb', colors: { accent: '#123456' },
    };
    const placement = { id: 'web', object: def.id, x: 0, y: 0, color: '#abcdef' };
    const draw = (metrics?: Parameters<typeof resolveParams>[2]) => {
      model.mockClear();
      renderToStaticMarkup(<DataPart placement={placement} params={resolveParams(def, placement, metrics)} style={HOLODECK_STYLE} def={def} selected={false} />);
      return (model.mock.calls as unknown as Array<[{ accent: string }]>)[0]?.[0].accent;
    };
    expect(draw()).toBe('#abcdef');
    expect(draw({ web: { color: '#22c55e' } })).toBe('#22c55e');
    expect(draw({ web: { color: '#ef4444' } })).toBe('#ef4444');
    delete (placement as { color?: string }).color;
    expect(draw()).toBe('#123456');
  });

  it("an empty colour param (a valid 'no colour' default) doesn't override placement or package colours", () => {
    const def: IsoPartDefinition = {
      id: 'cloud:server', label: 'Server', footprint: { w: 2, h: 2 },
      params: { color: { type: 'color', label: 'Colour', default: '' } },
      model: '/server.glb', colors: { accent: '#123456' },
    };
    const placement = { id: 'web', object: def.id, x: 0, y: 0, color: '#abcdef' };
    const draw = () => {
      model.mockClear();
      renderToStaticMarkup(<DataPart placement={placement} params={resolveParams(def, placement)} style={HOLODECK_STYLE} def={def} selected={false} />);
      return (model.mock.calls as unknown as Array<[{ accent: string }]>)[0]?.[0].accent;
    };
    expect(draw()).toBe('#abcdef');
    delete (placement as { color?: string }).color;
    expect(draw()).toBe('#123456');
  });
});
