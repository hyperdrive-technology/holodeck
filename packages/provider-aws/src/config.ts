/**
 * Connection config of `aws.cloudwatch` (non-secret: it is stored in documents).
 * Credentials reach the provider only through `ProviderContext.secret(key)`
 * (`AWS_PROVIDER_SECRETS`) or a host callback (`AwsProviderOptions.credentials`);
 * they are held in memory for the session and never written anywhere.
 */

import type { ProviderSecretSpec } from '@holodeck/sdk';

/**
 * Where the session's AWS credentials come from.
 *
 * - `static`: an access key pair from secrets `accessKeyId` + `secretAccessKey`,
 *   plus `sessionToken` for temporary credentials (what `aws sts assume-role`
 *   or IAM Identity Center hand out). Use a read-only principal.
 * - `assumeRole`: STS AssumeRole into `roleArn` (a read-only role) using the
 *   static secrets, or the host callback when no secrets are set, as the
 *   source identity. Optional secret `externalId`.
 * - `cognito`: unauthenticated identities of a Cognito identity pool whose
 *   role grants CloudWatch read access. Nothing secret is needed.
 * - `host`: the host's `AwsProviderOptions.credentials` callback (SSO, a
 *   backend token broker, …).
 */
export type AwsCredentialsConfig =
  | { type: 'static' }
  | { type: 'assumeRole'; roleArn: string; sessionName: string; durationS: number }
  | { type: 'cognito'; identityPoolId: string }
  | { type: 'host' };

export const CREDENTIAL_TYPES = ['static', 'assumeRole', 'cognito', 'host'] as const;

export interface BackoffConfig {
  /** First retry delay after a failed poll (default 2000 ms). */
  initialMs: number;
  /** Ceiling (default 300000 ms). */
  maxMs: number;
  /** Growth per consecutive failure (default 2). */
  factor: number;
  /** ± fraction of random spread, 0–1 (default 0.2). */
  jitter: number;
}

export interface DiscoverConfig {
  /** Resource Groups Tagging API `ResourceTypeFilters`, e.g. `ec2:instance`, `rds:db`. Default: all. */
  resourceTypes?: string[];
  /** `TagFilters`: only resources with these tags (any of `values`; no values = key present). */
  tags?: Array<{ key: string; values?: string[] }>;
  /** Most resources returned across all regions (default 1000). */
  maxResources: number;
}

export interface AwsConnectionConfig {
  /** Default region: used by sources with an empty region (`cloudwatch:/AWS/EC2/…`) and listed first in browse/discover. */
  region: string;
  /** Every region `browse` and `discover` cover (default: `[region]`). Sources may name any region. */
  regions: string[];
  credentials: AwsCredentialsConfig;
  /** Metric period when a source has no `period=` (default 60 s). */
  defaultPeriodS: number;
  /** Statistic when a source has no `stat=` (default `Average`). */
  defaultStat: string;
  /**
   * Floor for the metric poll interval (default 60000 ms, minimum 1000 ms). A
   * metric source is polled every `max(period, minPollIntervalMs)`: polling
   * faster than the metric's period only re-reads the same datapoint, and
   * every GetMetricData metric is billed.
   */
  minPollIntervalMs: number;
  /** Alarm state poll interval (default 60000 ms, minimum 1000 ms). */
  alarmPollIntervalMs: number;
  /**
   * How far back a live poll looks for the newest datapoint, in seconds
   * (default: `max(900, 5 × period)`). CloudWatch publishes most AWS metrics
   * a few minutes late, so a window of one period would often be empty.
   */
  lookbackS?: number;
  /** Per-request timeout (default 10000 ms). */
  timeoutMs: number;
  /** AWS SDK attempts per request, including its own throttling-aware retries (default 3). */
  maxAttempts: number;
  /** Provider-level backoff between failed polls, on top of the SDK's retries. */
  backoff: BackoffConfig;
  /** `browse` lists only metrics with data in the last 3 hours (ListMetrics `RecentlyActive`; default true). */
  browseRecentlyActive: boolean;
  /** Most nodes one `browse` call returns (default 500). */
  browseMaxItems: number;
  discover: DiscoverConfig;
}

