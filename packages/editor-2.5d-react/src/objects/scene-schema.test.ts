/**
 * The JSON Schema (schema/holodeck-iso-scene.v1.schema.json) and the TS
 * validator (validateSceneGeometry) must agree: every fixture passes both,
 * and every bad placement below is rejected by both. Rules only the TS side
 * can check (installed parts, param specs, footprint limits, unique ids) are
 * listed separately so the difference is explicit.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { parseSceneFile, validateSceneGeometry } from '../iso/scene';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const schema = JSON.parse(readFileSync(path.join(pkgRoot, 'schema/holodeck-iso-scene.v1.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);
const registry = createIsoRegistryWithBuiltins();

const schemaOk = (scene: unknown) => validate(scene) === true;
const tsOk = (scene: unknown) => {
  try {
    validateSceneGeometry(scene, registry);
    return true;
  } catch {
    return false;
  }
};

const scene = (...objects: unknown[]) => ({ id: 's', name: 's', gridCellSize: 1, objects });
const base = { id: 'p', object: 'label', x: 0, y: 0 };

/** Every new object type, fully dressed: must pass both validators and the strict import. */
const E2_SAMPLE_SCENE = scene(
  { id: 'tank-1', object: 'tank', x: 0, y: 0, meta: { region: 'eu-west-1', nodes: 3, public: false }, opacity: 0.6, z: 2 },
  { id: 'tank-2', object: 'tank', x: 8, y: 0 },
  {
    id: 'c1',
    object: 'connector',
    x: 0,
    y: 0,
    link: { from: { object: 'tank-1', port: 'east' }, to: { object: 'tank-2' } },
    params: { color: '#c0392b', width: 0.12, dash: 'dashed', startTip: 'dot', endTip: 'arrow', label: 'HTTPS', flow: true, flowSpeed: -2, route: 'auto' },
  },
  { id: 'c2', object: 'connector', x: 0, y: 4, toX: 6, toY: 6, link: { via: [{ x: 3, y: 4 }, { x: 3, y: 6 }] } },
  { id: 'a1', object: 'area', x: 4, y: 0, width: 14, height: 6, params: { fill: '#eef', outline: '#88a', outlineStyle: 'dotted', shadow: 2, walled: true, wallHeight: 1 }, z: -1 },
  { id: 'l1', object: 'label', x: 4, y: 4, params: { text: 'VPC', bold: true, italic: true, align: 'left', outline: '#ffffff', orient: 'upright' } },
  { id: 'i1', object: 'icon', x: 2, y: 5, params: { icon: 'database', color: '#18bae6', size: 1.5, orient: 'flat' } },
  { id: 'i2', object: 'icon', x: 3, y: 5, params: { glyph: 'S3', orient: 'upright' } },
  { id: 'img', object: 'image', x: 6, y: 5, params: { src: 'data:image/svg+xml;base64,PHN2Zy8+', mode: 'billboard', width: 2, height: 1 } },
);

describe('iso scene JSON Schema', () => {
  it('compiles in strict mode', () => {
    expect(typeof validate).toBe('function');
  });

  it('accepts every committed fixture and the E2 sample scene (and so does the TS validator)', () => {
    const files = ['tests/scene.json', 'tests/fixtures/brewery/brewhouse.iso.json', 'tests/fixtures/brewery/cellar.iso.json'];
    for (const file of files) {
      const raw = JSON.parse(readFileSync(path.join(pkgRoot, file), 'utf8'));
      expect(schemaOk(raw), `${file}: ${ajv.errorsText(validate.errors)}`).toBe(true);
    }
    expect(schemaOk(E2_SAMPLE_SCENE), ajv.errorsText(validate.errors)).toBe(true);
    expect(tsOk(E2_SAMPLE_SCENE)).toBe(true);
    expect(() => parseSceneFile(E2_SAMPLE_SCENE, registry)).not.toThrow();
  });

  const bothReject: Array<[string, Record<string, unknown>]> = [
    ['x out of range', { x: 16385 }],
    ['x parsed from 1e400', { x: JSON.parse('1e400') }],
    ['toX out of range', { toX: -20000 }],
    ['width out of range', { width: 1e9 }],
    ['opacity above 1', { opacity: 1.5 }],
    ['opacity negative', { opacity: -0.1 }],
    ['opacity as string', { opacity: '0.5' }],
    ['z not an integer', { z: 0.5 }],
    ['z out of range', { z: 5000 }],
    ['at above 1', { at: 2 }],
    ['meta value object', { meta: { a: { b: 1 } } }],
    ['meta value too long', { meta: { a: 'x'.repeat(300) } }],
    ['meta key too long', { meta: { ['k'.repeat(65)]: 1 } }],
    ['meta too many rows', { meta: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, i])) }],
    ['meta array', { meta: [1, 2] }],
    ['metaHidden not boolean', { metaHidden: 'yes' }],
    ['link not an object', { link: 'tank-1' }],
    ['link unknown field', { link: { waypoints: [] } }],
    ['link end both shapes', { link: { from: { object: 'a', x: 1, y: 2 } } }],
    ['link end empty object id', { link: { from: { object: '' } } }],
    ['link end point out of range', { link: { to: { x: 0, y: 99999 } } }],
    ['link via too long', { link: { via: Array.from({ length: 65 }, () => ({ x: 0, y: 0 })) } }],
    ['link via point extra field', { link: { via: [{ x: 0, y: 0, z: 1 }] } }],
    ['params not an object', { params: [] }],
    ['params non-finite value', { params: { level: JSON.parse('1e400') } }],
    ['missing id', { id: undefined }],
  ];

  it.each(bothReject)('both reject: %s', (_name, patch) => {
    const placement: Record<string, unknown> = { ...base, ...patch };
    for (const key of Object.keys(placement)) if (placement[key] === undefined) delete placement[key];
    const s = scene(placement);
    expect(schemaOk(s), 'schema accepted').toBe(false);
    expect(tsOk(s), 'TS validator accepted').toBe(false);
  });

  // TS-only rules: they depend on the installed registry, so the schema cannot see them.
  const tsOnly: Array<[string, unknown]> = [
    ['param above the spec max', scene({ ...base, object: 'tank', params: { level: 2 } })],
    ['enum param not an option', scene({ ...base, object: 'connector', params: { dash: 'wavy' } })],
    ['colour param not hex', scene({ ...base, object: 'connector', params: { color: 'red' } })],
    ['image src with a javascript: URL', scene({ ...base, object: 'image', params: { src: 'javascript:alert(1)' } })],
    ['nested non-finite param', scene({ ...base, params: { labels: { a: JSON.parse('1e400') } } })],
    ['duplicate ids', scene(base, base)],
  ];

  it.each(tsOnly)('TS-only rule: %s (schema accepts, TS rejects)', (_name, s) => {
    expect(schemaOk(s)).toBe(true);
    expect(tsOk(s)).toBe(false);
  });
});
