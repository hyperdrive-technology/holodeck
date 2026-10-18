/**
 * Resource discovery: Resource Groups Tagging API `GetResources` results →
 * `DiscoveredResource`s (key = ARN, `kind` = `aws.<service>.<type>`,
 * `partHint` = suggested part, `bindings` = suggested metric sources).
 *
 * The Tagging API returns resources that have (or once had) at least one tag,
 * across most services, in one paginated call per region. Untagged resources
 * are not listed; that is an AWS limitation, noted in the README.
 *
 * `partHint`s: `@holodeck/assets-aws` (package `holodeck.aws`) owns the part ids
 * (`aws:<slug>`, e.g. `aws:ec2`); `DEFAULT_PART_HINTS` maps resource kinds onto
 * them and `assets-aws`' tests fail if a hint names a part that does not exist.
 * Hosts can still pass their own map through `AwsProviderOptions.partHints`;
 * it wins over the defaults.
 */

import type { DiscoveredResource } from '@holodeck/sdk';
import { formatAlarmSource, formatMetricSource, type Dimension } from './source';

export interface Arn {
  arn: string;
  partition: string;
  service: string;
  region: string;
  account: string;
  /** Resource type (`instance`, `db`, `function` …); for type-less ARNs (S3, SQS, SNS) a service default. */
  type: string;
  /** Resource id after the type (`i-0abc`, `app/web/50dc6c495c0c9188`, `my-queue`). */
  id: string;
}

/** Type-less ARNs (`arn:aws:s3:::bucket`, `arn:aws:sqs:r:a:queue`): the implied resource type. */
const IMPLIED_TYPE: Record<string, string> = { s3: 'bucket', sqs: 'queue', sns: 'topic' };

/**
 * Parse `arn:<partition>:<service>:<region>:<account>:<resource>`, where
 * resource is `type/id`, `type:id` or `id`. Returns undefined for non-ARNs.
 */
export function parseArn(arn: string): Arn | undefined {
  if (typeof arn !== 'string' || arn.length > 2048) return undefined;
  const parts = arn.split(':');
  if (parts.length < 6 || parts[0] !== 'arn' || !parts[1] || !parts[2]) return undefined;
  const [, partition, service, region, account] = parts as [string, string, string, string, string];
  const resource = parts.slice(5).join(':');
  if (!resource) return undefined;
  let type: string;
  let id: string;
  const slash = resource.indexOf('/');
  const colon = resource.indexOf(':');
  // API Gateway: `arn:aws:apigateway:r::/restapis/abc`
  if (resource.startsWith('/')) {
    const [, t = '', ...rest] = resource.split('/');
    type = t;
    id = rest.join('/');
  } else if (slash >= 0 && (colon < 0 || slash < colon)) {
    type = resource.slice(0, slash);
    id = resource.slice(slash + 1);
  } else if (colon >= 0) {
    type = resource.slice(0, colon);
    id = resource.slice(colon + 1);
  } else {
    type = IMPLIED_TYPE[service] ?? 'resource';
    id = resource;
  }
  return { arn, partition, service, region, account, type, id };
}

/** `aws.<service>.<type>`, lower case, `[a-z0-9-]` only (a dotted-id-safe vocabulary). */
export function resourceKind(arn: Arn): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'resource';
  return `aws.${clean(arn.service)}.${clean(arn.type)}`;
}

