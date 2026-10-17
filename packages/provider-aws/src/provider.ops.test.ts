import type { ProviderSession, SignalNode } from '@holodeck/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSource, SourceSyntaxError } from './source';
import { createFakeAws, epochS, FakeAwsError, metricDataHandler, type FakeAws } from './test-support/fake-aws';
import { connect, type Harness } from './test-support/harness';

const D = { region: 'eu-west-1', periodS: 60, stat: 'Average' };
const CPU = 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1';

let harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses) await h.session.close();
  harnesses = [];
});

async function open(fake: FakeAws, config: Record<string, unknown> = {}, extra: Parameters<typeof connect>[1] = {}) {
  const h = await connect({ region: 'eu-west-1', maxAttempts: 1, ...config }, { fake, ...extra });
  harnesses.push(h);
  return h;
}
const s = (h: Harness) => h.session as Required<ProviderSession>;

describe('read', () => {
  it('returns one sample per source in request order, across kinds and regions', async () => {
    const fake = createFakeAws();
    fake.on('GetMetricData', metricDataHandler((q) => (q.MetricStat.Metric.Namespace === 'AWS/SQS' ? 7 : 42), () => Date.now()));
    fake.on('DescribeAlarms', { MetricAlarms: [{ AlarmName: 'a', StateValue: 'OK' }] });
    const h = await open(fake);
    const sources = ['alarm:eu-west-1/a', 'bogus', 'cloudwatch:us-east-1/AWS/SQS/ApproximateNumberOfMessagesVisible?QueueName=q', CPU];
    const out = await s(h).read(sources);
    expect(out.map((x) => x.source)).toEqual(sources);
    expect(out.map((x) => x.value)).toEqual(['OK', null, 7, 42]);
    expect(out[1]?.quality).toBe('bad');
    expect(new Set(fake.calls.map((c) => c.region))).toEqual(new Set(['eu-west-1', 'us-east-1']));
  });

  it('a failed region gives bad samples and a warning, other regions still answer', async () => {
    const fake = createFakeAws();
    fake.on('GetMetricData', (body, call) => {
      if (call.region === 'us-east-1') throw new FakeAwsError('InternalFailure', 'down', 500);
      return metricDataHandler(() => 1, () => Date.now())(body, call);
    });
    const h = await open(fake);
    const out = await s(h).read([CPU, 'cloudwatch:us-east-1/A/B']);
    expect(out[0]?.value).toBe(1);
    expect(out[1]).toMatchObject({ value: null, quality: 'bad' });
    expect(h.logs.some(([l, m]) => l === 'warn' && m.includes('GetMetricData us-east-1: InternalFailure: down'))).toBe(true);
  });
});

