import { createProviderContext, isHolodeckProvider, runProviderConformance } from '@holodeck/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { AWS_ORIGINS } from './clients';
import { createAwsProvider, AWS_PROVIDER_ID } from './provider';
import { createFakeAws, epochS, FakeAwsError, metricDataHandler, type FakeAws } from './test-support/fake-aws';
import { collector, connect, FAKE_KEYS, ManualTimers, settle, waitFor, type Harness } from './test-support/harness';

const CPU = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1';
const CPU2 = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-2';
const ALARM = 'alarm:eu-west-1/web-cpu';

let harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  harnesses = [];
});

/** Fake that answers every metric with 42 (or `values[InstanceId]`) and alarm `web-cpu` = ALARM. */
function standardFake(values: Record<string, number | undefined> = {}): FakeAws {
  const fake = createFakeAws();
  fake.on(
    'GetMetricData',
    metricDataHandler(
      (q) => {
        const id = q.MetricStat.Metric.Dimensions?.find((d) => d.Name === 'InstanceId')?.Value ?? '';
        return id in values ? values[id] : 42;
      },
      () => Date.now() - 120_000,
    ),
  );
  fake.on('DescribeAlarms', (body) => ({
    MetricAlarms: ((body.AlarmNames as string[]) ?? []).filter((n) => n !== 'missing').map((n) => ({ AlarmName: n, StateValue: n === 'ok-alarm' ? 'OK' : 'ALARM' })),
    CompositeAlarms: [],
  }));
  return fake;
}

async function open(config: Record<string, unknown> = {}, fake = standardFake(), extra: Parameters<typeof connect>[1] = {}) {
  const h = await connect({ region: 'eu-west-1', maxAttempts: 1, ...config }, { fake, ...extra });
  harnesses.push(h);
  return h;
}

describe('aws.cloudwatch: declaration and conformance', () => {
  it('declares its id, capabilities, schema, secrets and origins', () => {
    const p = createAwsProvider();
    expect(isHolodeckProvider(p)).toBe(true);
    expect(p.id).toBe(AWS_PROVIDER_ID);
    expect(p.id).toBe('aws.cloudwatch');
    expect(p.capabilities).toEqual({ read: true, browse: true, history: true, discover: true });
    expect(p.secrets?.map((s) => s.key)).toEqual(['accessKeyId', 'secretAccessKey', 'sessionToken', 'externalId']);
    expect(p.origins).toEqual([...AWS_ORIGINS]);
    expect(p.configSchema).toMatchObject({ required: ['region'] });
    expect(p.sourceSyntax).toMatch(/cloudwatch:<region>/);
  });

  it('passes runProviderConformance against the fake backend (metrics + alarms)', async () => {
    const fake = standardFake();
    const timers = new ManualTimers();
    const failures: string[] = [];
    await runProviderConformance(
      () => createAwsProvider({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }),
      {
        config: { region: 'eu-west-1', maxAttempts: 1 },
        sources: [CPU, CPU2, 'cloudwatch:us-east-1/AWS/SQS/ApproximateNumberOfMessagesVisible?QueueName=jobs&period=300', ALARM],
        context: {
          fetch: fake.fetch,
          secret: async (key) => (FAKE_KEYS as Record<string, string>)[key],
        },
        // Fire every due poll timer (several intervals' worth), then let the fake answer.
        flush: async () => {
          await timers.advance(10 * 60_000);
          await settle();
        },
      },
      (ok, message) => {
        if (!ok) failures.push(message);
      },
    );
    expect(failures).toEqual([]);
    // After close nothing is scheduled and nothing polls.
    expect(timers.pending()).toEqual([]);
    const count = fake.calls.length;
    await timers.advance(10 * 60_000);
    await settle();
    expect(fake.calls.length).toBe(count);
  });

  it('also passes with alarms only and a 1 s poll floor', async () => {
    const fake = standardFake();
    const timers = new ManualTimers();
    const failures: string[] = [];
    await runProviderConformance(
      () => createAwsProvider({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout }),
      {
        config: { region: 'eu-west-1', alarmPollIntervalMs: 1000 },
        sources: [ALARM, 'alarm:eu-west-1/ok-alarm'],
        context: { fetch: fake.fetch, secret: async (key) => (FAKE_KEYS as Record<string, string>)[key] },
        flush: async () => {
          await timers.advance(5000);
          await settle();
        },
      },
      (ok, message) => {
        if (!ok) failures.push(message);
      },
    );
    expect(failures).toEqual([]);
  });
});

