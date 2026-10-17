/**
 * Regression tests for the review follow-ups of #143 (holodeck#145–#150).
 * Each block names its issue.
 */
import type { ProviderSession } from '@holodeck/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { historyPeriod } from './api';
import { memoizeCredentials } from './clients';
import { MAX_POLL_INTERVAL_MS, MAX_TIMER_DELAY_MS } from './provider';
import { createRedactor } from './redact';
import { createFakeAws, epochS, metricDataHandler, type FakeAws } from './test-support/fake-aws';
import { collector, connect, FAKE_KEYS, waitFor, type Harness } from './test-support/harness';

const CPU = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1';

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

async function open(config: Record<string, unknown> = {}, extra: Parameters<typeof connect>[1] = {}) {
  const h = await connect({ region: 'eu-west-1', maxAttempts: 1, ...config }, { fake: extra.fake ?? cwFake(), ...extra });
  harnesses.push(h);
  return h;
}

describe('#145 long periods never overflow the timer', () => {
  it('a 30-day period does not poll in a tight loop (real timers)', async () => {
    // Real global timers: the bug only shows when setTimeout clamps an overflowing delay to 1 ms.
    const delays: number[] = [];
    const h = await open(
      {},
      {
        options: {
          setTimeout: (fn: () => void, ms: number) => {
            delays.push(ms);
            return setTimeout(fn, ms);
          },
          clearTimeout: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
        },
      },
    );
    const c = collector();
    h.session.subscribe([`${CPU}&period=2592000`], c.onSamples);
    await waitFor(() => c.latest(`${CPU}&period=2592000`) !== undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(h.fake.callsTo('GetMetricData').length).toBe(1);
    expect(delays.length).toBeGreaterThan(0);
    expect(delays.every((d) => d <= MAX_TIMER_DELAY_MS)).toBe(true);
    // The poll interval is capped at a day.
    expect(delays).toContain(MAX_POLL_INTERVAL_MS);
  });

  it('every scheduled delay is within the setTimeout limit, at the boundary periods', async () => {
    const h = await open();
    const day = 86_400;
    h.session.subscribe([`${CPU}&period=${day}`, `${CPU}&period=${day + 60}`, `${CPU}&period=${30 * day}`], () => {});
    await waitFor(() => h.timers.pending().length > 0);
    await waitFor(() => h.fake.callsTo('GetMetricData').length >= 1);
    for (const d of h.timers.pending()) expect(d).toBeLessThanOrEqual(MAX_POLL_INTERVAL_MS);
    // 1 day and 1 day + 1 min share the capped interval (one group, one timer).
    expect(h.timers.pending()).toEqual([MAX_POLL_INTERVAL_MS]);
  });

  it('periods above 30 days are rejected when the source is parsed', async () => {
    const { parseSource } = await import('./source');
    const D = { region: 'eu-west-1', periodS: 60, stat: 'Average' };
    expect(parseSource(`${CPU}&period=2592000`, D)).toMatchObject({ periodS: 2_592_000 });
    expect(() => parseSource(`${CPU}&period=2592060`, D)).toThrow(/period/);
    const { parseAwsConfig } = await import('./config');
    expect(() => parseAwsConfig({ region: 'eu-west-1', defaultPeriodS: 2_592_060 })).toThrow(/defaultPeriodS/);
    expect(() => parseAwsConfig({ region: 'eu-west-1', minPollIntervalMs: MAX_TIMER_DELAY_MS + 1 })).toThrow(/minPollIntervalMs/);
    expect(() => parseAwsConfig({ region: 'eu-west-1', backoff: { initialMs: 1, maxMs: MAX_TIMER_DELAY_MS + 1 } })).toThrow(/backoff.maxMs/);
  });

  it('constants: the cap fits a 32-bit signed timer', () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2 ** 31 - 1);
    expect(MAX_POLL_INTERVAL_MS).toBeLessThanOrEqual(MAX_TIMER_DELAY_MS);
  });
});

