import { createProviderContext } from '@holodeck/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { AWS_ORIGINS, guardedFetch, memoizeCredentials } from './clients';
import { createRedactor } from './redact';
import { assumeRoleXml, createFakeAws, epochS, FakeAwsError, metricDataHandler, type FakeAws } from './test-support/fake-aws';
import { collector, connect, FAKE_KEYS, waitFor, type Harness } from './test-support/harness';

const CPU = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1';
const TEMP = { accessKeyId: 'ASIATEMPFAKE00000001', secretAccessKey: 'tempSecret/Fake+Key000000000000000000001', sessionToken: 'TempSessionTokenFake//xyz==' };

let harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  harnesses = [];
});

function cwFake(): FakeAws {
  const fake = createFakeAws();
  fake.on('GetMetricData', metricDataHandler(() => 42, () => Date.now()));
  return fake;
}

async function open(config: Record<string, unknown>, extra: Parameters<typeof connect>[1] = {}) {
  const h = await connect({ region: 'eu-west-1', maxAttempts: 1, ...config }, { fake: extra.fake ?? cwFake(), ...extra });
  harnesses.push(h);
  return h;
}

async function readOnce(h: Harness, source = CPU) {
  const [sample] = (await h.session.read?.([source])) ?? [];
  return sample;
}

/** `Credential=<key id>/<date>/<region>/<service>/aws4_request` from a SigV4 Authorization header. */
const credentialScope = (auth: string | undefined) => /Credential=([^/]+)\/\d{8}\/([^/]+)\/([^/]+)\/aws4_request/.exec(auth ?? '')?.slice(1);

describe('static credentials', () => {
  it('signs with the access key; the secret key never goes on the wire; the session token does (as AWS requires)', async () => {
    const h = await open({}, { secrets: { ...FAKE_KEYS } });
    expect((await readOnce(h))?.value).toBe(42);
    const [call] = h.fake.callsTo('GetMetricData');
    expect(credentialScope(call?.headers.authorization)).toEqual([FAKE_KEYS.accessKeyId, 'eu-west-1', 'monitoring']);
    expect(call?.headers['x-amz-security-token']).toBe(FAKE_KEYS.sessionToken);
    expect(h.fake.wire()).not.toContain(FAKE_KEYS.secretAccessKey);
  });

  it.each([
    [{}, /needs the secrets accessKeyId and secretAccessKey/],
    [{ accessKeyId: FAKE_KEYS.accessKeyId }, /must both be set/],
    [{ secretAccessKey: FAKE_KEYS.secretAccessKey }, /must both be set/],
    [{ accessKeyId: 'AKIA FAKE', secretAccessKey: 'x' }, /must not contain whitespace/],
  ])('connect fails for secrets %j without echoing them', async (secrets, message) => {
    const err = await open({}, { secrets }).catch((e: unknown) => e as Error);
    expect(err).toMatchObject({ name: 'AwsProviderError', kind: 'config' });
    expect((err as Error).message).toMatch(message);
    for (const value of Object.values(secrets)) expect((err as Error).message).not.toContain(value);
  });

  it('config errors fail connect with every problem listed', async () => {
    await expect(open({ region: 'nowhere', accessKeyId: 'x' })).rejects.toMatchObject({
      name: 'AwsConfigError',
      details: ["accessKeyId: credentials must not be stored in a document; use the connection's secrets", 'region: must be an AWS region such as eu-west-1'],
    });
  });
});

