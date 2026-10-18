import { HOLODECK_KINDS } from '@holodeck/sdk';
import { ISO_ENGINE_ID } from '@holodeck/editor-2.5d-react';
import { withPart } from '../test-support';
import { describe, expect, it } from 'vitest';
import { usedIsoContributions } from '../documents/iso-scene';
import { createIsoDocument } from '../documents/new-document';
import { createStudioHost, documentRequires, hostDocumentProblems, requiresFor } from './studio-host';

describe('studio host', () => {
  it('registers the iso engine and installs its package through the manifest', async () => {
    const host = await createStudioHost();
    expect(host.engine(ISO_ENGINE_ID)).toBeDefined();
    expect(host.packages().map((p) => p.manifest.id)).toEqual([ISO_ENGINE_ID, 'holodeck.cloud', 'holodeck.sim', 'holodeck.http', 'holodeck.provider-aws']);
    expect(host.registry.list(HOLODECK_KINDS.provider).map((p) => p.id).sort()).toEqual(['aws.cloudwatch', 'holodeck.http', 'holodeck.sim']);
    expect(host.registry.get(HOLODECK_KINDS.isoPart, 'tank')).toBeDefined();
    expect(host.registry.ownerOf(HOLODECK_KINDS.isoPart, 'tank')).toBe(ISO_ENGINE_ID);
  });

  it('creates independent hosts', async () => {
    const a = await createStudioHost();
    const b = await createStudioHost();
    expect(a.registry).not.toBe(b.registry);
  });

  describe('hostDocumentProblems', () => {
    it('accepts a new document and one with installed parts', async () => {
      const host = await createStudioHost();
      const doc = createIsoDocument('A', 'a');
      expect(hostDocumentProblems(host, doc)).toEqual([]);
      const { scene } = withPart(doc.body, host.registry, 'tank');
      expect(hostDocumentProblems(host, { ...doc, body: scene })).toEqual([]);
    });

    it('rejects an engine the studio does not have', async () => {
      const host = await createStudioHost();
      expect(hostDocumentProblems(host, { ...createIsoDocument(), engine: 'holodeck.flow' })).toEqual([
        'engine: "holodeck.flow" is not installed in this studio',
      ]);
    });

    it('rejects missing and mismatched requires', async () => {
      const host = await createStudioHost();
      const doc = { ...createIsoDocument(), requires: { 'acme.parts': '^1.0', 'holodeck.iso': '^2.0' } };
      expect(hostDocumentProblems(host, doc)).toEqual([
        'requires: package "acme.parts" is not installed',
        'requires: "holodeck.iso" ^2.0 is needed, 1.0.0 is installed',
      ]);
    });

    it('rejects placements of parts that are not installed', async () => {
      const host = await createStudioHost();
      const doc = createIsoDocument('A', 'a');
      const body = { ...doc.body, objects: [{ id: 'x-1', object: 'acme:widget', x: 0, y: 0 }] };
      const problems = hostDocumentProblems(host, { ...doc, body });
      expect(problems.join('\n')).toContain('acme:widget');
    });
  });

  it('requiresFor maps used parts to ^MAJOR.MINOR of their package', async () => {
    const host = await createStudioHost();
    let scene = createIsoDocument().body;
    expect(requiresFor(host, usedIsoContributions(scene))).toEqual({});
    scene = withPart(scene, host.registry, 'tank').scene;
    scene = withPart(scene, host.registry, 'valve').scene;
    expect(requiresFor(host, usedIsoContributions(scene))).toEqual({ 'holodeck.iso': '^1.0' });
    expect(requiresFor(host, [[HOLODECK_KINDS.isoPart, 'not-installed']])).toEqual({});
  });

  it('documentRequires adds the packages of the connections providers (holodeck#172)', async () => {
    const host = await createStudioHost();
    const scene = withPart(createIsoDocument().body, host.registry, 'tank').scene;
    expect(documentRequires(host, scene, [{ provider: 'aws.cloudwatch' }, { provider: 'aws.cloudwatch' }, { provider: 'holodeck.sim' }, { provider: 'nope' }])).toEqual({
      'holodeck.iso': '^1.0',
      'holodeck.provider-aws': '^0.1',
      'holodeck.sim': '^1.0',
    });
    expect(documentRequires(host, createIsoDocument().body, [{ provider: 'aws.cloudwatch' }])).toEqual({ 'holodeck.provider-aws': '^0.1' });
    expect(documentRequires(host, scene)).toEqual({ 'holodeck.iso': '^1.0' });
  });
});