describe('history', () => {
  it('returns a metric series oldest first, following NextToken, with the chosen period', async () => {
    const fake = createFakeAws();
    const now = Date.now();
    fake.on('GetMetricData', (body) => {
      const q = (body.MetricDataQueries as Array<{ Id: string; MetricStat: { Period: number } }>)[0];
      if (!body.NextToken) return { MetricDataResults: [{ Id: q?.Id, Timestamps: [epochS(now - 3_000_000), epochS(now - 3_300_000)], Values: [2, 1] }], NextToken: 'n' };
      return { MetricDataResults: [{ Id: q?.Id, Timestamps: [epochS(now - 2_400_000)], Values: [3] }] };
    });
    const h = await open(fake);
    const out = await s(h).history(CPU, { from: now - 3_600_000, to: now, stepMs: 300_000 });
    expect(out).toEqual([
      { source: CPU, value: 1, ts: now - 3_300_000 },
      { source: CPU, value: 2, ts: now - 3_000_000 },
      { source: CPU, value: 3, ts: now - 2_400_000 },
    ]);
    const calls = fake.callsTo('GetMetricData');
    expect(calls.length).toBe(2);
    expect(calls[0]?.body).toMatchObject({ ScanBy: 'TimestampAscending', StartTime: epochS(now - 3_600_000), EndTime: epochS(now) });
    expect((calls[0]?.body.MetricDataQueries as Array<{ MetricStat: { Period: number; Stat: string } }>)[0]?.MetricStat).toMatchObject({ Period: 300, Stat: 'Average' });
  });

  it('coarsens the period for old data (CloudWatch retention)', async () => {
    const fake = createFakeAws();
    fake.on('GetMetricData', metricDataHandler(() => undefined, () => 0));
    const h = await open(fake);
    const day = 86_400_000;
    await s(h).history(`${CPU}&period=1`, { from: Date.now() - 20 * day, to: Date.now() - 19 * day });
    const q = (fake.callsTo('GetMetricData')[0]?.body.MetricDataQueries as Array<{ MetricStat: { Period: number } }>)[0];
    expect(q?.MetricStat.Period).toBe(300);
  });

  it('returns alarm state changes from DescribeAlarmHistory', async () => {
    const fake = createFakeAws();
    const now = Date.now();
    fake.on('DescribeAlarmHistory', {
      AlarmHistoryItems: [
        { Timestamp: epochS(now - 1000), HistoryItemType: 'StateUpdate', HistoryData: JSON.stringify({ newState: { stateValue: 'OK' } }) },
        { Timestamp: epochS(now - 5000), HistoryItemType: 'StateUpdate', HistorySummary: 'Alarm updated from OK to ALARM' },
        { Timestamp: epochS(now - 3000), HistoryItemType: 'StateUpdate', HistoryData: '{}' },
      ],
    });
    const h = await open(fake);
    const out = await s(h).history('alarm:eu-west-1/web/cpu', { from: now - 10_000, to: now });
    expect(out).toEqual([
      { source: 'alarm:eu-west-1/web/cpu', value: 'ALARM', ts: now - 5000 },
      { source: 'alarm:eu-west-1/web/cpu', value: 'OK', ts: now - 1000 },
    ]);
    expect(fake.callsTo('DescribeAlarmHistory')[0]?.body).toMatchObject({ AlarmName: 'web/cpu', HistoryItemType: 'StateUpdate', ScanBy: 'TimestampAscending' });
  });

  it('validates the range and the source', async () => {
    const h = await open(createFakeAws());
    await expect(s(h).history(CPU, { from: 10, to: 5 })).rejects.toThrow(RangeError);
    await expect(s(h).history(CPU, { from: NaN, to: 5 })).rejects.toThrow(/finite/);
    await expect(s(h).history(CPU, { from: 0, to: 5, stepMs: -1 })).rejects.toThrow(/stepMs/);
    await expect(s(h).history('nope', { from: 0, to: 5 })).rejects.toThrow(SourceSyntaxError);
  });

  it('AWS errors become AwsProviderError with a kind and code', async () => {
    const fake = createFakeAws();
    fake.failNext('GetMetricData', new FakeAwsError('InvalidParameterValueException', 'The start time is too old', 400));
    const h = await open(fake);
    await expect(s(h).history(CPU, { from: 0, to: 1 })).rejects.toMatchObject({
      name: 'AwsProviderError',
      kind: 'aws',
      code: 'InvalidParameterValueException',
      message: 'GetMetricData eu-west-1: InvalidParameterValueException: The start time is too old',
    });
  });
});