export const AWS_DEFAULTS = Object.freeze({
  defaultPeriodS: 60,
  defaultStat: 'Average',
  minPollIntervalMs: 60_000,
  alarmPollIntervalMs: 60_000,
  timeoutMs: 10_000,
  maxAttempts: 3,
  backoff: Object.freeze({ initialMs: 2000, maxMs: 300_000, factor: 2, jitter: 0.2 }),
  browseRecentlyActive: true,
  browseMaxItems: 500,
  discoverMaxResources: 1000,
  assumeRoleSessionName: 'holodeck',
  assumeRoleDurationS: 3600,
});

/** Lowest poll interval a config may ask for. */
export const MIN_POLL_INTERVAL_MS = 1000;

/** Secrets a connection may use. All optional: which ones are read depends on `credentials.type`. */
export const AWS_PROVIDER_SECRETS: ProviderSecretSpec[] = [
  {
    key: 'accessKeyId',
    label: 'Access key ID',
    description: 'Credentials type static (or the source identity for assumeRole). Use a read-only principal.',
    optional: true,
  },
  { key: 'secretAccessKey', label: 'Secret access key', description: 'Pairs with the access key ID.', optional: true },
  {
    key: 'sessionToken',
    label: 'Session token',
    description: 'For temporary credentials (STS, IAM Identity Center).',
    optional: true,
  },
  { key: 'externalId', label: 'External ID', description: 'Credentials type assumeRole, when the role requires one.', optional: true },
];

/**
 * Commercial, GovCloud (`us-gov-west-1`) and China (`cn-north-1`) region names.
 * Two-letter area, one or more words, a number.
 */
export const REGION = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
const ROLE_ARN = /^arn:aws(-cn|-us-gov)?:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/;
const SESSION_NAME = /^[\w+=,.@-]{2,64}$/;
/** `<region>:<uuid>`. */
const IDENTITY_POOL_ID = /^([a-z]{2}(-[a-z]+)+-\d{1,2}):[0-9a-f-]{36}$/;
const RESOURCE_TYPE = /^[a-z0-9-]+(:[A-Za-z0-9-]+)?$/;

export class AwsConfigError extends TypeError {
  constructor(readonly details: string[]) {
    super(`aws.cloudwatch config is invalid:\n  ${details.join('\n  ')}`);
    this.name = 'AwsConfigError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const KNOWN_KEYS = new Set([
  'region',
  'regions',
  'credentials',
  'defaultPeriodS',
  'defaultStat',
  'minPollIntervalMs',
  'alarmPollIntervalMs',
  'lookbackS',
  'timeoutMs',
  'maxAttempts',
  'backoff',
  'browseRecentlyActive',
  'browseMaxItems',
  'discover',
]);

/**
 * Names that look like credentials. A document must never carry them, so a
 * config containing one is rejected outright (with a pointer to secrets),
 * rather than silently ignored as an unknown key.
 */
const CREDENTIAL_KEYS = /^(access_?key(_?id)?|secret(_?access_?key)?|session_?token|aws_?(access|secret|session).*|password|token)$/i;

function int(errors: string[], key: string, value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    errors.push(`${key}: must be an integer between ${min} and ${max}`);
    return fallback;
  }
  return value;
}

function unknownKeys(errors: string[], prefix: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (CREDENTIAL_KEYS.test(key)) {
      errors.push(`${prefix}${key}: credentials must not be stored in a document; use the connection's secrets`);
    } else if (!allowed.includes(key)) errors.push(`${prefix}${key}: unknown setting`);
  }
}