describe('assumeRole', () => {
  const ROLE = 'arn:aws:iam::123456789012:role/HolodeckReadOnly';

  function stsFake(expiration = new Date(Date.now() + 3600_000)): FakeAws {
    const fake = cwFake();
    fake.on('AssumeRole', () => assumeRoleXml({ ...TEMP, expiration }));
    return fake;
  }

  it('exchanges the static secrets for role credentials at the regional STS endpoint and signs with them', async () => {
    const fake = stsFake();
    const h = await open(
      { credentials: { type: 'assumeRole', roleArn: ROLE, sessionName: 'studio', durationS: 900 } },
      { fake, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey, externalId: 'ext-fake-123' } },
    );
    expect((await readOnce(h))?.value).toBe(42);
    const [sts] = fake.callsTo('AssumeRole');
    expect(sts?.url).toBe('https://sts.eu-west-1.amazonaws.com/');
    expect(sts?.body).toMatchObject({ RoleArn: ROLE, RoleSessionName: 'studio', DurationSeconds: '900', ExternalId: 'ext-fake-123' });
    expect(credentialScope(sts?.headers.authorization)?.[0]).toBe(FAKE_KEYS.accessKeyId);
    const [cw] = fake.callsTo('GetMetricData');
    expect(credentialScope(cw?.headers.authorization)?.[0]).toBe(TEMP.accessKeyId);
    expect(cw?.headers['x-amz-security-token']).toBe(TEMP.sessionToken);
  });

  it('shares one STS exchange across regions and clients', async () => {
    const fake = stsFake(new Date(Date.now() + 3600_000));
    const h = await open({ credentials: { type: 'assumeRole', roleArn: ROLE }, regions: ['us-east-1'] }, { fake, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey } });
    await readOnce(h);
    await readOnce(h, 'cloudwatch:us-east-1/AWS/EC2/CPUUtilization?InstanceId=i-1');
    fake.on('GetResources', { ResourceTagMappingList: [] });
    await h.session.discover?.();
    expect(fake.callsTo('AssumeRole').length).toBe(1);
    expect(fake.callsTo('GetResources').length).toBe(2);
  });

  it('refreshes role credentials that are about to expire', async () => {
    // Expiring in 2 minutes: inside the SDK's 5-minute margin, so the SDK asks
    // us on every request; we refresh at half the remaining lifetime.
    let now = Date.now();
    const fake = stsFake(new Date(Date.now() + 120_000));
    const h = await open(
      { credentials: { type: 'assumeRole', roleArn: ROLE } },
      { fake, now: () => now, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey } },
    );
    await readOnce(h);
    await readOnce(h);
    expect(fake.callsTo('AssumeRole').length).toBe(1);
    now += 61_000;
    await readOnce(h);
    expect(fake.callsTo('AssumeRole').length).toBe(2);
  });

  it('uses the host callback as the source identity when no static secrets are set', async () => {
    const fake = stsFake();
    const seen: unknown[] = [];
    const h = await open(
      { credentials: { type: 'assumeRole', roleArn: ROLE } },
      {
        fake,
        secrets: {},
        options: {
          credentials: async (req) => {
            seen.push(req);
            return { accessKeyId: 'AKIAHOSTFAKE00000001', secretAccessKey: 'hostSecretFake000000000000000000000000001' };
          },
        },
      },
    );
    await readOnce(h);
    expect(seen).toEqual([{ connectionId: 'prod', region: 'eu-west-1' }]);
    expect(credentialScope(fake.callsTo('AssumeRole')[0]?.headers.authorization)?.[0]).toBe('AKIAHOSTFAKE00000001');
  });

  it('an STS failure shows up as a redacted poll error and is retried', async () => {
    const fake = cwFake();
    let attempts = 0;
    fake.on('AssumeRole', () => {
      attempts++;
      // An error that echoes the caller's key id, as some AWS messages do.
      if (attempts === 1) throw new FakeAwsError('AccessDenied', `User with key ${FAKE_KEYS.accessKeyId} is not authorized to assume the role`, 403);
      return assumeRoleXml({ ...TEMP, expiration: new Date(Date.now() + 3600_000) });
    });
    const h = await open(
      { credentials: { type: 'assumeRole', roleArn: ROLE }, backoff: { initialMs: 1000, maxMs: 1000, factor: 1, jitter: 0 } },
      { fake, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey } },
    );
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    await h.timers.advance(1000);
    await waitFor(() => c.latest(CPU)?.value === 42);
    expect(attempts).toBe(2);
    expect(h.exposed()).not.toContain(FAKE_KEYS.accessKeyId);
  });
});

