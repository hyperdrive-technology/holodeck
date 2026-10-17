# @holodeck/provider-aws

`aws.cloudwatch`: live AWS CloudWatch data for Holodeck documents. Objects bind their colour, label, height … to
CloudWatch metrics and alarm states, chart widgets read metric history, a picker browses namespaces, metrics and
dimensions, and `discover` lists the account's resources with a suggested part and metric binding each. It is
Holodeck's equivalent of Arcentry's CloudWatch plugin (`docs/ARCENTRY_PARITY.md`, lane P1).

- **Capabilities:** `subscribe`, `read`, `history`, `browse`, `discover` (no `write`: the provider is read-only).
- **Credentials:** connection secrets (a read-only access key, or temporary credentials with a session token), an
  assumed read-only role, a Cognito identity pool, or a host callback. Never stored in documents, never logged.
- **AWS SDK v3 modular clients** (`@aws-sdk/client-cloudwatch`, `client-resource-groups-tagging-api`, `client-sts`,
  `client-cognito-identity`). Pure TypeScript, ESM only, no React; runs in browsers and Node ≥ 22.

Contract: `@holodeck/sdk` `docs/PACKAGING.md` §6.

## Install into a host

```ts
import { HolodeckHost } from '@holodeck/sdk';
import manifest from '@holodeck/provider-aws/holodeck.package.json';
import awsProviderPackage from '@holodeck/provider-aws/holodeck-package';

const host = new HolodeckHost({ name: 'studio' });
await host.installPackage(manifest, awsProviderPackage);

const hub = host.createProviderHub({ secret: (connectionId, key) => vault.get(connectionId, key) });
hub.setConnections([{ id: 'prod', provider: 'aws.cloudwatch', config: { region: 'eu-west-1' } }]);
hub.setBindings([
  { objectId: 'web1', param: 'label', binding: { connection: 'prod',
    source: 'cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-0abc',
    transform: { kind: 'format', template: '{value} %', digits: 0 } } },
  { objectId: 'web1', param: 'color', binding: { connection: 'prod', source: 'alarm:eu-west-1/web-cpu-high',
    transform: { kind: 'map', cases: { ALARM: '#e74c3c', OK: '#2ecc71' }, default: '#bdc3c7' } } },
]);
```

Hosts that supply credentials themselves, or `@holodeck/assets-aws`'s part map, build their own module:

```ts
import { createAwsProviderPackage } from '@holodeck/provider-aws';
const pkg = createAwsProviderPackage({ credentials: async ({ connectionId, region }) => broker.get(connectionId), partHints });
await host.installPackage(pkg.manifest, pkg);
```

## Sources

```
cloudwatch:<region>/<Namespace>/<MetricName>[?<Dimension>=<value>&…&stat=<stat>&period=<seconds>&unit=<Unit>]
alarm:<region>/<AlarmName>
```

| Source | Value |
|---|---|
| `cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-0abc` | newest `Average` over 60 s periods |
| `cloudwatch:/AWS/SQS/ApproximateNumberOfMessagesVisible?QueueName=jobs&stat=Maximum&period=300` | empty region = the connection's `region` |
| `cloudwatch:us-east-1/AWS/ApplicationELB/TargetResponseTime?LoadBalancer=app%2Fweb%2F50dc&stat=p99` | `%2F` for a `/` inside a value |
| `alarm:eu-west-1/web-cpu-high` | `"OK"`, `"ALARM"` or `"INSUFFICIENT_DATA"` |

- The namespace may contain `/`; the metric name is the last path segment. Names and values are percent-decoded
  (`%2F`, `%3F`, `%26`, `%3D`); `+` is a literal plus.
- `stat`: `Average` (default, or `defaultStat`), `Sum`, `Minimum`, `Maximum`, `SampleCount`, or an extended statistic
  (`p99`, `p99.9`, `tm90`, `IQM`, `TM(10%:90%)` …). `period`: 1, 5, 10, 20, 30 or a multiple of 60 seconds (default 60,
  or `defaultPeriodS`). `unit`: a CloudWatch unit. A dimension whose name is `stat`, `period` or `unit` is written
  `dim.stat=…`.
- A metric with no datapoint in the look-back window gives `{ value: null, quality: 'uncertain' }` (idle resources
  often publish nothing). A per-metric `Forbidden`, an alarm that does not exist, or an unparsable source gives
  `quality: 'bad'`.

## Polling, batching and rate limits

- **The poll period comes from the source:** a metric is polled once per `period`, never faster than
  `minPollIntervalMs` (default 60 s; polling faster only re-reads the same datapoint, and every metric in a
  `GetMetricData` call is billed). Alarms are polled every `alarmPollIntervalMs` (default 60 s).
- Sources are grouped by (kind, region, interval). Each group makes one request per tick however many objects
  bind to it: `GetMetricData` with up to 500 queries and under 100,000 datapoints per request, `DescribeAlarms`
  with up to 100 names.
- Each live poll looks back `max(900 s, 5 × period)` (`lookbackS` overrides it) and takes the newest datapoint,
  because CloudWatch publishes most AWS metrics a few minutes late.
