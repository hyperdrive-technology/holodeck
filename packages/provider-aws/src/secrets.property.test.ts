/**
 * Property: no credential ever leaves the provider in a thrown error, a status
 * message or a log line (same property as provider-http's, holodeck#89). A
 * hostile or careless backend echoes every credential (and their encodings)
 * into every error it returns, for every credential type, several secret
 * shapes and every session operation; we collect everything the provider
 * exposes and look for every form of every secret.
 */
import type { ProviderSession } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { assumeRoleXml, createFakeAws, epochS, FakeAwsError, type FakeAws } from './test-support/fake-aws';
import { collector, connect, waitFor } from './test-support/harness';

/** Secret shapes: plain, URL/base64-special characters, non-ASCII. */
const SHAPES = ['plainSECRET0123456789abcd', "sl/ash+plus=eq&amp?q#h%p!'()*", 'pässwörd-ünïcode-0123'];

function forms(secret: string): string[] {
  const out = new Set([
    secret,
    encodeURIComponent(secret),
    encodeURIComponent(secret).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    new URLSearchParams({ s: secret }).toString().slice(2),
    encodeURI(secret),
  ]);
  return [...out].filter((f) => f.length >= 6);
}

const ROLE = 'arn:aws:iam::123456789012:role/ReadOnly';
const MODES = ['static', 'assumeRole', 'cognito', 'host'] as const;

function setup(mode: (typeof MODES)[number], shape: string) {
  const keys = {
    accessKeyId: `AKIA${shape}`,
    secretAccessKey: `sk-${shape}`,
    sessionToken: `st-${shape}`,
    externalId: `ext-${shape}`,
  };
  const temp = { accessKeyId: `ASIA${shape}`, secretAccessKey: `tsk-${shape}`, sessionToken: `tst-${shape}` };
  const all = mode === 'static' ? [keys.accessKeyId, keys.secretAccessKey, keys.sessionToken] : mode === 'assumeRole' ? [...Object.values(keys), ...Object.values(temp)] : Object.values(temp);
  // Header values must be ASCII: the non-ASCII shape cannot be sent (fetch itself throws), which is
  // one more error path that must stay redacted.
  const echo = () => all.flatMap(forms).join(' | ');
  const fake: FakeAws = createFakeAws();
  for (const op of ['GetMetricData', 'DescribeAlarms', 'DescribeAlarmHistory', 'ListMetrics', 'GetResources']) {
    fake.on(op, () => {
      throw new FakeAwsError('AccessDeniedException', `denied for ${echo()}`, 403);
    });
  }
  fake.on('AssumeRole', () => assumeRoleXml({ ...temp, expiration: new Date(Date.now() + 3600_000) }));
  fake.on('GetId', { IdentityId: 'eu-west-1:id' });
  fake.on('GetCredentialsForIdentity', {
    IdentityId: 'eu-west-1:id',
    Credentials: { AccessKeyId: temp.accessKeyId, SecretKey: temp.secretAccessKey, SessionToken: temp.sessionToken, Expiration: epochS(Date.now() + 3600_000) },
  });
  const credentials =
    mode === 'static'
      ? { type: 'static' }
      : mode === 'assumeRole'
        ? { type: 'assumeRole', roleArn: ROLE }
        : mode === 'cognito'
          ? { type: 'cognito', identityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' }
          : { type: 'host' };
  const secrets = mode === 'static' ? { accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey, sessionToken: keys.sessionToken } : mode === 'assumeRole' ? keys : {};
  return { fake, credentials, secrets, all, hostCredentials: async () => ({ ...temp }) };
}

describe('no credential leaves the provider', () => {
  for (const mode of MODES) {
    for (const shape of SHAPES) {
      it(`${mode} credentials, secret shape ${JSON.stringify(shape)}`, async () => {
        const { fake, credentials, secrets, all, hostCredentials } = setup(mode, shape);
        const h = await connect(
          { region: 'eu-west-1', maxAttempts: 1, credentials, regions: ['us-east-1'] },
          { fake, secrets, options: { credentials: hostCredentials } },
        );
        const s = h.session as Required<ProviderSession>;
        const thrown: unknown[] = [];
        const c = collector();
        s.subscribe(['cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1', 'alarm:eu-west-1/a'], c.onSamples);
        await waitFor(() => c.all().length >= 2);
        await s.read([`cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=${encodeURIComponent(all[0] as string)}`]);
        for (const op of [
          () => s.history('cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1', { from: 0, to: 1000 }),
          () => s.history('alarm:eu-west-1/a', { from: 0, to: 1000 }),
          () => s.history(`alarm:eu-west-1/${encodeURIComponent(all[1] as string)}`, { from: 0, to: 1000 }),
          () => s.browse('region:eu-west-1'),
          () => s.browse('alarms:eu-west-1'),
          () => s.discover(),
        ]) {
          await op().then(
            () => thrown.push(new Error('expected a rejection')),
            (e: unknown) => thrown.push(e),
          );
        }
        await s.close();

        const exposed = [
          h.exposed(),
          ...thrown.map((e) => {
            const err = e as Error & Record<string, unknown>;
            // Rebuilt errors carry message/kind/code only: no $metadata, $response or cause.
            expect(Object.keys(err).filter((k) => !['name', 'kind', 'code', 'details', 'source'].includes(k))).toEqual([]);
            expect(err.cause).toBeUndefined();
            return `${err.name}: ${err.message} ${JSON.stringify(err)}`;
          }),
        ].join('\n');
        expect(thrown.length).toBe(6);
        expect(exposed).toMatch(/AccessDeniedException|\*\*\*|Invalid character|ByteString|header/);
        for (const secret of all) {
          for (const form of forms(secret)) expect(exposed, `leaked ${form}`).not.toContain(form);
        }
      });
    }
  }
});