describe('aws.cloudwatch: subscriptions', () => {
  it('delivers the newest datapoint and alarm states with their timestamps', async () => {
    const fake = createFakeAws();
    const t0 = Date.now();
    fake.on('GetMetricData', metricDataHandler(() => ({ values: [10, 30, 20], timestamps: [t0 - 300_000, t0 - 60_000, t0 - 120_000] }), () => t0));
    fake.on('DescribeAlarms', { MetricAlarms: [{ AlarmName: 'web-cpu', StateValue: 'ALARM' }] });
    const h = await open({}, fake);
    const c = collector();
    h.session.subscribe([CPU, ALARM], c.onSamples);
    await waitFor(() => c.latest(CPU) !== undefined && c.latest(ALARM) !== undefined);
    expect(c.latest(CPU)).toEqual({ source: CPU, value: 30, ts: t0 - 60_000 });
    expect(c.latest(ALARM)).toMatchObject({ source: ALARM, value: 'ALARM' });
    expect(c.latest(ALARM)?.quality).toBeUndefined();
    expect(h.session.status().state).toBe('live');
    // The request asked for the newest-first scan over the look-back window.
    const [call] = fake.callsTo('GetMetricData');
    expect(call?.body).toMatchObject({ ScanBy: 'TimestampDescending' });
    expect((call?.body.EndTime as number) - (call?.body.StartTime as number)).toBeCloseTo(900, 0);
    expect(call?.url).toBe('https://monitoring.eu-west-1.amazonaws.com/');
  });

  it('batches GetMetricData at 500 queries and DescribeAlarms at 100 names per request', async () => {
    const h = await open();
    const c = collector();
    const metrics = Array.from({ length: 1200 }, (_, i) => `cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-${i}`);
    const alarms = Array.from({ length: 150 }, (_, i) => `alarm:eu-west-1/a-${i}`);
    h.session.subscribe([...metrics, ...alarms], c.onSamples);
    await waitFor(() => new Set(c.all().map((s) => s.source)).size === 1350);
    const gmd = h.fake.callsTo('GetMetricData');
    expect(gmd.map((call) => (call.body.MetricDataQueries as unknown[]).length)).toEqual([500, 500, 200]);
    // Query ids are valid CloudWatch ids and unique per request.
    for (const call of gmd) {
      const ids = (call.body.MetricDataQueries as Array<{ Id: string }>).map((q) => q.Id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.every((id) => /^[a-z][a-zA-Z0-9_]*$/.test(id))).toBe(true);
    }
    expect(h.fake.callsTo('DescribeAlarms').map((call) => (call.body.AlarmNames as unknown[]).length)).toEqual([100, 50]);
  });

  it('de-duplicates sources that name the same metric (dimension order) into one query', async () => {
    const h = await open();
    const c = collector();
    const a = 'cloudwatch:eu-west-1/AWS/ECS/CPUUtilization?ClusterName=prod&ServiceName=api';
    const b = 'cloudwatch:eu-west-1/AWS/ECS/CPUUtilization?ServiceName=api&ClusterName=prod';
    h.session.subscribe([a, b], c.onSamples);
    await waitFor(() => c.latest(a) !== undefined && c.latest(b) !== undefined);
    expect((h.fake.callsTo('GetMetricData')[0]?.body.MetricDataQueries as unknown[]).length).toBe(1);
  });

  it('takes the poll period from the source, floored at minPollIntervalMs; alarms use alarmPollIntervalMs', async () => {
    const h = await open({ minPollIntervalMs: 60_000, alarmPollIntervalMs: 30_000 });
    const c = collector();
    const fast = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1&period=1';
    const slow = 'cloudwatch:eu-west-1/AWS/S3/BucketSizeBytes?BucketName=b&StorageType=StandardStorage&period=300';
    h.session.subscribe([fast, CPU2, slow, ALARM], c.onSamples);
    await waitFor(() => [fast, CPU2, slow, ALARM].every((s) => c.latest(s) !== undefined));
    // Groups: 60 s (fast + CPU2, one request), 300 s (slow), 30 s (alarms).
    expect(h.fake.callsTo('GetMetricData').length).toBe(2);
    expect(h.timers.pending()).toEqual([30_000, 60_000, 300_000]);
    const metricCalls = () => h.fake.callsTo('GetMetricData').length;
    await h.timers.advance(30_000);
    await waitFor(() => h.fake.callsTo('DescribeAlarms').length === 2);
    expect(metricCalls()).toBe(2);
    await h.timers.advance(30_000);
    await waitFor(() => metricCalls() === 3);
    const third = h.fake.callsTo('GetMetricData')[2];
    expect((third?.body.MetricDataQueries as unknown[]).length).toBe(2);
    await h.timers.advance(240_000);
    await settle();
    // By t = 300 s: the 60 s group polled at 60, 120, 180, 240, 300 and the 300 s group once more.
    expect(metricCalls()).toBe(8);
    const periods = h.fake.callsTo('GetMetricData').flatMap((call) => (call.body.MetricDataQueries as Array<{ MetricStat: { Period: number } }>).map((q) => q.MetricStat.Period));
    expect(new Set(periods)).toEqual(new Set([1, 60, 300]));
  });

  it('shares one poll between subscriptions and stops it when the last one leaves', async () => {
    const h = await open();
    const a = collector();
    const b = collector();
    const stopA = h.session.subscribe([CPU], a.onSamples);
    const stopB = h.session.subscribe([CPU, CPU2], b.onSamples);
    await waitFor(() => a.latest(CPU) !== undefined && b.latest(CPU2) !== undefined);
    // Both subscribes in one tick → one request.
    expect(h.fake.callsTo('GetMetricData').length).toBe(1);
    stopA();
    stopA(); // idempotent
    await h.timers.advance(60_000);
    await waitFor(() => h.fake.callsTo('GetMetricData').length === 2);
    const aCount = a.count();
    expect((h.fake.callsTo('GetMetricData')[1]?.body.MetricDataQueries as unknown[]).length).toBe(2);
    stopB();
    expect(h.timers.pending()).toEqual([]);
    expect(h.session.status()).toMatchObject({ state: 'live', message: 'idle' });
    await h.timers.advance(600_000);
    await settle();
    expect(h.fake.callsTo('GetMetricData').length).toBe(2);
    expect(a.count()).toBe(aCount);
  });

  it('first delivery of a later subscription comes from the cache; only new sources trigger a poll', async () => {
    const h = await open();
    const first = collector();
    h.session.subscribe([CPU], first.onSamples);
    await waitFor(() => first.latest(CPU) !== undefined);
    const cached = collector();
    h.session.subscribe([CPU], cached.onSamples);
    await waitFor(() => cached.latest(CPU) !== undefined);
    expect(h.fake.callsTo('GetMetricData').length).toBe(1);
    const added = collector();
    h.session.subscribe([CPU, CPU2], added.onSamples);
    await waitFor(() => added.latest(CPU2) !== undefined);
    expect(h.fake.callsTo('GetMetricData').length).toBe(2);
    // The poll restarted: one timer for the group, a full interval away.
    expect(h.timers.pending()).toEqual([60_000]);
  });

  it('reports no data as null/uncertain, per-metric Forbidden as bad, a missing alarm as bad, and a bad source as bad', async () => {
    const fake = createFakeAws();
    fake.on('GetMetricData', (body) => ({
      MetricDataResults: (body.MetricDataQueries as Array<{ Id: string; MetricStat: { Metric: { Dimensions: Array<{ Value: string }> } } }>).map((q) => {
        const id = q.MetricStat.Metric.Dimensions[0]?.Value;
        if (id === 'i-1') return { Id: q.Id, Timestamps: [], Values: [], StatusCode: 'Complete' };
        return { Id: q.Id, Timestamps: [], Values: [], StatusCode: 'Forbidden' };
      }),
    }));
    fake.on('DescribeAlarms', { MetricAlarms: [] });
    const h = await open({}, fake);
    const c = collector();
    h.session.subscribe([CPU, CPU2, 'alarm:eu-west-1/missing', 'not-a-source'], c.onSamples);
    await waitFor(() => c.all().length >= 4);
    expect(c.latest(CPU)).toMatchObject({ value: null, quality: 'uncertain' });
    expect(c.latest(CPU2)).toMatchObject({ value: null, quality: 'bad' });
    expect(c.latest('alarm:eu-west-1/missing')).toMatchObject({ value: null, quality: 'bad' });
    expect(c.latest('not-a-source')).toMatchObject({ value: null, quality: 'bad' });
    expect(h.logs.some(([level, m]) => level === 'warn' && m.includes('"not-a-source" ignored'))).toBe(true);
    expect(h.session.status().state).toBe('live');
  });

  it('follows NextToken until every metric has a value (bounded)', async () => {
    const fake = createFakeAws();
    let page = 0;
    fake.on('GetMetricData', (body) => {
      page++;
      const [q1, q2] = body.MetricDataQueries as Array<{ Id: string }>;
      if (page === 1) return { MetricDataResults: [{ Id: q1?.Id, Timestamps: [epochS(Date.now())], Values: [1] }], NextToken: 'p2' };
      expect(body.NextToken).toBe('p2');
      return { MetricDataResults: [{ Id: q2?.Id, Timestamps: [epochS(Date.now())], Values: [2] }], NextToken: 'p3' };
    });
    const h = await open({}, fake);
    const c = collector();
    h.session.subscribe([CPU, CPU2], c.onSamples);
    await waitFor(() => c.latest(CPU2) !== undefined);
    expect(c.latest(CPU)?.value).toBe(1);
    expect(c.latest(CPU2)?.value).toBe(2);
    // Stopped once both had values, despite another NextToken.
    expect(fake.callsTo('GetMetricData').length).toBe(2);
  });

  it('a subscriber that throws is logged and does not break others', async () => {
    const h = await open();
    const ok = collector();
    h.session.subscribe([CPU], () => {
      throw new Error('boom');
    });
    h.session.subscribe([CPU], ok.onSamples);
    await waitFor(() => ok.latest(CPU) !== undefined);
    await waitFor(() => h.logs.some(([level, m]) => level === 'error' && m.includes('subscriber threw: boom')));
  });

  it('does not deliver a poll that completes after unsubscribe', async () => {
    const fake = standardFake();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const inner = fake.fetch;
    fake.fetch = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return inner(...args);
    }) as typeof fetch;
    const h = await open({}, fake);
    const c = collector();
    const stop = h.session.subscribe([CPU], c.onSamples);
    await settle();
    stop();
    release();
    await settle();
    await waitFor(() => fake.calls.length === 1);
    await settle();
    expect(c.count()).toBe(0);
    expect(h.timers.pending()).toEqual([]);
  });
});

