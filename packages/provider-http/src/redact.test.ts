import { describe, expect, it } from 'vitest';
import { createRedactor, errorMessage, REDACTED, safeUrl } from './redact';

describe('createRedactor', () => {
  it('replaces raw and URL-encoded secret forms', () => {
    const r = createRedactor(['s3cr3t/+ value']);
    expect(r('token s3cr3t/+ value here')).toBe(`token ${REDACTED} here`);
    expect(r(`?k=${encodeURIComponent('s3cr3t/+ value')}`)).toBe(`?k=${REDACTED}`);
    expect(r(`?k=${new URLSearchParams({ s: 's3cr3t/+ value' }).toString().slice(2)}`)).toBe(`?k=${REDACTED}`);
  });

  it('ignores empty secrets and accepts later additions', () => {
    const r = createRedactor(['', undefined]);
    expect(r('nothing to hide')).toBe('nothing to hide');
    r.add('abc');
    expect(r('xabcx')).toBe(`x${REDACTED}x`);
  });

  it('replaces longer secrets first', () => {
    const r = createRedactor(['ab', 'abcd']);
    expect(r('abcd')).toBe(REDACTED);
  });
});

describe('safeUrl', () => {
  it('drops query, fragment and userinfo', () => {
    expect(safeUrl('https://u:p@h.example:8443/a/b?token=x#f')).toBe('https://h.example:8443/a/b');
    expect(safeUrl('nope')).toBe('<invalid url>');
  });
});

describe('errorMessage', () => {
  it('includes the cause of fetch errors', () => {
    const e = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    expect(errorMessage(e)).toBe('fetch failed (connect ECONNREFUSED)');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(new Error('x', { cause: 'y' }))).toBe('x (y)');
  });
});
