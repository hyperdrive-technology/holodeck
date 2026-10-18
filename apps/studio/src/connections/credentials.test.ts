import { describe, expect, it } from 'vitest';
import { CLEAN_CASES, CREDENTIAL_CASES } from '../test-support';
import { connectionConfigProblems, credentialInText, credentialName, credentialProblems, providerConfigProblems } from './credentials';

describe('connection credentials (holodeck#163 review)', () => {
  it.each(CREDENTIAL_CASES.map((c) => [c.name, c] as const))('refuses %s', (_name, c) => {
    expect(connectionConfigProblems(c).length).toBeGreaterThan(0);
  });

  it('uses the provider’s own rules (HTTP header and userinfo checks, AWS key names)', () => {
    expect(providerConfigProblems('holodeck.http', { url: 'http://x.test', headers: { Cookie: 'a' } }).join()).toContain('headers.Cookie');
    expect(providerConfigProblems('holodeck.http', { url: 'https://u:p@x.test' }).join()).toContain('url');
    expect(providerConfigProblems('aws.cloudwatch', { region: 'eu-west-1', aws_secret_access_key: 'x' }).join()).toContain('aws_secret_access_key');
    expect(providerConfigProblems('acme.custom', { anything: 1 })).toEqual([]);
  });

  it.each([
    ['holodeck.http', { url: 'http://127.0.0.1:4181/secure', mode: 'poll', intervalMs: 500, auth: { scheme: 'bearer' }, headers: { Accept: 'application/json' } }],
    ['holodeck.http', { url: 'https://x.test/a?limit=10', auth: { scheme: 'header', name: 'X-Api-Key' } }],
    ['holodeck.http', { url: 'https://x.test/a', auth: { scheme: 'basic', username: 'reader' } }],
    ['aws.cloudwatch', { region: 'eu-west-1', credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::123456789012:role/Reader', sessionName: 'holodeck' } }],
    ['aws.cloudwatch', { region: 'eu-west-1', credentials: { type: 'cognito', identityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' } }],
    ['holodeck.sim', undefined],
  ])('accepts a clean %s config', (provider, config) => {
    expect(connectionConfigProblems({ provider, config })).toEqual([]);
  });

  it('includes the provider’s declared secret names', () => {
    expect(credentialProblems({ pin: '1234' }, { secrets: [{ key: 'pin', label: 'PIN' }] }).join()).toContain('"pin"');
  });

  it('a problem never repeats the secret value', () => {
    for (const c of CREDENTIAL_CASES) expect(connectionConfigProblems(c).join('\n')).not.toContain('SECRET');
  });

  it.each(CLEAN_CASES.map((c) => [c.name, c] as const))('accepts %s (no false positive, holodeck#169)', (_name, c) => {
    expect(credentialProblems(c.config)).toEqual([]);
  });

  // Table-driven: names (header / query parameter context).
  it.each([
    ['Authorization', true], ['Proxy-Authorization', true], ['Cookie', true], ['X-Api-Key', true], ['x-auth-key', true],
    ['Ocp-Apim-Subscription-Key', true], ['X-Functions-Key', true], ['key', true], ['sig', true], ['code', true], ['auth', true],
    ['access_token', true], ['client_secret', true], ['refreshToken', true], ['X-Amz-Security-Token', true], ['password', true],
    ['X-Token-Count', false], ['nextToken', false], ['maxTokens', false], ['page_token', false], ['tokenizer', false],
    ['secretName', false], ['limit', false], ['Accept', false], ['sortKey', false],
  ])('credentialName(%j) = %s', (name, expected) => {
    expect(credentialName(name)).toBe(expected);
  });

  it('short words are credentials as parameters but not as config keys', () => {
    for (const word of ['key', 'code', 'auth', 'sig']) {
      expect(credentialName(word, new Set(), 'param')).toBe(true);
      expect(credentialName(word, new Set(), 'key')).toBe(false);
    }
  });

  // Table-driven: values, with relative URLs resolved against a connection URL.
  it.each([
    ['https://u:p@x.test/a', true],
    ['//admin:p@x.test/w', true],
    ['https:/admin:p@x.test/w', true],
    ['https:\\\\admin:p@x.test\\w', true],
    ['   https://u:p@x.test', true],
    ['write?api_key=abc', true],
    ['/api#access_token=abc', true],
    ['https://x.test/a?sv=1&sig=abc', true],
    ['https://user@x.test/a', true],
    ['Bearer abcdefgh12345', true],
    ['Basic dXNlcjpwYXNz', true],
    ['AKIAABCDEFGHIJKLMNOP', true],
    ['ghp_abcdefghijklmnopqrstuvwxyz', true],
    ['sk_live_abcdefghijklmnop', true],
    ['AIzaSyA1234567890abcdefghijklmnopqrstu', true],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl', true],
    ['https://x.test/a?page_token=2&limit=5', false],
    ['ssh://git@git.example/x.git', false],
    ['Basic tier', false],
    ['write/{source}', false],
    ['/api/line2#/speed', false],
    ['ops@example.com', false],
    ['eu-west-1', false],
    ['arn:aws:iam::123456789012:role/Reader', false],
    ['{value} rpm', false],
  ])('credentialInText(%j) flags: %s', (value, expected) => {
    const found = credentialInText(value, 'https://x.test/api/');
    if (expected) expect(found).toEqual(expect.any(String));
    else expect(found).toBeNull();
  });
});