describe('aws.cloudwatch: failures, throttling and backoff', () => {
  const backoff = { initialMs: 2000, maxMs: 300_000, factor: 2, jitter: 0 };

  it('a throttled poll never retries sooner than its interval, and backs off beyond it', async () => {
    const fake = standardFake();
    fake.failNext('GetMetricData', new FakeAwsError('ThrottlingException', 'Rate exceeded'), 3);
    const h = await open({ backoff: { ...backoff, initialMs: 90_000 } }, fake);
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    expect(h.session.status().message).toMatch(/GetMetricData eu-west-1: ThrottlingException: Rate exceeded; retrying in 90000 ms/);
    expect(h.timers.pending()).toEqual([90_000]);
    await h.timers.advance(90_000);
    await waitFor(() => fake.callsTo('GetMetricData').length === 2);
    await settle();
    expect(h.timers.pending()).toEqual([180_000]);
    await h.timers.advance(180_000);
    await waitFor(() => fake.callsTo('GetMetricData').length === 3);
    await settle();
    expect(h.timers.pending()).toEqual([300_000]); // capped at maxMs
    await h.timers.advance(300_000);
    await waitFor(() => h.session.status().state === 'live');
    expect(c.latest(CPU)?.value).toBe(42);
    // Back to the normal interval after a success.
    expect(h.timers.pending()).toEqual([60_000]);
  });

  it('a throttle with a short backoff still waits a full interval', async () => {
    const fake = standardFake();
    fake.failNext('GetMetricData', new FakeAwsError('Throttling', 'slow down', 400));
    const h = await open({ backoff }, fake);
    h.session.subscribe([CPU], () => {});
    await waitFor(() => h.session.status().state === 'error');
    expect(h.timers.pending()).toEqual([60_000]);
  });

  it('other failures retry with backoff, but no later than the interval', async () => {
    const fake = standardFake();
    fake.failNext('GetMetricData', new FakeAwsError('InternalFailure', 'oops', 500), 2);
    const h = await open({ backoff }, fake);
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => h.session.status().state === 'error');
    expect(h.timers.pending()).toEqual([2000]);
    // A never-seen source gets one bad sample, so bindings show the failure.
    expect(c.latest(CPU)).toMatchObject({ value: null, quality: 'bad' });
    await h.timers.advance(2000);
    await waitFor(() => fake.callsTo('GetMetricData').length === 2);
    await settle();
    expect(h.timers.pending()).toEqual([4000]);
    expect(c.count()).toBe(1); // the second failure re-delivers nothing
    await h.timers.advance(4000);
    await waitFor(() => c.latest(CPU)?.value === 42);
    expect(h.session.status().state).toBe('live');
  });

  it('a failure after data has flowed is stale, keeps the last values and recovers', async () => {
    const fake = standardFake();
    const h = await open({ backoff }, fake);
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => c.latest(CPU)?.value === 42);
    fake.failNext('GetMetricData', new FakeAwsError('AccessDeniedException', 'User is not authorized', 403));
    await h.timers.advance(60_000);
    await waitFor(() => h.session.status().state === 'stale');
    expect(h.session.status().message).toMatch(/AccessDeniedException/);
    expect(c.all().every((s) => s.value === 42)).toBe(true);
    await h.timers.advance(2000);
    await waitFor(() => h.session.status().state === 'live');
    expect(h.statuses.map((s) => s.state)).toEqual(expect.arrayContaining(['live', 'stale']));
  });

  it('status is the worst group, prefixed with the group when several exist', async () => {
    const fake = standardFake();
    fake.failNext('DescribeAlarms', new FakeAwsError('InternalFailure', 'alarm backend down', 500));
    const h = await open({ backoff }, fake);
    h.session.subscribe([CPU, ALARM], () => {});
    await waitFor(() => h.session.status().state === 'error');
    expect(h.session.status().message).toMatch(/^alarms eu-west-1: DescribeAlarms eu-west-1: InternalFailure: alarm backend down/);
  });

  it('the SDK retries a throttle within one poll when maxAttempts allows', async () => {
    const fake = standardFake();
    fake.failNext('GetMetricData', new FakeAwsError('ThrottlingException', 'Rate exceeded'));
    const h = await open({ maxAttempts: 2 }, fake);
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => c.latest(CPU)?.value === 42, 5000);
    expect(fake.callsTo('GetMetricData').length).toBe(2);
    expect(h.statuses.some((s) => s.state === 'error')).toBe(false);
  });
});

