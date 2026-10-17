/**
 * The E2 object model wired into the engine: data-only part definitions,
 * scene validation of the new placement fields, bounds / fit extents, pool
 * partitioning and floor annotations in routing.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { ParamControl } from '../editor/InspectorPanel';
import { sceneWorldBox } from '../editor/fit';
import { partitionByPart } from '../iso/partition-scene';
import { parseSceneFile, sceneBounds, type IsoPlacement } from '../iso/scene';
import { isIsoPartDefinition, isParamSpec } from '../registry/kinds';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import type { IsoPartDefinition } from '../registry/types';
import { buildOccupancy, isFloorPart, NON_OBSTACLE_PARTS } from '../routing/occupancy';
import { findRun, isInlinePart } from '../routing/run';

const scene = (...objects: unknown[]) => ({ id: 's', name: 's', gridCellSize: 1, objects });

describe('data-only part definitions', () => {
  const base = { id: 'aws:lambda', label: 'Lambda', footprint: { w: 1, h: 1 }, params: {} };

  it('need no component: model / logo / colours alone are a valid part', () => {
    expect(isIsoPartDefinition(base)).toBe(true);
    expect(
      isIsoPartDefinition({
        ...base,
        model: '/models/function.glb',
        logo: { url: 'data:image/svg+xml;base64,PHN2Zy8+', size: 0.8 },
        colors: { body: '#ffffff', accent: '#ff9900', edge: '#333' },
        blockHeight: 0.5,
        floor: false,
      }),
    ).toBe(true);
  });

  it.each([
    ['component not a component', { component: 'GlbPart' }],
    ['logo without url', { logo: {} }],
    ['logo with a javascript: url', { logo: { url: 'javascript:alert(1)' } }],
    ['logo size non-finite', { logo: { url: '/a.svg', size: Infinity } }],
    ['logo size zero', { logo: { url: '/a.svg', size: 0 } }],
    ['logo size huge', { logo: { url: '/a.svg', size: 1000 } }],
    ['colour not hex', { colors: { body: 'white' } }],
    ['unknown colour slot', { colors: { stripe: '#fff' } }],
    ['blockHeight negative', { blockHeight: -1 }],
    ['floor not boolean', { floor: 'yes' }],
    ['extent not a function', { extent: { minX: 0 } }],
  ])('rejects %s', (_name, patch) => {
    expect(isIsoPartDefinition({ ...base, ...patch })).toBe(false);
  });

  it('a data-only part installs and can be placed from a scene file', () => {
    const registry = createIsoRegistryWithBuiltins();
    registry.install({ id: 'aws', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [base] } });
    expect(registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, 'aws:lambda')?.component).toBeUndefined();
    expect(() => parseSceneFile(scene({ id: 'l', object: 'aws:lambda', x: 0, y: 0 }), registry)).not.toThrow();
  });
});

describe('param specs', () => {
  it('accept the color type, url format and maxLength; defaults must satisfy their own spec', () => {
    expect(isParamSpec({ type: 'color', label: 'c', default: '' })).toBe(true);
    expect(isParamSpec({ type: 'color', label: 'c', default: '#abc' })).toBe(true);
    expect(isParamSpec({ type: 'color', label: 'c', default: 'red' })).toBe(false);
    expect(isParamSpec({ type: 'number', label: 'n', default: 5, min: 0, max: 1 })).toBe(false);
    expect(isParamSpec({ type: 'number', label: 'n', default: 0, min: 2, max: 1 })).toBe(false);
    expect(isParamSpec({ type: 'number', label: 'n', default: 0, min: NaN })).toBe(false);
    expect(isParamSpec({ type: 'enum', label: 'e', default: 'z', options: ['a'] })).toBe(false);
    expect(isParamSpec({ type: 'enum', label: 'e', default: 'a', options: ['a', 3] })).toBe(false);
    expect(isParamSpec({ type: 'string', label: 's', default: '', format: 'url' })).toBe(true);
    expect(isParamSpec({ type: 'number', label: 'v', default: undefined, reading: true })).toBe(true);
    expect(isParamSpec({ type: 'string', label: 'v', default: '', reading: true })).toBe(false);
    expect(isParamSpec({ type: 'number', label: 'v', default: 0, reading: 'yes' })).toBe(false);
  });

  it('every built-in part passes the registry validator (incl. the new params)', () => {
    const registry = createIsoRegistryWithBuiltins();
    for (const def of registry.list<IsoPartDefinition>(HOLODECK_KINDS.isoPart)) {
      expect(isIsoPartDefinition(def), def.id).toBe(true);
    }
  });

  it('the inspector renders a colour control with a "theme" reset', () => {
    const spec = { type: 'color', label: 'Fill', default: '' } as const;
    const unset = renderToStaticMarkup(<ParamControl name="fill" spec={spec} value="" onChange={() => {}} />);
    expect(unset).toContain('type="color"');
    expect(unset).toContain('theme');
    expect(unset).not.toContain('<button');
    const set = renderToStaticMarkup(<ParamControl name="fill" spec={spec} value="#c0392b" onChange={() => {}} />);
    expect(set).toContain('value="#c0392b"');
    expect(set).toContain('<button');
  });
});

describe('scene validation of the new placement fields', () => {
  const registry = createIsoRegistryWithBuiltins();
  const parse = (o: Record<string, unknown>) => parseSceneFile(scene({ id: 'p', x: 0, y: 0, object: 'tank', ...o }), registry);

  it('accepts opacity, z, meta, metaHidden and link', () => {
    expect(() => parse({ opacity: 0.5, z: -3, meta: { a: 1 }, metaHidden: true })).not.toThrow();
    expect(() => parse({ object: 'connector', link: { from: { x: 1, y: 1 }, to: { object: 'p2', port: 'east' } } })).not.toThrow();
  });

  it.each([
    [{ opacity: 2 }, /opacity/],
    [{ z: 1.5 }, /z must be an integer/],
    [{ meta: { a: Infinity } }, /meta\.a/],
    [{ metaHidden: 1 }, /metaHidden/],
    [{ object: 'connector', link: { to: { x: Infinity, y: 0 } } }, /link\.to/],
    [{ params: { level: 1.5 } }, /params\.level must be <= 1/],
    [{ params: { alarm: 'yes' } }, /params\.alarm must be a boolean/],
    [{ object: 'area', params: { shadow: 9 } }, /params\.shadow must be <= 3/],
    [{ object: 'area', params: { outlineStyle: 'wavy' } }, /params\.outlineStyle/],
    [{ object: 'label', params: { outline: 'red' } }, /params\.outline must be a hex colour/],
    [{ object: 'label', params: { align: 'justify' } }, /params\.align/],
    [{ object: 'icon', params: { glyph: 'far-too-long-glyph' } }, /params\.glyph must be at most 8/],
    [{ object: 'icon', params: { icon: 'unicorn' } }, /params\.icon/],
    [{ object: 'image', params: { src: 'file:///etc/passwd' } }, /params\.src scheme/],
    [{ object: 'image', params: { width: 0 } }, /params\.width must be >= 0\.1/],
    [{ object: 'connector', params: { width: Infinity } }, /params\.width must be a finite number/],
    [{ object: 'connector', params: { flowSpeed: 100 } }, /params\.flowSpeed must be <= 20/],
  ])('rejects %j', (patch, message) => {
    expect(() => parse(patch)).toThrow(message);
  });

  it('missing parts skip param validation (nothing to check against) but still check opacity/meta/link', () => {
    expect(() => parse({ object: 'uninstalled:thing', params: { level: 99 } })).toThrow(/unknown library object/);
    const geometryOnly = createIsoRegistryWithBuiltins();
    expect(() =>
      parseSceneFile(scene({ id: 'p', x: 0, y: 0, object: 'tank', opacity: 3 }), geometryOnly),
    ).toThrow(/opacity/);
  });
});

describe('extents: sceneBounds and fit include connector ends and image sizes', () => {
  const registry = createIsoRegistryWithBuiltins();
  const get = (id: string) => registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id);

  it('connector far end and waypoints count', () => {
    const objects: IsoPlacement[] = [{ id: 'c', object: 'connector', x: 0, y: 0, toX: 10, toY: 4, link: { via: [{ x: -3, y: 2 }] } }];
    expect(sceneBounds(objects, registry)).toEqual({ minX: -3, minY: 0, maxX: 10, maxY: 4 });
    const box = sceneWorldBox({ objects }, get);
    expect(box.max[0]).toBeGreaterThanOrEqual(10.5);
    expect(box.min[0]).toBeLessThanOrEqual(-2.5);
  });

  it('image width / height count', () => {
    const objects: IsoPlacement[] = [{ id: 'i', object: 'image', x: 0, y: 0, params: { width: 8, height: 2 } }];
    expect(sceneBounds(objects, registry)).toEqual({ minX: -4, minY: -1, maxX: 4, maxY: 1 });
  });
});

describe('pooling and routing', () => {
  const registry = createIsoRegistryWithBuiltins();

  it('faded, z-ordered or metadata-carrying placements of pooled parts render as unique meshes', () => {
    const objects: IsoPlacement[] = [
      { id: 'v1', object: 'valve', x: 0, y: 0 },
      { id: 'v2', object: 'valve', x: 1, y: 0, opacity: 0.5 },
      { id: 'v3', object: 'valve', x: 2, y: 0, z: 1 },
      { id: 'v4', object: 'valve', x: 3, y: 0, opacity: 1, z: 0 },
    ];
    objects.push(
      { id: 'v5', object: 'valve', x: 4, y: 0, meta: { tag: 'XV-101' } },
      { id: 'v6', object: 'valve', x: 5, y: 0, meta: { tag: 'XV-102' }, metaHidden: true },
      { id: 'v7', object: 'valve', x: 6, y: 0, meta: {} },
    );
    const { pools, unique } = partitionByPart(objects, registry);
    // holodeck#95: a visible metadata plane is drawn by SceneObjectView only, so that placement is unique too.
    expect(pools.get('valve')!.map((o) => o.id)).toEqual(['v1', 'v4', 'v6', 'v7']);
    expect(unique.map((o) => o.id)).toEqual(['v2', 'v3', 'v5']);
  });

  it('connectors, icons and images are floor annotations: never obstacles, never run ends', () => {
    for (const id of ['connector', 'icon', 'image']) expect(NON_OBSTACLE_PARTS.has(id)).toBe(true);
    const objects: IsoPlacement[] = [
      { id: 'c', object: 'connector', x: 0, y: 0, toX: 4, toY: 0 },
      { id: 'i', object: 'icon', x: 2, y: 2 },
      { id: 'm', object: 'image', x: 3, y: 3 },
    ];
    const occ = buildOccupancy({ objects }, registry);
    expect(occ.blocked.size).toBe(0);
    for (const o of objects) expect(isInlinePart(o, registry)).toBe(false);
  });

  it('a pack part opts in with floor: true', () => {
    const r = createIsoRegistryWithBuiltins();
    const sticker: IsoPartDefinition = { id: 'pack:sticker', label: 'Sticker', footprint: { w: 2, h: 2 }, params: {}, floor: true };
    r.install({ id: 'pack', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [sticker] } });
    expect(isFloorPart('pack:sticker', sticker)).toBe(true);
    const objects: IsoPlacement[] = [
      { id: 's', object: 'pack:sticker', x: 2, y: 0 },
      { id: 'p1', object: 'pipe', x: 0, y: 0, toX: 2, toY: 0 },
      { id: 'p2', object: 'pipe', x: 2, y: 0, toX: 4, toY: 0 },
    ];
    expect(buildOccupancy({ objects: [objects[0]!] }, r).blocked.size).toBe(0);
    // A floor sticker on a pipe joint does not split the run.
    expect(findRun(objects, 'p1', r)?.ids.sort()).toEqual(['p1', 'p2']);
  });
});
