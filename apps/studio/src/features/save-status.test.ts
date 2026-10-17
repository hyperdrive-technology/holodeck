import { describe, expect, it } from 'vitest';
import { describeSaveStatus } from './save-status';

describe('describeSaveStatus', () => {
  it('claims success only when saved', () => {
    expect(describeSaveStatus({ kind: 'saved' })).toMatchObject({ tone: 'info', title: 'All changes are saved in this browser' });
    expect(describeSaveStatus({ kind: 'saving' }).title).not.toContain('saved in');
    const error = describeSaveStatus({ kind: 'error', message: 'disk full' });
    expect(error.tone).toBe('error');
    expect(error.details).toContain('disk full');
    expect(describeSaveStatus({ kind: 'conflict', latest: undefined }).tone).toBe('error');
  });
});
