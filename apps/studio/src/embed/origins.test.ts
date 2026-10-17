import { describe, expect, it } from 'vitest';
import { acceptMessage, embedOriginPolicy, parseOrigin } from './origins';

const SELF = 'https://studio.example';

describe('parseOrigin', () => {
  it.each([
    ['https://app.example', 'https://app.example'],
    ['https://app.example/', 'https://app.example'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://APP.example', null], // not the exact (lower-case) origin
    ['  https://app.example  ', 'https://app.example'],
  ])('%j -> %j', (value, origin) => {
    expect(parseOrigin(value)).toBe(origin);
  });

  it.each([
    [''],
    ['*'],
    ['null'],
    ['app.example'],
    ['https://app.example/path'],
    ['https://app.example?x=1'],
    ['https://user:pw@app.example'],
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['file:///etc/passwd'],
    ['ftp://app.example'],
    [`https://${'a'.repeat(3000)}.example`],
  ])('refuses %j', (value) => {
    expect(parseOrigin(value)).toBeNull();
  });
});

describe('embedOriginPolicy', () => {
  it('always allows its own origin', () => {
    expect([...embedOriginPolicy(SELF, new URLSearchParams()).allowed]).toEqual([SELF]);
  });

  it('adds valid parentOrigin parameters and reports the rest', () => {
    const policy = embedOriginPolicy(SELF, new URLSearchParams('parentOrigin=https://a.example&parentOrigin=*&parentOrigin=https://b.example:8443&parentOrigin=https://c.example/x'));
    expect([...policy.allowed].sort()).toEqual([SELF, 'https://a.example', 'https://b.example:8443'].sort());
    expect(policy.rejected).toEqual(['*', 'https://c.example/x']);
  });

  it('narrows parentOrigin to the configured list when there is one', () => {
    const search = new URLSearchParams('parentOrigin=https://a.example&parentOrigin=https://evil.example');
    const policy = embedOriginPolicy(SELF, search, ' https://a.example , https://b.example ');
    expect([...policy.allowed].sort()).toEqual([SELF, 'https://a.example'].sort());
    expect(policy.rejected).toEqual(['https://evil.example']);
  });

  it('treats an empty configured list as no restriction', () => {
    const policy = embedOriginPolicy(SELF, new URLSearchParams('parentOrigin=https://a.example'), ' , ');
    expect(policy.allowed.has('https://a.example')).toBe(true);
  });
});

describe('acceptMessage', () => {
  const parent = { name: 'parent' } as unknown as MessageEventSource;
  const self = { name: 'self' };
  const policy = { allowed: new Set([SELF, 'https://a.example']) };

  it('accepts the direct parent on an allowed origin', () => {
    expect(acceptMessage({ origin: 'https://a.example', source: parent }, policy, parent, self)).toBe(true);
    expect(acceptMessage({ origin: SELF, source: parent }, policy, parent, self)).toBe(true);
  });

  it('refuses other origins, other sources, and unframed pages', () => {
    expect(acceptMessage({ origin: 'https://evil.example', source: parent }, policy, parent, self)).toBe(false);
    expect(acceptMessage({ origin: 'https://a.example', source: { other: true } as unknown as MessageEventSource }, policy, parent, self)).toBe(false);
    expect(acceptMessage({ origin: 'https://a.example', source: null }, policy, parent, self)).toBe(false);
    expect(acceptMessage({ origin: 'null', source: parent }, policy, parent, self)).toBe(false);
    expect(acceptMessage({ origin: SELF, source: parent }, policy, null, self)).toBe(false);
    expect(acceptMessage({ origin: SELF, source: self as unknown as MessageEventSource }, policy, self as unknown as MessageEventSource, self)).toBe(false);
  });
});