describe('#146 history periods are multiples of the retention tier', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  const day = 86_400_000;
  it.each([
    // [age of `from` in days, source period s, step ms, required multiple]
    [0.1, 360, undefined, 60],
    [5, 360, undefined, 60],
    [5, 60, 420_000, 60],
    [20, 360, undefined, 300],
    [20, 60, 420_000, 300],
    [20, 60, 3_660_000, 300],
    [70, 360, undefined, 3600],
    [70, 60, 420_000, 3600],
    [70, 3660, undefined, 3600],
  ])('from %s days ago, period %s, step %s → multiple of %s', (ageDays, period, stepMs, multiple) => {
    const from = now - ageDays * day;
    const p = historyPeriod({ from, to: from + 3_600_000, stepMs }, period, now);
    expect(p % multiple).toBe(0);
    expect(p).toBeGreaterThanOrEqual(Math.max(period, (stepMs ?? 0) / 1000));
  });

  it('keeps fine periods for recent data', () => {
    expect(historyPeriod({ from: now - 3_600_000, to: now }, 5, now)).toBe(5);
    expect(historyPeriod({ from: now - 3_600_000, to: now }, 360, now)).toBe(360);
  });
});

describe('#147 credential refresh is single-flight', () => {
  it('concurrent callers after expiry share one refresh', async () => {
    let now = 0;
    let loads = 0;
    const provider = memoizeCredentials(
      async () => {
        loads++;
        await new Promise((r) => setTimeout(r, 10));
        return { accessKeyId: `AKIA${loads}`, secretAccessKey: `s${loads}`, expiration: new Date(now + 20 * 60_000) };
      },
      createRedactor(),
      () => now,
    );
    await provider();
    expect(loads).toBe(1);
    now += 30 * 60_000; // expired
    const results = await Promise.all([provider(), provider(), provider(), provider()]);
    expect(loads).toBe(2);
    expect(new Set(results.map((r) => r.accessKeyId))).toEqual(new Set(['AKIA2']));
    // A failed refresh is not cached, and is also shared while pending.
    now += 30 * 60_000;
    let fail = true;
    const flaky = memoizeCredentials(
      async () => {
        loads++;
        await new Promise((r) => setTimeout(r, 5));
        if (fail) throw new Error('nope');
        return { accessKeyId: 'A', secretAccessKey: 'S' };
      },
      createRedactor(),
      () => now,
    );
    const before = loads;
    await expect(Promise.all([flaky(), flaky()])).rejects.toThrow('nope');
    expect(loads).toBe(before + 1);
    fail = false;
    await flaky();
    expect(loads).toBe(before + 2);
  });

  it('several regions and clients after expiry make one STS call', async () => {
    let now = Date.now();
    const fake = cwFake();
    let sts = 0;
    fake.on('AssumeRole', async () => {
      sts++;
      await new Promise((r) => setTimeout(r, 10));
      const { assumeRoleXml } = await import('./test-support/fake-aws');
      return assumeRoleXml({ accessKeyId: `ASIA${sts}`, secretAccessKey: 'tmpSecretFake0000000000', sessionToken: 'tok', expiration: new Date(now + 3600_000) });
    });
    const h = await open(
      { credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::123456789012:role/RO' } },
      { fake, now: () => now, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey } },
    );
    await h.session.read?.([CPU]);
    expect(sts).toBe(1);
    now += 2 * 3600_000;
    await h.session.read?.([CPU, 'cloudwatch:us-east-1/A/B', 'cloudwatch:ap-south-1/A/B', 'alarm:us-west-2/x']);
    expect(sts).toBe(2);
  });
});

describe('#148 per-result errors in history reject', () => {
  function statusFake(status: string): FakeAws {
    const fake = createFakeAws();
    fake.on('GetMetricData', (body) => ({
      MetricDataResults: (body.MetricDataQueries as Array<{ Id: string }>).map((q) => ({ Id: q.Id, Timestamps: [], Values: [], StatusCode: status })),
      Messages: [{ Code: status, Value: 'details' }],
    }));
    return fake;
  }
  const s = (h: Harness) => h.session as Required<ProviderSession>;

  it('Forbidden → auth error', async () => {
    const h = await open({}, { fake: statusFake('Forbidden') });
    await expect(s(h).history(CPU, { from: Date.now() - 3600_000, to: Date.now() })).rejects.toMatchObject({ name: 'AwsProviderError', kind: 'auth', code: 'Forbidden' });
  });

  it('InternalError → aws error', async () => {
    const h = await open({}, { fake: statusFake('InternalError') });
    await expect(s(h).history(CPU, { from: Date.now() - 3600_000, to: Date.now() })).rejects.toMatchObject({ kind: 'aws', code: 'InternalError' });
  });

  it('Complete with no datapoints is still an empty series; PartialData keeps paging', async () => {
    const h = await open({}, { fake: statusFake('Complete') });
    await expect(s(h).history(CPU, { from: Date.now() - 3600_000, to: Date.now() })).resolves.toEqual([]);
    const fake = createFakeAws();
    const now = Date.now();
    fake.on('GetMetricData', (body) => {
      const id = (body.MetricDataQueries as Array<{ Id: string }>)[0]?.Id;
      if (!body.NextToken) return { MetricDataResults: [{ Id: id, Timestamps: [epochS(now - 1000)], Values: [1], StatusCode: 'PartialData' }], NextToken: 'n' };
      return { MetricDataResults: [{ Id: id, Timestamps: [epochS(now)], Values: [2], StatusCode: 'Complete' }] };
    });
    const h2 = await open({}, { fake });
    expect((await s(h2).history(CPU, { from: now - 3600_000, to: now })).map((x) => x.value)).toEqual([1, 2]);
  });
});