describe('aws.cloudwatch: close', () => {
  it('close stops polling, cancels timers, is idempotent and refuses later calls', async () => {
    const h = await open();
    const c = collector();
    h.session.subscribe([CPU], c.onSamples);
    await waitFor(() => c.latest(CPU) !== undefined);
    await h.session.close();
    await h.session.close();
    expect(h.session.status().state).toBe('disconnected');
    expect(h.statuses.at(-1)?.state).toBe('disconnected');
    expect(h.timers.pending()).toEqual([]);
    expect(h.session.subscribe([CPU], c.onSamples)).toBeTypeOf('function');
    await expect(h.session.read?.([CPU])).rejects.toMatchObject({ name: 'AwsProviderError', kind: 'closed' });
    await expect(h.session.history?.(CPU, { from: 0, to: 1 })).rejects.toMatchObject({ kind: 'closed' });
    await expect(h.session.browse?.()).rejects.toMatchObject({ kind: 'closed' });
    await expect(h.session.discover?.()).rejects.toMatchObject({ kind: 'closed' });
  });

  it('aborting ctx.signal closes the session; an already-aborted signal connects closed', async () => {
    const h = await open();
    h.controller.abort();
    await waitFor(() => h.session.status().state === 'disconnected');
    const controller = new AbortController();
    controller.abort();
    const fake = standardFake();
    const session = await createAwsProvider().connect(
      { region: 'eu-west-1' },
      createProviderContext({ signal: controller.signal, fetch: fake.fetch, secret: async (k) => (FAKE_KEYS as Record<string, string>)[k] }),
    );
    expect(session.status().state).toBe('disconnected');
  });

  it('close aborts a request in flight', async () => {
    const fake = standardFake();
    let seenSignal: AbortSignal | undefined;
    const inner = fake.fetch;
    fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = input instanceof Request ? input.signal : (init?.signal ?? undefined);
      await new Promise((r) => setTimeout(r, 50));
      return inner(input, init);
    }) as typeof fetch;
    const h = await open({}, fake);
    h.session.subscribe([CPU], () => {});
    await waitFor(() => seenSignal !== undefined);
    await h.session.close();
    expect(seenSignal?.aborted).toBe(true);
  });
});
