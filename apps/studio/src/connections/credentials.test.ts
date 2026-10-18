import { describe, expect, it } from 'vitest';
import { CREDENTIAL_CASES } from '../test-support';
import { connectionConfigProblems, credentialProblems, providerConfigProblems } from './credentials';

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
});