describe('browse', () => {
  function browseFake(): FakeAws {
    const fake = createFakeAws();
    const metrics = [
      { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'InstanceId', Value: 'i-2' }] },
      { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }] },
      { Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [] },
      { Namespace: 'AWS/EC2', MetricName: 'NetworkIn', Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }] },
      { Namespace: 'AWS/ApplicationELB', MetricName: 'RequestCount', Dimensions: [{ Name: 'LoadBalancer', Value: 'app/web/1' }] },
      { Namespace: 'Custom/App', MetricName: 'req/s', Dimensions: [{ Name: 'stat', Value: 'x' }] },
    ];
    fake.on('ListMetrics', (body) => {
      const list = metrics.filter((m) => (!body.Namespace || m.Namespace === body.Namespace) && (!body.MetricName || m.MetricName === body.MetricName));
      // Two pages to exercise NextToken.
      if (!body.NextToken) return { Metrics: list.slice(0, 2), NextToken: list.length > 2 ? 't' : undefined };
      return { Metrics: list.slice(2) };
    });
    fake.on('DescribeAlarms', {
      MetricAlarms: [{ AlarmName: 'web-cpu', StateValue: 'OK', MetricName: 'CPUUtilization' }],
      CompositeAlarms: [{ AlarmName: 'site/down', StateValue: 'ALARM', AlarmDescription: 'Site down' }],
    });
    return fake;
  }

  it('walks regions → namespaces → metrics → dimension sets, and alarms', async () => {
    const fake = browseFake();
    const h = await open(fake, { regions: ['us-east-1'] });
    const root = await s(h).browse();
    expect(root).toEqual([
      { path: 'region:eu-west-1', label: 'eu-west-1', hasChildren: true },
      { path: 'region:us-east-1', label: 'us-east-1', hasChildren: true },
    ]);
    const region = await s(h).browse('region:eu-west-1');
    expect(region.map((n) => n.label)).toEqual(['Alarms', 'AWS/ApplicationELB', 'AWS/EC2', 'Custom/App']);
    expect(fake.callsTo('ListMetrics')[0]?.body).toMatchObject({ RecentlyActive: 'PT3H' });
    const ec2 = region.find((n) => n.label === 'AWS/EC2') as SignalNode;
    expect(ec2.path).toBe('namespace:eu-west-1/AWS%2FEC2');
    const names = await s(h).browse(ec2.path);
    expect(names.map((n) => [n.label, n.hasChildren])).toEqual([
      ['CPUUtilization', true],
      ['NetworkIn', true],
    ]);
    const leaves = await s(h).browse(names[0]?.path);
    expect(leaves.map((n) => n.label)).toEqual(['(no dimensions)', 'InstanceId=i-1', 'InstanceId=i-2']);
    for (const leaf of leaves) {
      expect(leaf).toMatchObject({ type: 'number', writable: false });
      expect(leaf.source).toBe(leaf.path);
      expect(parseSource(leaf.source as string, D)).toMatchObject({ namespace: 'AWS/EC2', metricName: 'CPUUtilization' });
    }
    expect(leaves[1]?.source).toBe('cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1');
    // Escaping survives the round trip (metric name with "/", reserved dimension name).
    const custom = await s(h).browse((await s(h).browse('namespace:eu-west-1/Custom%2FApp'))[0]?.path);
    expect(parseSource(custom[0]?.source as string, D)).toMatchObject({ namespace: 'Custom/App', metricName: 'req/s', dimensions: [{ Name: 'stat', Value: 'x' }] });

    const alarms = await s(h).browse('alarms:eu-west-1');
    expect(alarms).toEqual([
      { path: 'alarm:eu-west-1/web-cpu', label: 'web-cpu', source: 'alarm:eu-west-1/web-cpu', type: 'string', writable: false, description: 'alarm on CPUUtilization' },
      { path: 'alarm:eu-west-1/site%2Fdown', label: 'site/down', source: 'alarm:eu-west-1/site%2Fdown', type: 'string', writable: false, description: 'Site down' },
    ]);
  });

  it('honours browseRecentlyActive and browseMaxItems; unknown paths list nothing', async () => {
    const fake = browseFake();
    const h = await open(fake, { browseRecentlyActive: false, browseMaxItems: 2 });
    const region = await s(h).browse('region:eu-west-1');
    expect(region.length).toBe(2);
    expect(fake.callsTo('ListMetrics')[0]?.body.RecentlyActive).toBeUndefined();
    expect((await s(h).browse('metric:eu-west-1/AWS%2FEC2/CPUUtilization')).length).toBe(2);
    for (const path of ['nope', 'region:mars-1', 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization']) expect(await s(h).browse(path)).toEqual([]);
  });

  it('browse errors are AwsProviderErrors', async () => {
    const fake = createFakeAws();
    fake.failNext('ListMetrics', new FakeAwsError('AccessDenied', 'no ListMetrics', 403));
    const h = await open(fake);
    await expect(s(h).browse('region:eu-west-1')).rejects.toMatchObject({ kind: 'auth', code: 'AccessDenied' });
  });
});

