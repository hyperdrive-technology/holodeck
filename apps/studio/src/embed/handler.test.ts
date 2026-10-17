import type { HolodeckHost } from '@holodeck/sdk';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES } from '../documents/io';
import { createIsoDocument } from '../documents/new-document';
import { createStudioHost } from '../host/studio-host';
import { withPart } from '../test-support';
import { handleEmbedMessage, type IsoDocument } from './handler';
import { EMBED_PROTOCOL } from './protocol';

let host: HolodeckHost;
let doc: IsoDocument;

beforeAll(async () => {
  host = await createStudioHost();
  doc = createIsoDocument('Plant', 'plant-1') as IsoDocument;
  doc.body = withPart(doc.body, host.registry, 'tank').scene;
});

const result = (requestId: string, ok: boolean, error?: string) => ({ protocol: EMBED_PROTOCOL, type: 'result', requestId, ok, ...(error ? { error } : {}) });

describe('handleEmbedMessage', () => {
  it('setObjectState: sets known objects and acknowledges', () => {
    const out = handleEmbedMessage({ type: 'setObjectState', requestId: 'r', objectId: 'tank-1', state: { level: 0.3 } }, { document: doc, host });
    expect(out).toEqual({ action: { kind: 'set-state', objectId: 'tank-1', state: { level: 0.3 } }, reply: result('r', true) });
  });

  it('setObjectState: refuses unknown objects and a missing document', () => {
    expect(handleEmbedMessage({ type: 'setObjectState', requestId: 'r', objectId: 'nope', state: { a: 1 } }, { document: doc, host })).toEqual({
      action: { kind: 'none' },
      reply: result('r', false, 'objectId: "nope" is not in the document'),
    });
    expect(handleEmbedMessage({ type: 'setObjectState', requestId: 'r', objectId: 'tank-1', state: { a: 1 } }, { document: null, host }).reply).toMatchObject({
      ok: false,
      error: 'no document is loaded',
    });
  });

  it('replies only when the sender asked (requestId)', () => {
    expect(handleEmbedMessage({ type: 'setObjectState', objectId: 'tank-1', state: { a: 1 } }, { document: doc, host })).toEqual({
      action: { kind: 'set-state', objectId: 'tank-1', state: { a: 1 } },
    });
    expect(handleEmbedMessage({ type: 'getInfo' }, { document: doc, host })).toEqual({ action: { kind: 'none' } });
  });

  it('clearObjectState: one object or all', () => {
    expect(handleEmbedMessage({ type: 'clearObjectState', objectId: 'tank-1' }, { document: doc, host }).action).toEqual({ kind: 'clear-state', objectId: 'tank-1' });
    expect(handleEmbedMessage({ type: 'clearObjectState' }, { document: doc, host }).action).toEqual({ kind: 'clear-state' });
  });

  it('getInfo: document id, name and objects', () => {
    expect(handleEmbedMessage({ type: 'getInfo', requestId: 'i' }, { document: doc, host }).reply).toEqual({
      protocol: EMBED_PROTOCOL,
      type: 'info',
      requestId: 'i',
      documentId: 'plant-1',
      name: 'Plant',
      objects: [{ id: 'tank-1', part: 'tank' }],
    });
    expect(handleEmbedMessage({ type: 'getInfo', requestId: 'i' }, { document: null, host }).reply).toMatchObject({ documentId: null, name: null, objects: [] });
  });

  it('loadDocument: validates like a file import and returns the normalised document', () => {
    const out = handleEmbedMessage({ type: 'loadDocument', requestId: 'l', document: JSON.parse(JSON.stringify(doc)) }, { document: null, host });
    expect(out.reply).toEqual(result('l', true));
    expect(out.action.kind).toBe('load');
    if (out.action.kind === 'load') expect(out.action.document).toMatchObject({ id: 'plant-1', engine: 'holodeck.iso' });
  });

  it('loadDocument: accepts a bare legacy scene (wrapped)', () => {
    const out = handleEmbedMessage({ type: 'loadDocument', document: JSON.parse(JSON.stringify(doc.body)) }, { document: null, host });
    expect(out.action.kind).toBe('load');
  });

  it('loadDocument: refuses invalid documents with the import problems', () => {
    const bad = { ...JSON.parse(JSON.stringify(doc)), engine: 'holodeck.nope' };
    const out = handleEmbedMessage({ type: 'loadDocument', requestId: 'l', document: bad }, { document: doc, host });
    expect(out.action).toEqual({ kind: 'none' });
    expect(out.reply).toMatchObject({ ok: false, error: expect.stringMatching(/engine/) });
    const placementOfUnknownPart = JSON.parse(JSON.stringify(doc));
    placementOfUnknownPart.body.objects.push({ id: 'x', object: 'not-installed', x: 0, y: 0 });
    expect(handleEmbedMessage({ type: 'loadDocument', requestId: 'l', document: placementOfUnknownPart }, { document: doc, host }).reply).toMatchObject({ ok: false });
  });

  it('loadDocument: refuses cyclic and oversized values before validating', () => {
    const cyclic: Record<string, unknown> = { format: 'holodeck.document.v1' };
    cyclic.self = cyclic;
    expect(handleEmbedMessage({ type: 'loadDocument', requestId: 'l', document: cyclic }, { document: doc, host }).reply).toMatchObject({
      ok: false,
      error: 'document: must be plain JSON data',
    });
    const huge = { format: 'holodeck.document.v1', padding: 'x'.repeat(MAX_IMPORT_BYTES) };
    expect(handleEmbedMessage({ type: 'loadDocument', requestId: 'l', document: huge }, { document: doc, host }).reply).toMatchObject({
      ok: false,
      error: expect.stringMatching(/larger than/),
    });
  });

  it('answers an untrusted sender about a stored document as if nothing were loaded (holodeck#151)', () => {
    const stored = { document: doc, documentIsStored: true, senderTrusted: false, host };
    expect(handleEmbedMessage({ type: 'getInfo', requestId: 'i' }, stored).reply).toMatchObject({ documentId: null, name: null, objects: [] });
    expect(handleEmbedMessage({ type: 'setObjectState', requestId: 's', objectId: 'tank-1', state: { a: 1 } }, stored)).toEqual({
      action: { kind: 'none' },
      reply: result('s', false, 'no document is loaded'),
    });
    // Trusted sender, or a document the parent sent: answered normally.
    expect(handleEmbedMessage({ type: 'getInfo', requestId: 'i' }, { ...stored, senderTrusted: true }).reply).toMatchObject({ documentId: 'plant-1' });
    expect(handleEmbedMessage({ type: 'getInfo', requestId: 'i' }, { ...stored, documentIsStored: false }).reply).toMatchObject({ documentId: 'plant-1' });
  });
});
