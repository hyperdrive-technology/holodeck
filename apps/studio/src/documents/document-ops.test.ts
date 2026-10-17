import { describe, expect, it } from 'vitest';
import { isEnvelope, stampDocument, withDocumentId, withDocumentName } from './document-ops';
import { createIsoDocument } from './new-document';

describe('document ops', () => {
  it('withDocumentId updates the envelope and an iso body id, without mutating', () => {
    const doc = createIsoDocument('A', 'a');
    const next = withDocumentId(doc, 'b');
    expect(next.id).toBe('b');
    expect(next.body.id).toBe('b');
    expect(doc.id).toBe('a');
    expect(doc.body.id).toBe('a');
  });

  it('leaves bodies without an id string alone', () => {
    const doc = { ...createIsoDocument('A', 'a'), body: { nodes: [] } };
    expect(withDocumentId(doc, 'b').body).toBe(doc.body);
  });

  it('withDocumentName updates envelope and body name', () => {
    const next = withDocumentName(createIsoDocument('A', 'a'), 'B');
    expect(next.name).toBe('B');
    expect(next.body.name).toBe('B');
  });

  it('stampDocument keeps created and sets updated', () => {
    const doc = { ...createIsoDocument('A', 'a'), metadata: { created: '2020-01-01T00:00:00.000Z', author: 'me' } };
    const at = new Date('2026-10-17T00:00:00.000Z');
    expect(stampDocument(doc, at).metadata).toEqual({
      created: '2020-01-01T00:00:00.000Z',
      updated: '2026-10-17T00:00:00.000Z',
      author: 'me',
    });
  });

  it('isEnvelope', () => {
    expect(isEnvelope(createIsoDocument())).toBe(true);
    expect(isEnvelope({ objects: [] })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });
});
