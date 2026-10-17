import { describe, expect, it } from 'vitest';
import { createIsoDocument } from '../documents/new-document';
import { conflictCopy } from './ConflictDialog';

describe('conflictCopy', () => {
  it('gets a new id (envelope and body) and a marked name, leaving the original alone', () => {
    const mine = createIsoDocument('Plant', 'p');
    const copy = conflictCopy(mine, 'copy-1');
    expect(copy).toMatchObject({ id: 'copy-1', name: 'Plant (my version)', body: { id: 'copy-1', name: 'Plant (my version)' } });
    expect(mine.id).toBe('p');
  });
});