/** Default `kind` → part id in `@holodeck/assets-aws` (checked by that package's tests). */
export const DEFAULT_PART_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'aws.ec2.instance': 'aws:ec2',
  'aws.ec2.volume': 'aws:ebs',
  'aws.ec2.vpc': 'aws:vpc',
  'aws.ec2.natgateway': 'aws:vpc',
  'aws.rds.db': 'aws:rds',
  'aws.rds.cluster': 'aws:aurora',
  'aws.lambda.function': 'aws:lambda',
  'aws.dynamodb.table': 'aws:dynamodb',
  'aws.s3.bucket': 'aws:s3',
  'aws.sqs.queue': 'aws:sqs',
  'aws.sns.topic': 'aws:sns',
  'aws.elasticloadbalancing.loadbalancer': 'aws:elb',
  'aws.ecs.cluster': 'aws:ecs',
  'aws.ecs.service': 'aws:ecs',
  'aws.eks.cluster': 'aws:eks',
  'aws.elasticache.cluster': 'aws:elasticache',
  'aws.elasticache.replicationgroup': 'aws:elasticache',
  'aws.cloudfront.distribution': 'aws:cloudfront',
  'aws.apigateway.restapis': 'aws:api-gateway',
  'aws.kinesis.stream': 'aws:kinesis',
  'aws.states.statemachine': 'aws:step-functions',
  'aws.redshift.cluster': 'aws:redshift',
  'aws.es.domain': 'aws:opensearch',
  'aws.cloudwatch.alarm': 'aws:cloudwatch',
});

export type PartHints = Readonly<Record<string, string>> | ((resource: { kind: string; arn: Arn }) => string | undefined);

/** One suggested metric for a resource kind (the "Arcentry default metric" for that service). */
interface MetricHint {
  namespace: string;
  metricName: string;
  stat?: string;
  periodS?: number;
  /** Region override (CloudFront metrics live in us-east-1 only). */
  region?: string;
  dimensions(arn: Arn): Dimension[] | undefined;
}

const one = (Name: string) => (arn: Arn) => (arn.id ? [{ Name, Value: arn.id }] : undefined);

/**
 * Suggested binding `metric` per kind. Load balancers use the part after
 * `loadbalancer/` (`app/web/50dc…`), as the CloudWatch `LoadBalancer`
 * dimension does.
 */
const METRIC_HINTS: Record<string, MetricHint> = {
  'aws.ec2.instance': { namespace: 'AWS/EC2', metricName: 'CPUUtilization', dimensions: one('InstanceId') },
  'aws.rds.db': { namespace: 'AWS/RDS', metricName: 'CPUUtilization', dimensions: one('DBInstanceIdentifier') },
  'aws.rds.cluster': { namespace: 'AWS/RDS', metricName: 'CPUUtilization', dimensions: one('DBClusterIdentifier') },
  'aws.lambda.function': {
    namespace: 'AWS/Lambda',
    metricName: 'Invocations',
    stat: 'Sum',
    // `function:name:alias` → FunctionName is the name only.
    dimensions: (arn) => (arn.id ? [{ Name: 'FunctionName', Value: arn.id.split(':')[0] as string }] : undefined),
  },
  'aws.dynamodb.table': {
    namespace: 'AWS/DynamoDB',
    metricName: 'ConsumedReadCapacityUnits',
    stat: 'Sum',
    dimensions: (arn) => (arn.id && !arn.id.includes('/') ? [{ Name: 'TableName', Value: arn.id }] : undefined),
  },
  'aws.s3.bucket': {
    namespace: 'AWS/S3',
    metricName: 'BucketSizeBytes',
    // S3 storage metrics are daily.
    periodS: 86_400,
    dimensions: (arn) => [
      { Name: 'BucketName', Value: arn.id },
      { Name: 'StorageType', Value: 'StandardStorage' },
    ],
  },
  'aws.sqs.queue': { namespace: 'AWS/SQS', metricName: 'ApproximateNumberOfMessagesVisible', dimensions: one('QueueName') },
  'aws.sns.topic': { namespace: 'AWS/SNS', metricName: 'NumberOfMessagesPublished', stat: 'Sum', dimensions: one('TopicName') },
  'aws.elasticloadbalancing.loadbalancer': {
    namespace: 'AWS/ApplicationELB',
    metricName: 'RequestCount',
    stat: 'Sum',
    dimensions: (arn) => (arn.id.startsWith('app/') ? [{ Name: 'LoadBalancer', Value: arn.id }] : undefined),
  },
  'aws.ecs.service': {
    namespace: 'AWS/ECS',
    metricName: 'CPUUtilization',
    // service/<cluster>/<service> (new ARN format); the old format has no cluster.
    dimensions: (arn) => {
      const [cluster, service] = arn.id.split('/');
      return cluster && service ? [{ Name: 'ClusterName', Value: cluster }, { Name: 'ServiceName', Value: service }] : undefined;
    },
  },
  'aws.ecs.cluster': { namespace: 'AWS/ECS', metricName: 'CPUUtilization', dimensions: one('ClusterName') },
  'aws.elasticache.cluster': { namespace: 'AWS/ElastiCache', metricName: 'CPUUtilization', dimensions: one('CacheClusterId') },
  'aws.cloudfront.distribution': {
    namespace: 'AWS/CloudFront',
    metricName: 'Requests',
    stat: 'Sum',
    region: 'us-east-1',
    dimensions: (arn) => [
      { Name: 'DistributionId', Value: arn.id },
      { Name: 'Region', Value: 'Global' },
    ],
  },
  'aws.kinesis.stream': { namespace: 'AWS/Kinesis', metricName: 'IncomingRecords', stat: 'Sum', dimensions: one('StreamName') },
  'aws.states.statemachine': {
    namespace: 'AWS/States',
    metricName: 'ExecutionsStarted',
    stat: 'Sum',
    dimensions: (arn) => [{ Name: 'StateMachineArn', Value: arn.arn }],
  },
  'aws.redshift.cluster': { namespace: 'AWS/Redshift', metricName: 'CPUUtilization', dimensions: one('ClusterIdentifier') },
};