describe('discover', () => {
  it('lists tagged resources in every region, paginated, de-duplicating global ones', async () => {
    const fake = createFakeAws();
    fake.on('GetResources', (body, call) => {
      if (call.region === 'eu-west-1' && !body.PaginationToken) {
        return {
          ResourceTagMappingList: [
            { ResourceARN: 'arn:aws:ec2:eu-west-1:123456789012:instance/i-1', Tags: [{ Key: 'Name', Value: 'web-1' }] },
            { ResourceARN: 'arn:aws:s3:::assets' },
          ],
          PaginationToken: 'next',
        };
      }
      if (call.region === 'eu-west-1') return { ResourceTagMappingList: [{ ResourceARN: 'arn:aws:sqs:eu-west-1:123456789012:jobs' }], PaginationToken: '' };
      return { ResourceTagMappingList: [{ ResourceARN: 'arn:aws:s3:::assets' }, { ResourceARN: 'arn:aws:lambda:us-east-1:123456789012:function:f' }, { ResourceARN: 'garbage' }] };
    });
    const h = await open(fake, { regions: ['us-east-1'], discover: { resourceTypes: ['ec2:instance', 's3', 'sqs', 'lambda'], tags: [{ key: 'env', values: ['prod'] }] } });
    const out = await s(h).discover();
    expect(out.map((r) => [r.kind, r.label, r.group, r.partHint])).toEqual([
      ['aws.ec2.instance', 'web-1', 'eu-west-1', 'aws.ec2'],
      ['aws.s3.bucket', 'assets', 'eu-west-1', 'aws.s3'],
      ['aws.sqs.queue', 'jobs', 'eu-west-1', 'aws.sqs'],
      ['aws.lambda.function', 'f', 'us-east-1', 'aws.lambda'],
    ]);
    const calls = fake.callsTo('GetResources');
    expect(calls.map((c) => c.region)).toEqual(['eu-west-1', 'eu-west-1', 'us-east-1']);
    expect(calls[0]?.url).toBe('https://tagging.eu-west-1.amazonaws.com/');
    expect(calls[0]?.body).toMatchObject({
      ResourcesPerPage: 100,
      ResourceTypeFilters: ['ec2:instance', 's3', 'sqs', 'lambda'],
      TagFilters: [{ Key: 'env', Values: ['prod'] }],
    });
    expect(calls[1]?.body.PaginationToken).toBe('next');
    // Suggested bindings are subscribable sources.
    expect(out[0]?.bindings?.metric).toBe('cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1');
  });

  it('stops at discover.maxResources and uses host part hints', async () => {
    const fake = createFakeAws();
    let page = 0;
    fake.on('GetResources', () => {
      page++;
      return {
        ResourceTagMappingList: Array.from({ length: 100 }, (_, i) => ({ ResourceARN: `arn:aws:ec2:eu-west-1:1:instance/i-${page}-${i}` })),
        PaginationToken: 'more',
      };
    });
    const h = await open(fake, { discover: { maxResources: 150 } }, { options: { partHints: { 'aws.ec2.instance': 'holodeck.aws/ec2' } } });
    const out = await s(h).discover();
    expect(out.length).toBe(150);
    expect(fake.callsTo('GetResources').length).toBe(2);
    expect(out.every((r) => r.partHint === 'holodeck.aws/ec2')).toBe(true);
  });

  it('a failing region rejects with the region in the message', async () => {
    const fake = createFakeAws();
    fake.failNext('GetResources', new FakeAwsError('ThrottledException', 'slow', 400));
    const h = await open(fake);
    await expect(s(h).discover()).rejects.toMatchObject({ kind: 'throttled', message: 'GetResources eu-west-1: ThrottledException: slow' });
  });
});