describe('cognito identity pool', () => {
  it('gets an identity and credentials from Cognito, then signs CloudWatch calls with them', async () => {
    const fake = cwFake();
    fake.on('GetId', (body) => {
      expect(body).toMatchObject({ IdentityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' });
      return { IdentityId: 'eu-west-1:identity-1' };
    });
    fake.on('GetCredentialsForIdentity', () => ({
      IdentityId: 'eu-west-1:identity-1',
      Credentials: { AccessKeyId: TEMP.accessKeyId, SecretKey: TEMP.secretAccessKey, SessionToken: TEMP.sessionToken, Expiration: epochS(Date.now() + 3600_000) },
    }));
    const h = await open({ credentials: { type: 'cognito', identityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' } }, { fake, secrets: {} });
    expect((await readOnce(h))?.value).toBe(42);
    expect(fake.callsTo('GetId')[0]?.url).toBe('https://cognito-identity.eu-west-1.amazonaws.com/');
    expect(credentialScope(fake.callsTo('GetMetricData')[0]?.headers.authorization)?.[0]).toBe(TEMP.accessKeyId);
    // The Cognito credentials are redacted like any other.
    fake.on('GetMetricData', () => {
      throw new Error(`leak ${TEMP.secretAccessKey} ${TEMP.sessionToken}`);
    });
    await readOnce(h);
    expect(h.exposed()).not.toContain(TEMP.secretAccessKey);
  });
});

describe('host credentials', () => {
  it('calls the host callback with the connection id and region', async () => {
    const calls: unknown[] = [];
    const h = await open(
      { credentials: { type: 'host' } },
      { secrets: {}, options: { credentials: (req) => (calls.push(req), { ...TEMP, expiration: new Date(Date.now() + 3600_000) }) } },
    );
    await readOnce(h);
    await readOnce(h);
    expect(calls).toEqual([{ connectionId: 'prod', region: 'eu-west-1' }]);
    expect(credentialScope(h.fake.callsTo('GetMetricData')[0]?.headers.authorization)?.[0]).toBe(TEMP.accessKeyId);
  });

  it('connect fails when no callback is installed', async () => {
    await expect(open({ credentials: { type: 'host' } }, { secrets: {} })).rejects.toMatchObject({ kind: 'config', message: expect.stringMatching(/host credentials callback/) });
  });

  it('incomplete host credentials fail the request as auth errors', async () => {
    const h = await open({ credentials: { type: 'host' } }, { secrets: {}, options: { credentials: () => ({ accessKeyId: '', secretAccessKey: '' }) } });
    const sample = await readOnce(h);
    expect(sample).toMatchObject({ value: null, quality: 'bad' });
    expect(h.logs.some(([, m]) => /credentials are incomplete/.test(m))).toBe(true);
  });
});

describe('network guard', () => {
  it('only AWS origins in permissions.network are reachable through ctx.fetch', async () => {
    const seen: string[] = [];
    const ctx = createProviderContext({ fetch: (async (input: RequestInfo | URL) => (seen.push(String(input)), new Response('{}'))) as typeof fetch });
    const f = guardedFetch(ctx, AWS_ORIGINS);
    for (const url of [
      'https://monitoring.eu-west-1.amazonaws.com/',
      'https://tagging.us-gov-west-1.amazonaws.com/',
      'https://sts.amazonaws.com/',
      'https://monitoring.cn-north-1.amazonaws.com.cn/',
      'https://cognito-identity.ap-south-1.amazonaws.com/',
    ]) {
      await expect(f(url)).resolves.toBeInstanceOf(Response);
    }
    for (const url of [
      'https://evil.example.com/',
      'http://monitoring.eu-west-1.amazonaws.com/',
      'https://monitoring.eu-west-1.amazonaws.com:8443/',
      'https://s3.eu-west-1.amazonaws.com/',
      'https://monitoring.a.b.amazonaws.com/',
      'not a url',
    ]) {
      await expect(f(url)).rejects.toMatchObject({ name: 'AwsProviderError', kind: 'network' });
    }
    expect(seen.length).toBe(5);
    await expect(f(new Request('https://evil.example.com/x'))).rejects.toThrow(/not in this provider's allowed origins/);
  });

  it('a China region resolves to the .com.cn endpoint, which is allowed', async () => {
    const h = await open({ region: 'cn-north-1' }, { secrets: { ...FAKE_KEYS } });
    expect((await readOnce(h, 'cloudwatch:cn-north-1/AWS/EC2/CPUUtilization?InstanceId=i-1'))?.value).toBe(42);
    expect(h.fake.calls[0]?.url).toBe('https://monitoring.cn-north-1.amazonaws.com.cn/');
  });
});

describe('memoizeCredentials', () => {
  it('shares one in-flight load, does not cache failures, and refreshes near expiry', async () => {
    let now = 0;
    let loads = 0;
    let fail = true;
    const redact = createRedactor();
    const provider = memoizeCredentials(
      async () => {
        loads++;
        await new Promise((r) => setTimeout(r, 5));
        if (fail) throw new Error('nope');
        return { accessKeyId: `AKIA${loads}`, secretAccessKey: `secret-${loads}`, expiration: new Date(now + 10 * 60_000) };
      },
      redact,
      () => now,
    );
    await expect(Promise.all([provider(), provider()])).rejects.toThrow('nope');
    expect(loads).toBe(1);
    fail = false;
    const [a, b] = await Promise.all([provider(), provider()]);
    expect(a).toBe(b);
    expect(loads).toBe(2);
    expect(redact('secret-2')).toBe('***');
    now += 4 * 60_000;
    await provider();
    expect(loads).toBe(2);
    now += 2 * 60_000; // within 5 minutes of expiry
    await provider();
    expect(loads).toBe(3);
    // Credentials with only 2 minutes left are kept for half of that, not re-fetched per call.
    const short = memoizeCredentials(async () => (loads++, { accessKeyId: 'A', secretAccessKey: 'S', expiration: new Date(now + 120_000) }), redact, () => now);
    const before = loads;
    await short();
    await short();
    expect(loads).toBe(before + 1);
    now += 61_000;
    await short();
    expect(loads).toBe(before + 2);
  });
});
