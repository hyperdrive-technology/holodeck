import { CREDENTIAL_CASES, withPart } from '../test-support';
import { HOLODECK_DOCUMENT_FORMAT, type HolodeckHost } from '@holodeck/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { createStudioHost } from '../host/studio-host';
import { COMPONENTS_FILE_SUFFIX, documentFileStem, exportFileName, imageFileName, MAX_IMPORT_BYTES, parseDocumentText, serializeDocument } from './io';
import { createIsoDocument } from './new-document';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});

function problemsOf(text: string): string[] {
  const result = parseDocumentText(text, host);
  if (result.ok) throw new Error('expected a failed import');
  return result.problems;
}

describe('import / export', () => {
  it('round-trips an exported document', () => {
    const doc = createIsoDocument('Plant', 'p1');
    const withTank = { ...doc, body: withPart(doc.body, host.registry, 'tank').scene };
    const text = serializeDocument(withTank);
    expect(text.endsWith('\n')).toBe(true);
    const result = parseDocumentText(text, host);
    expect(result.ok && result.document).toMatchObject({ id: 'p1', name: 'Plant', format: HOLODECK_DOCUMENT_FORMAT });
    expect(result.ok && result.wrapped).toBe(false);
  });

  it('wraps a bare legacy IsoSceneFile in an envelope', () => {
    const text = JSON.stringify({ id: 'legacy', name: 'Legacy', gridCellSize: 1, objects: [{ id: 't', object: 'tank', x: 0, y: 0 }] });
    const result = parseDocumentText(text, host);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wrapped).toBe(true);
    expect(result.document).toMatchObject({ format: HOLODECK_DOCUMENT_FORMAT, id: 'legacy', engine: 'holodeck.iso' });
  });

  // GPT review of holodeck#102, finding 5 (holodeck#109): the raw envelope was
  // stored, not the loader's normalised form, so an envelope-only theme never
  // reached the body the canvas renders.
  it('stores the loader-normalised document: envelope theme in the body, body.id = envelope id', () => {
    const doc = createIsoDocument('Dark', 'env-id');
    const raw = { ...doc, theme: 'holodeck.dark', body: { ...doc.body, id: 'stale-body-id' } };
    const result = parseDocumentText(JSON.stringify(raw), host);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.theme).toBe('holodeck.dark');
    expect(result.document.body).toMatchObject({ theme: 'holodeck.dark', id: 'env-id' });
  });

  // Finding 4: an unparsable timestamp passed validation and crashed the inspector.
  it.each([{ created: 'c' }, { updated: '' }, { created: 42 }])('rejects unparsable metadata timestamps %j', (metadata) => {
    const doc = { ...createIsoDocument('A', 'a'), metadata };
    expect(problemsOf(JSON.stringify(doc)).join('\n')).toMatch(/metadata\.(created|updated)/);
  });

  it('accepts valid metadata timestamps', () => {
    const doc = { ...createIsoDocument('A', 'a'), metadata: { created: '2026-10-17T00:00:00.000Z', updated: '2026-10-17' } };
    expect(parseDocumentText(JSON.stringify(doc), host).ok).toBe(true);
  });

  // holodeck#101: secrets never travel in documents.
  it('refuses a connection config that carries a provider secret', () => {
    const doc = {
      ...createIsoDocument('A', 'a'),
      connections: [{ id: 'api', provider: 'holodeck.http', config: { url: 'http://localhost:1/x', token: 'leak' } }],
    };
    expect(problemsOf(JSON.stringify(doc)).join('\n')).toMatch(/connections\.api\.config: .*token/);
  });

  it('accepts connections without credentials, also for providers it does not have', () => {
    const doc = {
      ...createIsoDocument('A', 'a'),
      connections: [
        { id: 'sim', provider: 'holodeck.sim' },
        { id: 'aws', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', credentials: { type: 'static' } } },
        { id: 'other', provider: 'acme.custom', config: { endpoint: 'https://x.test/feed' } },
      ],
    };
    expect(parseDocumentText(JSON.stringify(doc), host).ok).toBe(true);
  });

  // holodeck#163 review (P1): every credential case is refused on import, for HTTP, AWS and unknown providers.
  it.each(CREDENTIAL_CASES.map((c) => [c.name, c] as const))('import refuses %s', (_name, c) => {
    const doc = { ...createIsoDocument('A', 'a'), connections: [{ id: 'c', provider: c.provider, config: c.config }] };
    const problems = problemsOf(JSON.stringify(doc));
    expect(problems.join('\n')).toContain('connections.c.config');
    expect(problems.join('\n')).not.toContain('SECRET');
  });

  // holodeck#167 / #170: binding sources and connection labels are free text and are scanned too.
  it('refuses credentials in a binding source or a connection label', () => {
    const doc = createIsoDocument('A', 'a');
    const body = { ...doc.body, objects: [{ id: 't', object: 'tank', x: 0, y: 0, bindings: { level: { connection: 'api', source: '/v1?token=SECRET#/level' } } }] };
    const withSource = { ...doc, body, connections: [{ id: 'api', provider: 'holodeck.http', config: { url: 'https://x.test/a' } }] };
    expect(problemsOf(JSON.stringify(withSource)).join('\n')).toContain('t.level');
    const withLabel = { ...doc, connections: [{ id: 'api', provider: 'holodeck.sim', label: 'https://admin:SECRET@x.test' }] };
    const problems = problemsOf(JSON.stringify(withLabel)).join('\n');
    expect(problems).toContain('connections.api.label');
    expect(problems).not.toContain('SECRET');
  });

  it('reports invalid JSON', () => {
    expect(problemsOf('{ nope')[0]).toMatch(/^not valid JSON/);
  });

  it.each(['[]', 'null', '42', '"str"'])('rejects non-object JSON %s', (text) => {
    expect(problemsOf(text)).toEqual(['document: must be a JSON object']);
  });

  it('lists every envelope problem at once', () => {
    const problems = problemsOf(JSON.stringify({ format: 'holodeck.document.v0', id: '', engine: 'Not Valid!', body: {} }));
    expect(problems).toEqual(
      expect.arrayContaining([expect.stringContaining('format'), expect.stringContaining('id'), expect.stringContaining('engine')]),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('treats a file with any envelope field as an envelope', () => {
    const problems = problemsOf(JSON.stringify({ engine: 'holodeck.iso', objects: [] }));
    expect(problems.join('\n')).toContain('format');
  });

  it('rejects an engine the studio does not have', () => {
    const doc = { ...createIsoDocument(), engine: 'holodeck.flow', body: { nodes: [] } };
    expect(problemsOf(JSON.stringify(doc))).toEqual(['engine: "holodeck.flow" is not installed in this studio']);
  });

  it('rejects a body with uninstalled parts', () => {
    const doc = createIsoDocument('A', 'a');
    const body = { ...doc.body, objects: [{ id: 'w', object: 'acme:widget', x: 0, y: 0 }] };
    expect(problemsOf(JSON.stringify({ ...doc, body })).join('\n')).toContain('acme:widget');
  });

  it('rejects bindings to connections the document lacks', () => {
    const doc = createIsoDocument('A', 'a');
    const body = {
      ...doc.body,
      objects: [{ id: 't', object: 'tank', x: 0, y: 0, bindings: { level: { connection: 'plant', source: 'x' } } }],
    };
    expect(problemsOf(JSON.stringify({ ...doc, body })).join('\n')).toContain('plant');
  });

  it('refuses oversized files before parsing', () => {
    expect(problemsOf(' '.repeat(MAX_IMPORT_BYTES + 1))[0]).toContain('larger than');
  });

  it.each([
    [{ name: 'My Plant #2', id: 'x' }, 'my-plant-2.holodeck.json'],
    [{ name: 'Café Brü', id: 'x' }, 'cafe-bru.holodeck.json'],
    [{ name: '***', id: 'Doc 7' }, 'doc-7.holodeck.json'],
    [{ name: '', id: '' }, 'document.holodeck.json'],
  ])('exportFileName(%j) = %s', (doc, name) => {
    expect(exportFileName(doc)).toBe(name);
  });

  it('exportFileName takes another suffix (components CSV)', () => {
    expect(exportFileName({ name: 'My Plant', id: 'x' }, COMPONENTS_FILE_SUFFIX)).toBe('my-plant.components.csv');
  });

  it.each([
    [2, 'my-plant@2x.png'],
    [1, 'my-plant@1x.png'],
    [1.5, 'my-plant@1.5x.png'],
    [1 / 3, 'my-plant@0.33x.png'],
    [Number.NaN, 'my-plant@1x.png'],
    [0, 'my-plant@1x.png'],
  ])('imageFileName at scale %s = %s', (scale, name) => {
    expect(imageFileName({ name: 'My Plant', id: 'x' }, scale)).toBe(name);
  });

  it('documentFileStem never contains path separators or dots', () => {
    expect(documentFileStem({ name: '../../etc/passwd', id: 'x' })).toBe('etc-passwd');
    expect(documentFileStem({ name: 'a\\b:c*?"<>|', id: 'x' })).toBe('a-b-c');
  });
});