function parseCredentials(errors: string[], raw: unknown): AwsCredentialsConfig {
  if (raw === undefined) return { type: 'static' };
  if (!isObj(raw)) {
    errors.push('credentials: must be an object with a type');
    return { type: 'static' };
  }
  switch (raw.type) {
    case 'static':
    case 'host':
      unknownKeys(errors, 'credentials.', raw, ['type']);
      return { type: raw.type };
    case 'assumeRole': {
      unknownKeys(errors, 'credentials.', raw, ['type', 'roleArn', 'sessionName', 'durationS']);
      if (typeof raw.roleArn !== 'string' || !ROLE_ARN.test(raw.roleArn)) {
        errors.push('credentials.roleArn: must be an IAM role ARN (arn:aws:iam::<account>:role/<name>)');
      }
      let sessionName: string = AWS_DEFAULTS.assumeRoleSessionName;
      if (raw.sessionName !== undefined) {
        if (typeof raw.sessionName === 'string' && SESSION_NAME.test(raw.sessionName)) sessionName = raw.sessionName;
        else errors.push('credentials.sessionName: 2–64 characters of [A-Za-z0-9_+=,.@-]');
      }
      // STS accepts 900 s – 12 h (the role's own maximum may be lower).
      const durationS = int(errors, 'credentials.durationS', raw.durationS, AWS_DEFAULTS.assumeRoleDurationS, 900, 43_200);
      return { type: 'assumeRole', roleArn: String(raw.roleArn), sessionName, durationS };
    }
    case 'cognito':
      unknownKeys(errors, 'credentials.', raw, ['type', 'identityPoolId']);
      if (typeof raw.identityPoolId !== 'string' || !IDENTITY_POOL_ID.test(raw.identityPoolId)) {
        errors.push('credentials.identityPoolId: must be <region>:<uuid>');
      }
      return { type: 'cognito', identityPoolId: String(raw.identityPoolId) };
    default:
      errors.push(`credentials.type: must be one of ${CREDENTIAL_TYPES.join(', ')}`);
      return { type: 'static' };
  }
}

function parseDiscover(errors: string[], raw: unknown): DiscoverConfig {
  const out: DiscoverConfig = { maxResources: AWS_DEFAULTS.discoverMaxResources };
  if (raw === undefined) return out;
  if (!isObj(raw)) {
    errors.push('discover: must be an object');
    return out;
  }
  unknownKeys(errors, 'discover.', raw, ['resourceTypes', 'tags', 'maxResources']);
  out.maxResources = int(errors, 'discover.maxResources', raw.maxResources, out.maxResources, 1, 100_000);
  if (raw.resourceTypes !== undefined) {
    // The Tagging API allows at most 100 resource type filters.
    if (
      !Array.isArray(raw.resourceTypes) ||
      raw.resourceTypes.length > 100 ||
      !raw.resourceTypes.every((t) => typeof t === 'string' && RESOURCE_TYPE.test(t))
    ) {
      errors.push('discover.resourceTypes: at most 100 entries such as "ec2:instance" or "s3"');
    } else out.resourceTypes = [...raw.resourceTypes];
  }
  if (raw.tags !== undefined) {
    // GetResources: at most 50 tag filters, 20 values each; keys ≤ 128, values ≤ 256 characters.
    const ok =
      Array.isArray(raw.tags) &&
      raw.tags.length <= 50 &&
      raw.tags.every(
        (t) =>
          isObj(t) &&
          Object.keys(t).every((k) => k === 'key' || k === 'values') &&
          typeof t.key === 'string' &&
          t.key.length >= 1 &&
          t.key.length <= 128 &&
          (t.values === undefined ||
            (Array.isArray(t.values) &&
              t.values.length <= 20 &&
              t.values.every((v) => typeof v === 'string' && v.length <= 256))),
      );
    if (!ok) errors.push('discover.tags: at most 50 entries of { key, values? }');
    else {
      out.tags = (raw.tags as Array<{ key: string; values?: string[] }>).map((t) =>
        t.values ? { key: t.key, values: [...t.values] } : { key: t.key },
      );
    }
  }
  return out;
}

/**
 * Validate and normalise a raw `ProviderConnection.config`. Throws one
 * `AwsConfigError` listing every problem. Unknown keys are errors (typos fail
 * loudly); credential-looking keys are refused with a pointer to secrets.
 */
