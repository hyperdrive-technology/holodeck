import { describe, expect, it } from 'vitest';
import {
  formatAlarmSource,
  formatBrowsePath,
  formatMetricSource,
  MAX_SOURCE_LENGTH,
  parseBrowsePath,
  parseSource,
  SourceSyntaxError,
  type BrowsePath,
  type MetricSource,
} from './source';

const D = { region: 'eu-west-1', periodS: 60, stat: 'Average' };
const metric = (s: string) => parseSource(s, D) as MetricSource;

describe('metric sources', () => {
  it('parses the PACKAGING.md example', () => {
    const m = metric('cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1&stat=Average');
    expect(m).toMatchObject({
      kind: 'metric',
      region: 'eu-west-1',
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      dimensions: [{ Name: 'InstanceId', Value: 'i-1' }],
      stat: 'Average',
      periodS: 60,
    });
    expect(m.unit).toBeUndefined();
  });

  it('uses connection defaults for an empty region, stat and period', () => {
    const m = metric('cloudwatch:/AWS/SQS/ApproximateNumberOfMessagesVisible?QueueName=jobs');
    expect(m.region).toBe('eu-west-1');
    expect(parseSource('cloudwatch:/AWS/SQS/X', { region: 'us-east-1', periodS: 300, stat: 'Sum' })).toMatchObject({
      region: 'us-east-1',
      periodS: 300,
      stat: 'Sum',
    });
  });

  it('takes multi-segment namespaces, no dimensions, period, unit and extended statistics', () => {
    const m = metric('cloudwatch:us-gov-west-1/AWS/ApplicationELB/TargetResponseTime?LoadBalancer=app%2Fweb%2F50dc&stat=p99.9&period=300&unit=Seconds');
    expect(m).toMatchObject({
      region: 'us-gov-west-1',
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      dimensions: [{ Name: 'LoadBalancer', Value: 'app/web/50dc' }],
      stat: 'p99.9',
      periodS: 300,
      unit: 'Seconds',
    });
    expect(metric('cloudwatch:eu-west-1/CWAgent/mem_used_percent').dimensions).toEqual([]);
    for (const stat of ['SampleCount', 'Sum', 'Minimum', 'Maximum', 'p50', 'p100', 'tm90', 'wm99', 'tc90', 'ts99.5', 'IQM', 'TM(10%:90%)', 'PR(:300)']) {
      expect(metric(`cloudwatch:eu-west-1/A/B?stat=${encodeURIComponent(stat)}`).stat).toBe(stat);
    }
    for (const p of [1, 5, 10, 20, 30, 60, 120, 3600, 86400]) expect(metric(`cloudwatch:eu-west-1/A/B?period=${p}`).periodS).toBe(p);
  });

  it('decodes %-escapes, keeps + literal and supports dim. escapes for reserved names', () => {
    const m = metric('cloudwatch:eu-west-1/Custom%20App/req%2Fs?Path=%2Fapi%3Fx%3D1%26y&Tag=a+b&dim.stat=hot&dim.period=p');
    expect(m.namespace).toBe('Custom App');
    expect(m.metricName).toBe('req/s');
    expect(m.dimensions).toEqual([
      { Name: 'Path', Value: '/api?x=1&y' },
      { Name: 'Tag', Value: 'a+b' },
      { Name: 'stat', Value: 'hot' },
      { Name: 'period', Value: 'p' },
    ]);
    expect(m.stat).toBe('Average');
  });

  it('gives the same key regardless of dimension order and a different key per stat/period/unit/region', () => {
    const a = metric('cloudwatch:eu-west-1/A/B?X=1&Y=2');
    const b = metric('cloudwatch:eu-west-1/A/B?Y=2&X=1');
    expect(a.key).toBe(b.key);
    expect(a.source).not.toBe(b.source);
    const keys = new Set(
      [
        'cloudwatch:eu-west-1/A/B?X=1&Y=2',
        'cloudwatch:eu-west-1/A/B?X=1&Y=2&stat=Sum',
        'cloudwatch:eu-west-1/A/B?X=1&Y=2&period=300',
        'cloudwatch:eu-west-1/A/B?X=1&Y=2&unit=Percent',
        'cloudwatch:us-east-1/A/B?X=1&Y=2',
        'cloudwatch:eu-west-1/A/C?X=1&Y=2',
      ].map((s) => metric(s).key),
    );
    expect(keys.size).toBe(6);
    // A metric key never equals an alarm key.
    expect(parseSource('alarm:eu-west-1/B', D).key).not.toBe(metric('cloudwatch:eu-west-1/A/B').key);
  });

  it.each([
    ['', /must start with/],
    ['metrics:eu-west-1/A/B', /must start with/],
    ['cloudwatch:eu-west-1/B', /region, namespace and metric/],
    ['cloudwatch:mars-1/A/B', /not an AWS region/],
    ['cloudwatch:EU-WEST-1/A/B', /not an AWS region/],
    ['cloudwatch:eu-west-1//B/C', /empty segment/],
    ['cloudwatch:eu-west-1/A/', /metric name/],
    ['cloudwatch:eu-west-1/:bad/B', /not a CloudWatch namespace/],
    ['cloudwatch:eu-west-1/A/B?stat=Median', /not a CloudWatch statistic/],
    ['cloudwatch:eu-west-1/A/B?period=45', /period/],
    ['cloudwatch:eu-west-1/A/B?period=0', /period/],
    ['cloudwatch:eu-west-1/A/B?period=-60', /period/],
    ['cloudwatch:eu-west-1/A/B?period=6e1', /period/],
    ['cloudwatch:eu-west-1/A/B?unit=Furlongs', /not a CloudWatch unit/],
    ['cloudwatch:eu-west-1/A/B?X', /needs "="/],
    ['cloudwatch:eu-west-1/A/B?X=', /needs a value/],
    ['cloudwatch:eu-west-1/A/B?=1', /dimension names/],
    ['cloudwatch:eu-west-1/A/B?X=1&X=2', /appears twice/],
    ['cloudwatch:eu-west-1/A/B?X=1&dim.X=2', /appears twice/],
    ['cloudwatch:eu-west-1/A/B?stat=Sum&stat=Average', /appears twice/],
    ['cloudwatch:eu-west-1/A/B%ZZ', /malformed/],
    ['alarm:eu-west-1', /region and a name/],
    ['alarm:eu-west-1/', /1–255/],
    ['alarm:moon/x', /not an AWS region/],
  ])('rejects %j', (source, message) => {
    expect(() => parseSource(source, D)).toThrow(SourceSyntaxError);
    expect(() => parseSource(source, D)).toThrow(message);
  });

  it('rejects more than 30 dimensions, over-long values and over-long sources', () => {
    const dims = Array.from({ length: 31 }, (_, i) => `D${i}=v`).join('&');
    expect(() => parseSource(`cloudwatch:eu-west-1/A/B?${dims}`, D)).toThrow(/at most 30/);
    expect(() => parseSource(`cloudwatch:eu-west-1/A/B?X=${'v'.repeat(1025)}`, D)).toThrow(/1–1024/);
    expect(() => parseSource(`cloudwatch:eu-west-1/A/${'m'.repeat(256)}`, D)).toThrow(/1–255/);
    expect(() => parseSource(`cloudwatch:eu-west-1/A/B?X=${'v'.repeat(MAX_SOURCE_LENGTH)}`, D)).toThrow(/longer than/);
    expect(() => parseSource(42 as unknown as string, D)).toThrow(/must be a string/);
  });

  it('formatMetricSource round-trips through parseSource, escaping what needs it', () => {
    const cases = [
      { region: 'eu-west-1', namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensions: [{ Name: 'InstanceId', Value: 'i-1' }] },
      { region: '', namespace: 'Custom App/v2', metricName: 'req/s', dimensions: [{ Name: 'Path', Value: '/a?b=c&d#e%f' }], stat: 'p99', periodS: 300, unit: 'Count/Second' },
      { region: 'cn-north-1', namespace: 'X', metricName: 'Y', dimensions: [{ Name: 'stat', Value: 'v' }, { Name: 'dim.x', Value: 'w' }, { Name: 'unit', Value: 'u' }] },
      { region: 'eu-west-1', namespace: 'X', metricName: 'tab\there', dimensions: [{ Name: 'a b', Value: 'line\nbreak' }] },
    ];
    for (const c of cases) {
      const source = formatMetricSource(c);
      const back = parseSource(source, D) as MetricSource;
      expect(back.namespace).toBe(c.namespace);
      expect(back.metricName).toBe(c.metricName);
      expect(back.dimensions).toEqual(c.dimensions);
      expect(back.region).toBe(c.region || D.region);
      if (c.stat) expect(back.stat).toBe(c.stat);
      if (c.periodS) expect(back.periodS).toBe(c.periodS);
      if (c.unit) expect(back.unit).toBe(c.unit);
    }
    expect(formatMetricSource(cases[0] as (typeof cases)[0])).toBe('cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-1');
  });
});

