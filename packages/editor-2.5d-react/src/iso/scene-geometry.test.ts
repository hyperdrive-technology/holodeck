/** holodeck#8: parseSceneFile must reject non-finite / out-of-range geometry. */
import { describe, expect, it } from 'vitest';
import { MAX_GRID_COORD } from '../routing/grid';
import { buildOccupancy } from '../routing/occupancy';
import { getDefaultIsoRegistry } from '../registry/default';
import { parseSceneFile } from './scene';

const scene = (obj: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: 's',
  name: 's',
  gridCellSize: 1,
  objects: [{ id: 'o', object: 'pipe', x: 0, y: 0, ...obj }],
  ...extra,
});

describe('parseSceneFile geometry bounds', () => {
  it('the original repro: JSON 1e400 parses to Infinity and is rejected', () => {
    const raw = JSON.parse('{"id":"s","name":"s","gridCellSize":1,"objects":[{"id":"t","object":"tank","x":1e400,"y":0}]}');
    expect(raw.objects[0].x).toBe(Infinity);
    expect(() => parseSceneFile(raw)).toThrow(/placement t: x must be a finite number within \+-16384, got Infinity/);
  });

  const BAD = [Infinity, -Infinity, MAX_GRID_COORD + 1, -(MAX_GRID_COORD + 0.5), 1e300];
  for (const field of ['x', 'y', 'toX', 'toY', 'width', 'height', 'size']) {
    it.each(BAD)(`rejects ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ toX: 3, toY: 0, [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be`));
    });
  }
  for (const field of ['toX', 'toY', 'width', 'height', 'size']) {
    it.each([NaN, '3', null, true])(`rejects non-number ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be`));
    });
  }
  for (const field of ['rotation', 'nudgeX', 'nudgeY', 'screenX', 'screenY']) {
    it.each([Infinity, NaN, '1'])(`rejects ${field} = %s`, (v) => {
      expect(() => parseSceneFile(scene({ [field]: v }))).toThrow(new RegExp(`placement o: ${field} must be a finite number`));
    });
  }
  it('NaN x keeps the original message', () => {
    expect(() => parseSceneFile(scene({ x: NaN }))).toThrow(/missing numeric x,y/);
  });

  it('accepts the bounds themselves, negative and fractional values, and omitted optionals', () => {
    const ok = parseSceneFile(scene({ x: MAX_GRID_COORD, y: -MAX_GRID_COORD, toX: MAX_GRID_COORD, toY: 2.5, rotation: -Math.PI }));
    expect(ok.objects[0]).toMatchObject({ x: MAX_GRID_COORD, toY: 2.5 });
    expect(() => parseSceneFile(scene({}))).not.toThrow();
  });

  it.each([0, -1, Infinity, NaN, '1'])('rejects gridCellSize %s', (g) => {
    expect(() => parseSceneFile(scene({}, { gridCellSize: g }))).toThrow(/scene.gridCellSize must be a finite number > 0/);
  });

  it('every accepted scene builds occupancy without skipping (parse bounds imply routable runs)', () => {
    const parsed = parseSceneFile(scene({ x: -MAX_GRID_COORD, toX: MAX_GRID_COORD, toY: 0 }));
    const occ = buildOccupancy(parsed, getDefaultIsoRegistry());
    expect(occ.skipped).toEqual([]);
    expect(occ.blocked.size).toBe(2 * MAX_GRID_COORD + 1);
  });
});