export function parseAwsConfig(raw: unknown): AwsConnectionConfig {
  const errors: string[] = [];
  if (!isObj(raw)) throw new AwsConfigError(['config: must be an object']);
  unknownKeys(errors, '', raw, [...KNOWN_KEYS]);

  if (typeof raw.region !== 'string' || !REGION.test(raw.region)) errors.push('region: must be an AWS region such as eu-west-1');
  const region = String(raw.region);

  let regions = [region];
  if (raw.regions !== undefined) {
    if (!Array.isArray(raw.regions) || raw.regions.length === 0 || raw.regions.length > 40) {
      errors.push('regions: must be a list of 1–40 regions');
    } else {
      const bad = raw.regions.filter((r) => typeof r !== 'string' || !REGION.test(r));
      if (bad.length) errors.push(`regions: not AWS regions: ${bad.map((r) => JSON.stringify(r)).join(', ')}`);
      // Default region first, no duplicates.
      else regions = [...new Set([region, ...(raw.regions as string[])])];
    }
  }

  const credentials = parseCredentials(errors, raw.credentials);

  let defaultPeriodS: number = AWS_DEFAULTS.defaultPeriodS;
  if (raw.defaultPeriodS !== undefined) {
    if (isValidPeriod(raw.defaultPeriodS)) defaultPeriodS = raw.defaultPeriodS;
    else errors.push('defaultPeriodS: must be 1, 5, 10, 20, 30 or a multiple of 60 (seconds)');
  }
  let defaultStat: string = AWS_DEFAULTS.defaultStat;
  if (raw.defaultStat !== undefined) {
    if (isValidStat(raw.defaultStat)) defaultStat = raw.defaultStat;
    else errors.push('defaultStat: must be a CloudWatch statistic (Average, Sum, Minimum, Maximum, SampleCount, p99, tm90 …)');
  }

  const minPollIntervalMs = int(errors, 'minPollIntervalMs', raw.minPollIntervalMs, AWS_DEFAULTS.minPollIntervalMs, MIN_POLL_INTERVAL_MS, 86_400_000);
  const alarmPollIntervalMs = int(errors, 'alarmPollIntervalMs', raw.alarmPollIntervalMs, AWS_DEFAULTS.alarmPollIntervalMs, MIN_POLL_INTERVAL_MS, 86_400_000);
  const lookbackS = raw.lookbackS === undefined ? undefined : int(errors, 'lookbackS', raw.lookbackS, 900, 60, 15 * 86_400);
  const timeoutMs = int(errors, 'timeoutMs', raw.timeoutMs, AWS_DEFAULTS.timeoutMs, 100, 120_000);
  const maxAttempts = int(errors, 'maxAttempts', raw.maxAttempts, AWS_DEFAULTS.maxAttempts, 1, 10);

  const backoff: BackoffConfig = { ...AWS_DEFAULTS.backoff };
  if (raw.backoff !== undefined) {
    if (!isObj(raw.backoff)) errors.push('backoff: must be an object');
    else {
      unknownKeys(errors, 'backoff.', raw.backoff, ['initialMs', 'maxMs', 'factor', 'jitter']);
      backoff.initialMs = int(errors, 'backoff.initialMs', raw.backoff.initialMs, backoff.initialMs, 1, 86_400_000);
      backoff.maxMs = int(errors, 'backoff.maxMs', raw.backoff.maxMs, backoff.maxMs, 1, 86_400_000);
      const { factor, jitter } = raw.backoff;
      if (factor !== undefined) {
        if (typeof factor === 'number' && factor >= 1 && factor <= 10) backoff.factor = factor;
        else errors.push('backoff.factor: must be a number between 1 and 10');
      }
      if (jitter !== undefined) {
        if (typeof jitter === 'number' && jitter >= 0 && jitter <= 1) backoff.jitter = jitter;
        else errors.push('backoff.jitter: must be a number between 0 and 1');
      }
      if (backoff.maxMs < backoff.initialMs) errors.push('backoff.maxMs: must be ≥ backoff.initialMs');
    }
  }

  let browseRecentlyActive: boolean = AWS_DEFAULTS.browseRecentlyActive;
  if (raw.browseRecentlyActive !== undefined) {
    if (typeof raw.browseRecentlyActive === 'boolean') browseRecentlyActive = raw.browseRecentlyActive;
    else errors.push('browseRecentlyActive: must be a boolean');
  }
  const browseMaxItems = int(errors, 'browseMaxItems', raw.browseMaxItems, AWS_DEFAULTS.browseMaxItems, 1, 10_000);
  const discover = parseDiscover(errors, raw.discover);

  if (errors.length) throw new AwsConfigError(errors);
  const config: AwsConnectionConfig = {
    region,
    regions,
    credentials,
    defaultPeriodS,
    defaultStat,
    minPollIntervalMs,
    alarmPollIntervalMs,
    timeoutMs,
    maxAttempts,
    backoff,
    browseRecentlyActive,
    browseMaxItems,
    discover,
  };
  if (lookbackS !== undefined) config.lookbackS = lookbackS;
  return config;
}