/** Most tags copied into `metadata` (tag values are user data; keep the payload bounded). */
const MAX_TAGS = 50;

export interface TaggedResource {
  ResourceARN?: string;
  Tags?: Array<{ Key?: string; Value?: string }>;
}

/** Map one Tagging API result. `queryRegion` fills in for global resources (S3, CloudFront) whose ARN has no region. */
export function toDiscoveredResource(item: TaggedResource, queryRegion: string, partHints?: PartHints): DiscoveredResource | undefined {
  const arn = item.ResourceARN ? parseArn(item.ResourceARN) : undefined;
  if (!arn) return undefined;
  const region = arn.region || queryRegion;
  const kind = resourceKind(arn);
  const tags = (item.Tags ?? []).filter((t): t is { Key: string; Value?: string } => typeof t.Key === 'string');
  const name = tags.find((t) => t.Key === 'Name')?.Value;
  const label = name || arn.id || arn.arn;

  const metadata: Record<string, string> = { arn: arn.arn, service: arn.service, type: arn.type, region };
  if (arn.account) metadata.account = arn.account;
  for (const tag of tags.slice(0, MAX_TAGS)) metadata[`tag:${tag.Key}`] = tag.Value ?? '';

  const resource: DiscoveredResource = { key: arn.arn, label, kind, group: region, metadata };
  const hint = typeof partHints === 'function' ? partHints({ kind, arn }) : (partHints?.[kind] ?? DEFAULT_PART_HINTS[kind]);
  const partHint = hint ?? (typeof partHints === 'function' ? DEFAULT_PART_HINTS[kind] : undefined);
  if (partHint) resource.partHint = partHint;

  const bindings: Record<string, string> = {};
  const metric = METRIC_HINTS[kind];
  const dimensions = metric?.dimensions(arn);
  if (metric && dimensions) {
    bindings.metric = formatMetricSource({
      region: metric.region ?? region,
      namespace: metric.namespace,
      metricName: metric.metricName,
      dimensions,
      stat: metric.stat,
      periodS: metric.periodS,
    });
    metadata.namespace = metric.namespace;
  }
  if (kind === 'aws.cloudwatch.alarm' && arn.id) bindings.state = formatAlarmSource(region, arn.id);
  if (Object.keys(bindings).length) resource.bindings = bindings;
  return resource;
}