describe('alarm sources', () => {
  it('parses names with slashes and escapes, and formats back', () => {
    expect(parseSource('alarm:eu-west-1/web-cpu-high', D)).toMatchObject({ kind: 'alarm', region: 'eu-west-1', alarmName: 'web-cpu-high' });
    expect(parseSource('alarm:/prod/api 5xx', D)).toMatchObject({ region: 'eu-west-1', alarmName: 'prod/api 5xx' });
    const name = 'TargetTracking-table/orders-AlarmHigh-1a2b%?&';
    const source = formatAlarmSource('us-east-1', name);
    expect(parseSource(source, D)).toMatchObject({ region: 'us-east-1', alarmName: name });
  });
});

describe('browse paths', () => {
  it('round-trip every level, with namespaces as one encoded segment', () => {
    const paths: BrowsePath[] = [
      { level: 'root' },
      { level: 'region', region: 'eu-west-1' },
      { level: 'alarms', region: 'eu-west-1' },
      { level: 'namespace', region: 'eu-west-1', namespace: 'AWS/ApplicationELB' },
      { level: 'metric', region: 'ap-southeast-2', namespace: 'AWS/EC2', metricName: 'Network/In' },
    ];
    for (const p of paths) expect(parseBrowsePath(formatBrowsePath(p))).toEqual(p);
    expect(formatBrowsePath(paths[3] as BrowsePath)).toBe('namespace:eu-west-1/AWS%2FApplicationELB');
    expect(parseBrowsePath(undefined)).toEqual({ level: 'root' });
  });

  it.each(['nope', 'region:', 'region:mars', 'region:eu-west-1/x', 'namespace:eu-west-1', 'namespace:eu-west-1/', 'metric:eu-west-1/A', 'metric:eu-west-1/%ZZ/B', 'cloudwatch:eu-west-1/A/B', 'other:eu-west-1'])(
    'returns undefined for %j',
    (path) => {
      expect(parseBrowsePath(path)).toBeUndefined();
    },
  );
});