/**
 * CloudWatch periods: 1, 5, 10, 20 and 30 s (high-resolution metrics) or any
 * multiple of 60 s. Capped at 30 days here (far beyond any useful live poll).
 */
export function isValidPeriod(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 30 * 86_400) return false;
  return [1, 5, 10, 20, 30].includes(value) || value % 60 === 0;
}

const BASIC_STATS = new Set(['SampleCount', 'Average', 'Sum', 'Minimum', 'Maximum']);
/**
 * Extended statistics: `p99`, `p99.9`, `p100`, `tm90`, `wm99`, `tc90`, `ts90`,
 * `IQM`, and the range forms `TM(10%:90%)`, `PR(:300)` … (CloudWatch User
 * Guide, "Statistics definitions").
 */
const EXTENDED_STAT = /^(?:(?:p|tm|wm|tc|ts)(?:\d{1,2}(?:\.\d{1,10})?|100)|IQM|(?:TM|WM|TC|TS|PR)\([0-9.%:eE+-]{1,40}\))$/;

export function isValidStat(value: unknown): value is string {
  return typeof value === 'string' && (BASIC_STATS.has(value) || EXTENDED_STAT.test(value));
}

/** JSON Schema of the connection config, for host config forms (`HolodeckProvider.configSchema`). No secrets. */
export const AWS_CONFIG_SCHEMA: Record<string, unknown> = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['region'],
  properties: {
    region: { type: 'string', pattern: REGION.source, description: 'Default region, e.g. eu-west-1.' },
    regions: { type: 'array', items: { type: 'string', pattern: REGION.source }, description: 'Regions browse and discover cover.' },
    credentials: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: { type: { const: 'static' } },
          description: 'Secrets accessKeyId + secretAccessKey (+ sessionToken).',
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'roleArn'],
          properties: {
            type: { const: 'assumeRole' },
            roleArn: { type: 'string', description: 'Read-only role to assume.' },
            sessionName: { type: 'string', default: AWS_DEFAULTS.assumeRoleSessionName },
            durationS: { type: 'integer', minimum: 900, maximum: 43_200, default: AWS_DEFAULTS.assumeRoleDurationS },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'identityPoolId'],
          properties: { type: { const: 'cognito' }, identityPoolId: { type: 'string', description: '<region>:<uuid>' } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: { type: { const: 'host' } },
          description: 'Credentials from the host application.',
        },
      ],
      default: { type: 'static' },
    },
    defaultPeriodS: { type: 'integer', minimum: 1, default: AWS_DEFAULTS.defaultPeriodS },
    defaultStat: { type: 'string', default: AWS_DEFAULTS.defaultStat },
    minPollIntervalMs: { type: 'integer', minimum: MIN_POLL_INTERVAL_MS, default: AWS_DEFAULTS.minPollIntervalMs },
    alarmPollIntervalMs: { type: 'integer', minimum: MIN_POLL_INTERVAL_MS, default: AWS_DEFAULTS.alarmPollIntervalMs },
    lookbackS: { type: 'integer', minimum: 60, maximum: 15 * 86_400 },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 120_000, default: AWS_DEFAULTS.timeoutMs },
    maxAttempts: { type: 'integer', minimum: 1, maximum: 10, default: AWS_DEFAULTS.maxAttempts },
    backoff: {
      type: 'object',
      additionalProperties: false,
      properties: {
        initialMs: { type: 'integer', minimum: 1, default: AWS_DEFAULTS.backoff.initialMs },
        maxMs: { type: 'integer', minimum: 1, default: AWS_DEFAULTS.backoff.maxMs },
        factor: { type: 'number', minimum: 1, maximum: 10, default: AWS_DEFAULTS.backoff.factor },
        jitter: { type: 'number', minimum: 0, maximum: 1, default: AWS_DEFAULTS.backoff.jitter },
      },
    },
    browseRecentlyActive: { type: 'boolean', default: true },
    browseMaxItems: { type: 'integer', minimum: 1, maximum: 10_000, default: AWS_DEFAULTS.browseMaxItems },
    discover: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resourceTypes: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        tags: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['key'],
            properties: { key: { type: 'string' }, values: { type: 'array', items: { type: 'string' }, maxItems: 20 } },
          },
        },
        maxResources: { type: 'integer', minimum: 1, maximum: 100_000, default: AWS_DEFAULTS.discoverMaxResources },
      },
    },
  },
});
