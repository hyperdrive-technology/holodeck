import { describe, expect, it } from 'vitest';
import { DEFAULT_PART_HINTS, parseArn, resourceKind, toDiscoveredResource } from './discovery';
import { parseSource, type MetricSource } from './source';

const D = { region: 'eu-west-1', periodS: 60, stat: 'Average' };

describe('parseArn', () => {
  it.each([
    ['arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc', { service: 'ec2', region: 'eu-west-1', account: '123456789012', type: 'instance', id: 'i-0abc' }],
    ['arn:aws:rds:eu-west-1:123456789012:db:orders', { service: 'rds', type: 'db', id: 'orders' }],
    ['arn:aws:lambda:eu-west-1:123456789012:function:resize:live', { service: 'lambda', type: 'function', id: 'resize:live' }],
    ['arn:aws:s3:::my-bucket', { service: 's3', region: '', account: '', type: 'bucket', id: 'my-bucket' }],
    ['arn:aws:sqs:eu-west-1:123456789012:jobs', { service: 'sqs', type: 'queue', id: 'jobs' }],
    ['arn:aws:sns:eu-west-1:123456789012:alerts', { service: 'sns', type: 'topic', id: 'alerts' }],
    ['arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/web/50dc6c495c0c9188', { type: 'loadbalancer', id: 'app/web/50dc6c495c0c9188' }],
    ['arn:aws:ecs:eu-west-1:123456789012:service/prod/api', { type: 'service', id: 'prod/api' }],
    ['arn:aws:apigateway:eu-west-1::/restapis/a1b2c3', { service: 'apigateway', type: 'restapis', id: 'a1b2c3' }],
    ['arn:aws-cn:cloudwatch:cn-north-1:123456789012:alarm:cpu:high', { partition: 'aws-cn', type: 'alarm', id: 'cpu:high' }],
    ['arn:aws:dynamodb:eu-west-1:123456789012:table/orders/stream/2026', { type: 'table', id: 'orders/stream/2026' }],
  ])('%s', (arn, expected) => {
    expect(parseArn(arn)).toMatchObject({ arn, ...expected });
  });

  it.each(['', 'i-0abc', 'arn:aws:ec2', 'arn::ec2:r:a:x', 'arn:aws:ec2:r:a:', `arn:aws:s3:::${'b'.repeat(3000)}`])('rejects %j', (arn) => {
    expect(parseArn(arn)).toBeUndefined();
  });

  it('kinds are lower-case dotted ids', () => {
    expect(resourceKind(parseArn('arn:aws:states:eu-west-1:1:stateMachine:Flow')!)).toBe('aws.states.statemachine');
    expect(resourceKind(parseArn('arn:aws:elasticache:eu-west-1:1:replicationgroup:rg')!)).toBe('aws.elasticache.replicationgroup');
    expect(resourceKind(parseArn('arn:aws:Weird_Svc:eu-west-1:1:Odd Type/x')!)).toBe('aws.weird-svc.odd-type');
  });
});