describe('#149 host credential callback errors are redacted', () => {
  it('a throwing callback never exposes its message', async () => {
    const token = 'brokerTOKEN-0123456789-secret';
    const h = await open(
      { credentials: { type: 'host' } },
      {
        secrets: {},
        options: {
          credentials: async () => {
            throw new Error(`broker refused token ${token}`);
          },
        },
      },
    );
    const [sample] = (await h.session.read?.([CPU])) ?? [];
    expect(sample).toMatchObject({ value: null, quality: 'bad' });
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    let thrown = '';
    await h.session.history?.(CPU, { from: 0, to: 1 }).catch((e: Error) => (thrown = `${e.name} ${e.message}`));
    const exposed = `${h.exposed()}\n${thrown}`;
    expect(exposed).toMatch(/host credentials callback failed/);
    expect(exposed).not.toContain(token);
    expect(exposed).not.toContain('broker refused');
  });

  it('keeps a plain error name, drops anything odd', async () => {
    const h = await open(
      { credentials: { type: 'host' } },
      {
        secrets: {},
        options: {
          credentials: () => {
            throw Object.assign(new Error('x'), { name: 'BrokerUnavailable' });
          },
        },
      },
    );
    await h.session.read?.([CPU]);
    expect(h.exposed()).toMatch(/host credentials callback failed \(BrokerUnavailable\)/);
    const h2 = await open(
      { credentials: { type: 'host' } },
      {
        secrets: {},
        options: {
          credentials: () => {
            throw Object.assign(new Error('x'), { name: 'Bad name with secret-123' });
          },
        },
      },
    );
    await h2.session.read?.([CPU]);
    expect(h2.exposed()).not.toContain('secret-123');
  });
});

describe('#150 FIPS / dual-stack settings from the environment are ignored', () => {
  it('uses the standard regional endpoints even when AWS_USE_FIPS_ENDPOINT / AWS_USE_DUALSTACK_ENDPOINT are set', async () => {
    const saved = { fips: process.env.AWS_USE_FIPS_ENDPOINT, dual: process.env.AWS_USE_DUALSTACK_ENDPOINT };
    process.env.AWS_USE_FIPS_ENDPOINT = 'true';
    process.env.AWS_USE_DUALSTACK_ENDPOINT = 'true';
    try {
      const h = await open({}, { secrets: { ...FAKE_KEYS } });
      const [sample] = (await h.session.read?.([CPU])) ?? [];
      expect(sample?.value).toBe(42);
      expect(h.fake.calls[0]?.url).toBe('https://monitoring.eu-west-1.amazonaws.com/');
      h.fake.on('GetResources', { ResourceTagMappingList: [] });
      await h.session.discover?.();
      expect(h.fake.callsTo('GetResources')[0]?.url).toBe('https://tagging.eu-west-1.amazonaws.com/');
      const fake = cwFake();
      const { assumeRoleXml } = await import('./test-support/fake-aws');
      fake.on('AssumeRole', () => assumeRoleXml({ accessKeyId: 'ASIAX', secretAccessKey: 'tmpSecretFake000000', sessionToken: 't', expiration: new Date(Date.now() + 3600_000) }));
      const h2 = await open(
        { credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::123456789012:role/RO' } },
        { fake, secrets: { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey } },
      );
      await h2.session.read?.([CPU]);
      expect(fake.callsTo('AssumeRole')[0]?.url).toBe('https://sts.eu-west-1.amazonaws.com/');
    } finally {
      if (saved.fips === undefined) delete process.env.AWS_USE_FIPS_ENDPOINT;
      else process.env.AWS_USE_FIPS_ENDPOINT = saved.fips;
      if (saved.dual === undefined) delete process.env.AWS_USE_DUALSTACK_ENDPOINT;
      else process.env.AWS_USE_DUALSTACK_ENDPOINT = saved.dual;
    }
  });
});
