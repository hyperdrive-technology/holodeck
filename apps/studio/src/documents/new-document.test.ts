import { validateHolodeckDocument } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { createIsoDocument, nextUntitledName } from './new-document';

describe('new documents', () => {
  it('creates a valid empty iso envelope whose body id matches', () => {
    const doc = createIsoDocument('Plant');
    expect(validateHolodeckDocument(doc)).toEqual([]);
    expect(doc.engine).toBe('holodeck.iso');
    expect(doc.body).toMatchObject({ id: doc.id, name: 'Plant', objects: [] });
  });

  it('uses unique ids and a default name for blank input', () => {
    expect(createIsoDocument().id).not.toBe(createIsoDocument().id);
    expect(createIsoDocument('   ').body.name).toBe('Untitled');
  });

  it('nextUntitledName skips taken names', () => {
    expect(nextUntitledName([])).toBe('Untitled');
    expect(nextUntitledName(['Untitled'])).toBe('Untitled 2');
    expect(nextUntitledName(['Untitled', 'Untitled 2', 'Untitled 4'])).toBe('Untitled 3');
  });
});