describe('toDiscoveredResource', () => {
  it('maps an EC2 instance: label from Name, partHint, metric binding, tags in metadata', () => {
    const r = toDiscoveredResource(
      {
        ResourceARN: 'arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc',
        Tags: [
          { Key: 'Name', Value: 'web-1' },
          { Key: 'env', Value: 'prod' },
        ],
      },
      'eu-west-1',
    );
    expect(r).toEqual({
      key: 'arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc',
      label: 'web-1',
      kind: 'aws.ec2.instance',
      group: 'eu-west-1',
      partHint: 'aws:ec2',
      bindings: { metric: 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-0abc' },
      metadata: {
        arn: 'arn:aws:ec2:eu-west-1:123456789012:instance/i-0abc',
        service: 'ec2',
        type: 'instance',
        region: 'eu-west-1',
        account: '123456789012',
        namespace: 'AWS/EC2',
        'tag:Name': 'web-1',
        'tag:env': 'prod',
      },
    });
  });

  it('every suggested metric binding is a valid source', () => {
    const arns = [
      'arn:aws:ec2:eu-west-1:1:instance/i-1',
      'arn:aws:rds:eu-west-1:1:db:orders',
      'arn:aws:rds:eu-west-1:1:cluster:aurora-1',
      'arn:aws:lambda:eu-west-1:1:function:resize:live',
      'arn:aws:dynamodb:eu-west-1:1:table/orders',
      'arn:aws:s3:::bucket-1',
      'arn:aws:sqs:eu-west-1:1:jobs',
      'arn:aws:sns:eu-west-1:1:alerts',
      'arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/app/web/50dc',
      'arn:aws:ecs:eu-west-1:1:service/prod/api',
      'arn:aws:ecs:eu-west-1:1:cluster/prod',
      'arn:aws:elasticache:eu-west-1:1:cluster:redis-1',
      'arn:aws:cloudfront::1:distribution/E2ABC',
      'arn:aws:kinesis:eu-west-1:1:stream/clicks',
      'arn:aws:states:eu-west-1:1:stateMachine:Flow',
      'arn:aws:redshift:eu-west-1:1:cluster:dw',
    ];
    for (const arn of arns) {
      const r = toDiscoveredResource({ ResourceARN: arn }, 'eu-west-1');
      expect(r?.bindings?.metric, arn).toBeDefined();
      const m = parseSource(r?.bindings?.metric as string, D) as MetricSource;
      expect(m.dimensions.length, arn).toBeGreaterThan(0);
      expect(r?.metadata?.namespace).toBe(m.namespace);
      expect(r?.partHint, arn).toBeDefined();
    }
    const lambda = toDiscoveredResource({ ResourceARN: arns[3] }, 'eu-west-1');
    expect(lambda?.bindings?.metric).toBe('cloudwatch:eu-west-1/AWS/Lambda/Invocations?FunctionName=resize&stat=Sum');
    const s3 = toDiscoveredResource({ ResourceARN: arns[5] }, 'eu-central-1');
    expect(s3?.group).toBe('eu-central-1');
    expect(s3?.bindings?.metric).toBe('cloudwatch:eu-central-1/AWS/S3/BucketSizeBytes?BucketName=bucket-1&StorageType=StandardStorage&period=86400');
    // CloudFront metrics are only in us-east-1.
    expect(toDiscoveredResource({ ResourceARN: arns[12] }, 'eu-west-1')?.bindings?.metric).toMatch(/^cloudwatch:us-east-1\/AWS\/CloudFront\/Requests\?DistributionId=E2ABC&Region=Global/);
    const alb = toDiscoveredResource({ ResourceARN: arns[8] }, 'eu-west-1');
    expect((parseSource(alb?.bindings?.metric as string, D) as MetricSource).dimensions).toEqual([{ Name: 'LoadBalancer', Value: 'app/web/50dc' }]);
  });

  it('alarms bind their state; kinds without a metric hint have no bindings', () => {
    const alarm = toDiscoveredResource({ ResourceARN: 'arn:aws:cloudwatch:eu-west-1:1:alarm:web cpu/high' }, 'eu-west-1');
    expect(alarm?.bindings).toEqual({ state: 'alarm:eu-west-1/web%20cpu%2Fhigh' });
    expect(parseSource(alarm?.bindings?.state as string, D)).toMatchObject({ alarmName: 'web cpu/high' });
    const nlb = toDiscoveredResource({ ResourceARN: 'arn:aws:elasticloadbalancing:eu-west-1:1:loadbalancer/net/n/1' }, 'eu-west-1');
    expect(nlb?.bindings).toBeUndefined();
    const vpc = toDiscoveredResource({ ResourceARN: 'arn:aws:ec2:eu-west-1:1:vpc/vpc-1' }, 'eu-west-1');
    expect(vpc).toMatchObject({ kind: 'aws.ec2.vpc', partHint: 'aws:vpc', label: 'vpc-1' });
    expect(vpc?.bindings).toBeUndefined();
    const unknown = toDiscoveredResource({ ResourceARN: 'arn:aws:glue:eu-west-1:1:job/etl' }, 'eu-west-1');
    expect(unknown?.partHint).toBeUndefined();
    expect(toDiscoveredResource({ ResourceARN: 'not-an-arn' }, 'eu-west-1')).toBeUndefined();
    expect(toDiscoveredResource({}, 'eu-west-1')).toBeUndefined();
  });

  it('host part hints (A2) win over the defaults; a function falls back to them', () => {
    const arn = 'arn:aws:ec2:eu-west-1:1:instance/i-1';
    expect(toDiscoveredResource({ ResourceARN: arn }, 'eu-west-1', { 'aws.ec2.instance': 'holodeck.aws/ec2' })?.partHint).toBe('holodeck.aws/ec2');
    expect(toDiscoveredResource({ ResourceARN: arn }, 'eu-west-1', { other: 'x' })?.partHint).toBe('aws:ec2');
    expect(toDiscoveredResource({ ResourceARN: arn }, 'eu-west-1', ({ kind }) => (kind === 'aws.ec2.instance' ? 'fn' : undefined))?.partHint).toBe('fn');
    expect(toDiscoveredResource({ ResourceARN: arn }, 'eu-west-1', () => undefined)?.partHint).toBe('aws:ec2');
    expect(Object.isFrozen(DEFAULT_PART_HINTS)).toBe(true);
  });

  it('bounds the number of tags copied into metadata', () => {
    const Tags = Array.from({ length: 80 }, (_, i) => ({ Key: `k${i}`, Value: 'v' }));
    const r = toDiscoveredResource({ ResourceARN: 'arn:aws:sqs:eu-west-1:1:q', Tags }, 'eu-west-1');
    expect(Object.keys(r?.metadata ?? {}).filter((k) => k.startsWith('tag:')).length).toBe(50);
  });
});
