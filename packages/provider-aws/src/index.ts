/**
 * @holodeck/provider-aws: the `aws.cloudwatch` provider (README.md; contract:
 * @holodeck/sdk docs/PACKAGING.md §6). Pure TypeScript, no React; runs in
 * browsers and Node ≥ 22 on the AWS SDK v3 modular clients.
 */

export { AWS_PROVIDER_ID, createAwsProvider, type AwsProviderOptions } from './provider';
export {
  AWS_CONFIG_SCHEMA,
  AWS_DEFAULTS,
  AWS_PROVIDER_SECRETS,
  AwsConfigError,
  CREDENTIAL_TYPES,
  isValidPeriod,
  isValidStat,
  MIN_POLL_INTERVAL_MS,
  parseAwsConfig,
  type AwsConnectionConfig,
  type AwsCredentialsConfig,
  type BackoffConfig,
  type DiscoverConfig,
} from './config';
export {
  CLOUDWATCH_SOURCE_SYNTAX,
  CLOUDWATCH_UNITS,
  formatAlarmSource,
  formatBrowsePath,
  formatMetricSource,
  MAX_DIMENSIONS,
  MAX_SOURCE_LENGTH,
  parseBrowsePath,
  parseSource,
  SourceSyntaxError,
  type AlarmSource,
  type BrowsePath,
  type Dimension,
  type MetricSource,
  type ParsedSource,
  type SourceDefaults,
} from './source';
export { ceilPeriod, historyPeriod, MAX_ALARMS_PER_REQUEST, MAX_HISTORY_SAMPLES, MAX_QUERIES_PER_REQUEST, packBatches } from './api';
export { DEFAULT_PART_HINTS, parseArn, resourceKind, toDiscoveredResource, type Arn, type PartHints } from './discovery';
export { AWS_ORIGINS, type AwsCredentialCallback, type AwsCredentialRequest } from './clients';
export { AwsProviderError, type AwsFailureKind } from './errors';
export { backoffDelay } from './backoff';
export { REDACTED } from './redact';
export {
  AWS_PACKAGE_MANIFEST,
  awsProviderPackage,
  createAwsProviderExtension,
  createAwsProviderPackage,
  type AwsProviderPackage,
} from './holodeck-package';