- The SDK retries throttling and transient errors itself (`maxAttempts`, standard retry mode). When a poll still
  fails, the group backs off exponentially (`backoff`); a **throttled** poll never retries sooner than its normal
  interval. Status goes `error` (never had data) or `stale` (had data; last values are kept) and back to `live`.

## History, browse, discover

- `history(source, { from, to, stepMs })` returns a metric series (oldest first) or an alarm's state changes
  (`DescribeAlarmHistory`). The period is `max(stepMs, source period)`, coarsened to what CloudWatch keeps for data
  that old (< 60 s data for 3 h, 1 min for 15 days, 5 min for 63 days, then 1 h) and to at most 100,000 samples.
- `browse()`: regions (`regions`, default `[region]`) → **Alarms** + namespaces → metric names → one leaf per
  dimension set, each with a bindable `source`. Only metrics with data in the last 3 hours are listed
  (`browseRecentlyActive`), at most `browseMaxItems` per level.
- `discover()` uses the Resource Groups Tagging API (`GetResources`) in every region in `regions`. Each resource
  has `key` = ARN, `kind` = `aws.<service>.<type>` (`aws.ec2.instance`), `partHint` (A2's map via `partHints`, else
  `DEFAULT_PART_HINTS`) and, for common services, `bindings.metric` (EC2/RDS/ECS CPU, Lambda invocations, SQS
  queue depth, ALB requests …) or `bindings.state` for alarms. Filters: `discover.resourceTypes`,
  `discover.tags`, `discover.maxResources`. AWS limitation: the Tagging API lists only resources that have (or
  once had) a tag.

## Credentials

| `credentials.type` | Needs | Notes |
|---|---|---|
| `static` (default) | secrets `accessKeyId`, `secretAccessKey`, optional `sessionToken` | long-lived keys of a read-only principal, or temporary credentials |
| `assumeRole` | `roleArn` (+ `sessionName`, `durationS`); static secrets or the host callback as the source identity; optional secret `externalId` | STS `AssumeRole` at the regional endpoint, refreshed before expiry |
| `cognito` | `identityPoolId` | unauthenticated identities; the pool's role grants read access |
| `host` | `AwsProviderOptions.credentials` callback | SSO, a token broker, … |

A minimal read-only policy:

```json
{ "Version": "2012-10-17", "Statement": [{ "Effect": "Allow", "Resource": "*", "Action": [
  "cloudwatch:GetMetricData", "cloudwatch:ListMetrics", "cloudwatch:DescribeAlarms",
  "cloudwatch:DescribeAlarmHistory", "tag:GetResources" ] }] }
```

**Secret hygiene.** Credentials are read through `ProviderContext.secret` when the session connects (temporary
ones when they are issued), kept in memory for the session only, and never written anywhere. A config with a
credential-looking key (`accessKeyId`, `secretAccessKey`, `sessionToken` …) is rejected. Every log line and status
message is redacted where it is emitted, and every thrown error is rebuilt at one exit point with credentials
(and their URL / RFC 3986 encodings) replaced by `***` and no SDK metadata attached. `secrets.property.test.ts`
checks this for every credential type against a backend that echoes credentials into every error.

**Network.** Every AWS request goes through `ProviderContext.fetch`, so a host's network policy applies. The
provider declares `origins` (CloudWatch, Tagging, STS, Cognito Identity, in commercial, GovCloud and China
partitions), the manifest lists the same `permissions.network`, and any other origin is refused before a request
is sent. Redirects are refused.

## Connection config

Non-secret settings only (stored in the document); `AWS_CONFIG_SCHEMA` is the JSON Schema, and unknown keys are
errors.

| Key | Default | |
|---|---|---|
| `region` | required | default region for sources and the first browse/discover region |
| `regions` | `[region]` | regions for browse and discover |
| `credentials` | `{ type: 'static' }` | see above |
| `defaultPeriodS` / `defaultStat` | `60` / `Average` | for sources without `period` / `stat` |
| `minPollIntervalMs` / `alarmPollIntervalMs` | `60000` / `60000` | minimum 1000 |
| `lookbackS` | `max(900, 5 × period)` | live-poll window |
| `timeoutMs` / `maxAttempts` | `10000` / `3` | per request; SDK attempts |
| `backoff` | `{ initialMs: 2000, maxMs: 300000, factor: 2, jitter: 0.2 }` | between failed polls |
| `browseRecentlyActive` / `browseMaxItems` | `true` / `500` | |
| `discover` | `{ maxResources: 1000 }` | plus `resourceTypes`, `tags` |

## Development

```sh
pnpm install
pnpm type-check
pnpm exec vitest run   # real AWS SDK against an in-process fake backend; the global fetch throws
pnpm build && pnpm smoke   # dist smoke, Holodeck package install + read, browser bundle check
```

Tests never call AWS and need no credentials: `src/test-support/fake-aws.ts` answers the SDK's actual wire
protocols (AWS JSON 1.0/1.1, awsQuery for STS) behind `ProviderContext.fetch`, so serialisation, SigV4 signing (with
fake keys), retries and error parsing all run for real.

Not yet supported: metric math expressions (`expr:` sources), Metrics Insights queries, cross-account
observability, the ISO partitions.
