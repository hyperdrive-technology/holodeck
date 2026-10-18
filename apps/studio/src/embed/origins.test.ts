import { describe, expect, it } from 'vitest';
import { acceptMessage, currentFrameContext, embedOriginPolicy, parseOrigin, referrerWithheld, storedDocumentsVisible, type FrameContext } from './origins';

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

  it('narrows parentOrigin to the configured list when there is one (configured origins are allowed and trusted)', () => {
    const search = new URLSearchParams('parentOrigin=https://a.example&parentOrigin=https://evil.example');
    const policy = embedOriginPolicy(SELF, search, ' https://a.example , https://b.example ');
    expect([...policy.allowed].sort()).toEqual([SELF, 'https://a.example', 'https://b.example'].sort());
    expect([...policy.trusted].sort()).toEqual([SELF, 'https://a.example', 'https://b.example'].sort());
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

describe('trusted vs allowed (holodeck#151)', () => {
  it('a URL grant allows messages but never trust', () => {
    const policy = embedOriginPolicy(SELF, new URLSearchParams('parentOrigin=https://sibling.studio.example'));
    expect(policy.allowed.has('https://sibling.studio.example')).toBe(true);
    expect([...policy.trusted]).toEqual([SELF]);
  });

  it('the configured list is trusted even without a URL grant', () => {
    const policy = embedOriginPolicy(SELF, new URLSearchParams(), 'https://app.example, nonsense');
    expect([...policy.trusted].sort()).toEqual([SELF, 'https://app.example'].sort());
    expect(policy.allowed.has('https://app.example')).toBe(true);
    expect(policy.trusted.has('nonsense')).toBe(false);
  });
});

describe('storedDocumentsVisible', () => {
  const policy = embedOriginPolicy(SELF, new URLSearchParams('parentOrigin=https://sibling.studio.example'), '');
  const configured = embedOriginPolicy(SELF, new URLSearchParams(), 'https://app.example');
  const frame = (f: Partial<FrameContext>): FrameContext => ({ framed: true, ancestorOrigins: null, referrer: '', parentIsTop: true, ...f });

  it('shows stored documents when not framed', () => {
    expect(storedDocumentsVisible(policy, frame({ framed: false }))).toBe(true);
  });

  it('uses the ancestor chain: every ancestor must be trusted', () => {
    expect(storedDocumentsVisible(policy, frame({ ancestorOrigins: [SELF] }))).toBe(true);
    expect(storedDocumentsVisible(configured, frame({ ancestorOrigins: ['https://app.example'] }))).toBe(true);
    expect(storedDocumentsVisible(configured, frame({ ancestorOrigins: ['https://app.example', 'https://evil.example'] }))).toBe(false);
    expect(storedDocumentsVisible(policy, frame({ ancestorOrigins: [SELF, 'https://evil.example'] }))).toBe(false);
    expect(storedDocumentsVisible(policy, frame({ ancestorOrigins: [] }))).toBe(false);
  });

  it('never trusts a URL-granted parent, even same-site', () => {
    expect(storedDocumentsVisible(policy, frame({ ancestorOrigins: ['https://sibling.studio.example'] }))).toBe(false);
    expect(storedDocumentsVisible(policy, frame({ referrer: 'https://sibling.studio.example/page' }))).toBe(false);
  });

  it('falls back to the referrer for one level of framing when the browser has no ancestorOrigins', () => {
    expect(storedDocumentsVisible(policy, frame({ referrer: `${SELF}/some/page` }))).toBe(true);
    expect(storedDocumentsVisible(configured, frame({ referrer: 'https://app.example/' }))).toBe(true);
    expect(storedDocumentsVisible(policy, frame({ referrer: `${SELF}/x`, parentIsTop: false }))).toBe(false);
    expect(storedDocumentsVisible(policy, frame({ referrer: '' }))).toBe(false);
    expect(storedDocumentsVisible(policy, frame({ referrer: 'not a url' }))).toBe(false);
  });

  it('reads the current window (jsdom: not framed)', () => {
    expect(currentFrameContext()).toMatchObject({ framed: false });
  });
});

describe('referrerWithheld (holodeck#157)', () => {
  const f = (o: Partial<FrameContext>): FrameContext => ({ framed: true, ancestorOrigins: null, referrer: '', parentIsTop: true, ...o });
  it('is true only for a framed, ancestorOrigins-less page with no referrer', () => {
    expect(referrerWithheld(f({}))).toBe(true);
    expect(referrerWithheld(f({ referrer: 'https://a.example/' }))).toBe(false);
    expect(referrerWithheld(f({ ancestorOrigins: ['https://a.example'] }))).toBe(false);
    expect(referrerWithheld(f({ framed: false }))).toBe(false);
  });
});
