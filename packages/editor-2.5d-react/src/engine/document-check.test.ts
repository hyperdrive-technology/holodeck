import {
  DOCUMENT_CHECK_KIND,
  HOLODECK_KINDS,
  HolodeckHost,
  ContributionRegistry,
  isDocumentCheck,
  runDocumentChecks,
  type HolodeckDocument,
} from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import manifestJson from '../../holodeck.package.json';
import { isoPackage } from '../holodeck-package';
import { BUILTIN_ISO_PARTS } from '../registry/builtin';
import { ISO_PARTS_INSTALLED_CHECK, ISO_PARTS_INSTALLED_CHECK_ID } from './document-check';
import { toIsoDocument } from './document';
import { isoEngine } from './iso-engine';

const scene = (objects: unknown[]) => ({ id: 's', name: 'S', gridCellSize: 1, objects });
const at = (id: string, object: unknown) => ({ id, object, x: 0, y: 0 });
const doc = (objects: unknown[]) => toIsoDocument(scene(objects) as never) as HolodeckDocument;

/** A registry holding exactly the given part ids. */
function registryWith(...ids: string[]): ContributionRegistry {
  const registry = new ContributionRegistry();
  registry.registerKind({ kind: HOLODECK_KINDS.isoPart });
  if (ids.length) {
    const parts = ids.map((id) => ({ id, label: id, footprint: { w: 1, h: 1 }, params: {} }));
    registry.install({ id: 'test.parts', version: '1.0.0', contributions: { [HOLODECK_KINDS.isoPart]: parts } });
  }
  return registry;
}
const run = (document: HolodeckDocument, registry: ContributionRegistry) =>
  ISO_PARTS_INSTALLED_CHECK.check(document, { registry, engine: isoEngine });

describe('ISO_PARTS_INSTALLED_CHECK', () => {
  it('is a valid holodeck.document.check for holodeck.iso only', () => {
    expect(isDocumentCheck(ISO_PARTS_INSTALLED_CHECK)).toBe(true);
    expect(DOCUMENT_CHECK_KIND.validate?.(ISO_PARTS_INSTALLED_CHECK)).toBe(true);
    expect(ISO_PARTS_INSTALLED_CHECK.id).toBe(ISO_PARTS_INSTALLED_CHECK_ID);
    expect(ISO_PARTS_INSTALLED_CHECK.engines).toEqual(['holodeck.iso']);
  });

  it('passes when every placed part is installed', () => {
    expect(run(doc([at('a', 'tank'), at('b', 'valve')]), registryWith('tank', 'valve'))).toEqual([]);
  });

  it('flags each placement whose part is not installed, with its placement id', () => {
    expect(run(doc([at('a', 'tank'), at('b', 'cloud:server'), at('c', 'cloud:server')]), registryWith('tank'))).toEqual([
      {
        severity: 'error',
        code: 'UNKNOWN_PART',
        objectId: 'b',
        message: 'placement b uses part "cloud:server", which no installed package provides',
      },
      {
        severity: 'error',
        code: 'UNKNOWN_PART',
        objectId: 'c',
        message: 'placement c uses part "cloud:server", which no installed package provides',
      },
    ]);
  });

  it('leaves malformed bodies and placements to validateBody (no duplicate reports, never throws)', () => {
    const registry = registryWith();
    for (const body of [undefined, null, 42, 'x', {}, { objects: 'x' }, { objects: [null, 7, 'p'] }]) {
      expect(run({ ...doc([]), body } as HolodeckDocument, registry)).toEqual([]);
    }
    // No string id / object, or an empty object id: structural problems, reported by validateBody.
    expect(run(doc([{ object: 'x', x: 0, y: 0 }, at('a', 42), at('b', ''), at('', 'ghost')]), registry)).toEqual([]);
  });

  it('runs through runDocumentChecks only for holodeck.iso documents', async () => {
    const registry = new HolodeckHost({ name: 't' }).registry;
    registry.install({ id: 'checks', version: '1.0.0', contributions: { [HOLODECK_KINDS.documentCheck]: [ISO_PARTS_INSTALLED_CHECK] } });
    const other = { ...doc([at('a', 'ghost')]), engine: 'holodeck.flow' } as HolodeckDocument;
    expect(await runDocumentChecks(registry, other)).toEqual([]);
  });
});

describe('the holodeck.iso package contributes the check (holodeck#61)', () => {
  async function host() {
    const h = new HolodeckHost({ name: 'test' });
    h.registerEngine(isoEngine); // the shared descriptor: structure + bindings only
    await h.installPackage(manifestJson, isoPackage);
    return h;
  }

  it('host.checkDocument flags parts no installed package provides', async () => {
    const h = await host();
    expect(await h.checkDocument(doc([at('t1', 'tank'), at('s1', 'cloud:server')]))).toEqual([
      {
        check: ISO_PARTS_INSTALLED_CHECK_ID,
        severity: 'error',
        code: 'UNKNOWN_PART',
        objectId: 's1',
        message: 'placement s1 uses part "cloud:server", which no installed package provides',
      },
    ]);
  });

  it('the diagnostic clears once a package provides the part, and returns when it is uninstalled', async () => {
    const h = await host();
    const document = doc([at('s1', 'cloud:server')]);
    const server = { ...BUILTIN_ISO_PARTS.find((p) => p.id === 'tank')!, id: 'cloud:server', label: 'Server' };
    h.registry.install({ id: 'test.cloud', version: '1.0.0', contributions: { [HOLODECK_KINDS.isoPart]: [server] } });
    expect(await h.checkDocument(document)).toEqual([]);
    h.registry.uninstall('test.cloud');
    expect((await h.checkDocument(document)).map((d) => d.code)).toEqual(['UNKNOWN_PART']);
  });

  it('reports an uninstalled part next to an unrelated body problem (missing x,y)', async () => {
    const h = await host();
    const out = await h.checkDocument(doc([{ id: 'g', object: 'ghost' }]));
    expect(out.map((d) => d.code)).toEqual(['INVALID_BODY', 'UNKNOWN_PART']);
  });
});
