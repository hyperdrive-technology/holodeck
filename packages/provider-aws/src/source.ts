/**
 * Source syntax of `aws.cloudwatch` (PACKAGING.md §6.1 examples):
 *
 *   cloudwatch:<region>/<namespace>/<metric>[?<dimension>=<value>&…&stat=<stat>&period=<s>&unit=<unit>]
 *   alarm:<region>/<alarm name>
 *
 *   cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-0abc&stat=Average
 *   cloudwatch:/AWS/SQS/ApproximateNumberOfMessagesVisible?QueueName=jobs&period=300   (connection region)
 *   alarm:eu-west-1/web-cpu-high
 *
 * - The namespace may contain `/` (`AWS/ApplicationELB`); the metric name is
 *   the last path segment. Every part is percent-decoded, so a `/`, `?`, `&`
 *   or `=` inside a name or value is written `%2F`, `%3F`, `%26`, `%3D`.
 *   `+` is a literal plus, not a space.
 * - `stat`, `period` and `unit` are reserved query keys. A dimension with one
 *   of those names (or any name) can be written `dim.<name>=<value>`.
 * - An alarm name is everything after the region (it may contain `/`).
 *
 * Browse paths are a separate, provider-internal grammar (`region:`,
 * `namespace:`, `metric:`, `alarms:`), see `parseBrowsePath`.
 */

import { isValidPeriod, isValidStat, REGION } from './config';

export const CLOUDWATCH_SOURCE_SYNTAX =
  'cloudwatch:<region>/<Namespace>/<MetricName>[?<Dim>=<value>&stat=<Average|Sum|p99…>&period=<s>&unit=<Unit>] | ' +
  'alarm:<region>/<AlarmName> — e.g. cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-0abc, alarm:eu-west-1/web-cpu-high';

/** Longest source string accepted (bounded parsing work per source). */
export const MAX_SOURCE_LENGTH = 4096;
/** CloudWatch allows at most 30 dimensions per metric. */
export const MAX_DIMENSIONS = 30;

export class SourceSyntaxError extends TypeError {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = 'SourceSyntaxError';
  }
}

export interface Dimension {
  Name: string;
  Value: string;
}

export interface MetricSource {
  kind: 'metric';
  /** The string as written (samples carry it back verbatim). */
  source: string;
  /** Resolved region (`''` in the source = the connection's default region). */
  region: string;
  namespace: string;
  metricName: string;
  dimensions: Dimension[];
  stat: string;
  periodS: number;
  unit?: string;
  /** Identity for de-duplication and caching: the canonical form of everything above. */
  key: string;
}

export interface AlarmSource {
  kind: 'alarm';
  source: string;
  region: string;
  alarmName: string;
  key: string;
}

export type ParsedSource = MetricSource | AlarmSource;

export interface SourceDefaults {
  region: string;
  periodS: number;
  stat: string;
}

/** CloudWatch `StandardUnit` values. */
export const CLOUDWATCH_UNITS = new Set([
  'Seconds',
  'Microseconds',
  'Milliseconds',
  'Bytes',
  'Kilobytes',
  'Megabytes',
  'Gigabytes',
  'Terabytes',
  'Bits',
  'Kilobits',
  'Megabits',
  'Gigabits',
  'Terabits',
  'Percent',
  'Count',
  'Bytes/Second',
  'Kilobytes/Second',
  'Megabytes/Second',
  'Gigabytes/Second',
  'Terabytes/Second',
  'Bits/Second',
  'Kilobits/Second',
  'Megabits/Second',
  'Gigabits/Second',
  'Terabits/Second',
  'Count/Second',
  'None',
]);

/** CloudWatch name limits: namespace ≤ 255, metric ≤ 255, dimension name ≤ 255, value ≤ 1024, alarm ≤ 255. */
const NAMESPACE = /^[\w.\-/#][\w.\-/#: ]{0,254}$/;

function decode(part: string, source: string, what: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new SourceSyntaxError(`${what} "${part.slice(0, 80)}" has a malformed %-escape`, source);
  }
}

/** Percent-encode a name or value for a source (`/`, `?`, `&`, `=`, `%`, `#` and controls). */
export function encodePart(value: string): string {
  return value.replace(/[%/?&=#\s\u0000-\u001f\u007f]/g, (c) => encodeURIComponent(c));
}

function regionOf(raw: string, source: string, defaults: SourceDefaults): string {
  if (raw === '') return defaults.region;
  if (!REGION.test(raw)) throw new SourceSyntaxError(`"${raw.slice(0, 40)}" is not an AWS region`, source);
  return raw;
}

function metricKey(m: Omit<MetricSource, 'key' | 'source' | 'kind'>): string {
  // Dimension order does not matter to CloudWatch, so it does not to the key either.
  const dims = [...m.dimensions].sort((a, b) => (a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0));
  return JSON.stringify(['m', m.region, m.namespace, m.metricName, dims.map((d) => [d.Name, d.Value]), m.stat, m.periodS, m.unit ?? null]);
}

/** Parse one source. Throws `SourceSyntaxError` with a user-facing message. */
export function parseSource(source: string, defaults: SourceDefaults): ParsedSource {
  if (typeof source !== 'string') throw new SourceSyntaxError('source must be a string', String(source));
  if (source.length > MAX_SOURCE_LENGTH) throw new SourceSyntaxError(`source is longer than ${MAX_SOURCE_LENGTH} characters`, source);
  if (source.startsWith('alarm:')) return parseAlarm(source, defaults);
  if (source.startsWith('cloudwatch:')) return parseMetric(source, defaults);
  throw new SourceSyntaxError('source must start with "cloudwatch:" or "alarm:"', source);
}

function parseAlarm(source: string, defaults: SourceDefaults): AlarmSource {
  const rest = source.slice('alarm:'.length);
  const slash = rest.indexOf('/');
  if (slash < 0) throw new SourceSyntaxError('alarm source needs a region and a name: alarm:<region>/<name>', source);
  const region = regionOf(rest.slice(0, slash), source, defaults);
  const alarmName = decode(rest.slice(slash + 1), source, 'alarm name');
  if (alarmName === '' || alarmName.length > 255) throw new SourceSyntaxError('alarm name must be 1–255 characters', source);
  return { kind: 'alarm', source, region, alarmName, key: JSON.stringify(['a', region, alarmName]) };
}

function parseMetric(source: string, defaults: SourceDefaults): MetricSource {
  const rest = source.slice('cloudwatch:'.length);
  const q = rest.indexOf('?');
  const path = q < 0 ? rest : rest.slice(0, q);
  const query = q < 0 ? '' : rest.slice(q + 1);
  const segments = path.split('/');
  if (segments.length < 3) {
    throw new SourceSyntaxError('metric source needs a region, namespace and metric: cloudwatch:<region>/<Namespace>/<Metric>', source);
  }
  const region = regionOf(segments[0] as string, source, defaults);
  const metricName = decode(segments[segments.length - 1] as string, source, 'metric name');
  const nsParts = segments.slice(1, -1);
  if (nsParts.some((p) => p === '')) throw new SourceSyntaxError('namespace has an empty segment', source);
  const namespace = nsParts.map((p) => decode(p, source, 'namespace')).join('/');
  if (!NAMESPACE.test(namespace)) {
    throw new SourceSyntaxError(`namespace "${namespace.slice(0, 80)}" is not a CloudWatch namespace`, source);
  }
  if (metricName === '' || metricName.length > 255) throw new SourceSyntaxError('metric name must be 1–255 characters', source);

  let stat = defaults.stat;
  let periodS = defaults.periodS;
  let unit: string | undefined;
  const dimensions: Dimension[] = [];
  const seenKeys = new Set<string>();
  if (query !== '') {
    for (const pair of query.split('&')) {
      if (pair === '') continue;
      const eq = pair.indexOf('=');
      if (eq < 0) throw new SourceSyntaxError(`query part "${pair.slice(0, 80)}" needs "="`, source);
      const rawKey = decode(pair.slice(0, eq), source, 'query key');
      const value = decode(pair.slice(eq + 1), source, 'query value');
      if (seenKeys.has(rawKey)) throw new SourceSyntaxError(`"${rawKey.slice(0, 80)}" appears twice`, source);
      seenKeys.add(rawKey);
      if (rawKey === 'stat') {
        if (!isValidStat(value)) throw new SourceSyntaxError(`stat "${String(value).slice(0, 40)}" is not a CloudWatch statistic`, source);
        stat = value;
      } else if (rawKey === 'period') {
        const n = /^\d{1,7}$/.test(value) ? Number(value) : NaN;
        if (!isValidPeriod(n)) throw new SourceSyntaxError('period must be 1, 5, 10, 20, 30 or a multiple of 60 (seconds)', source);
        periodS = n;
      } else if (rawKey === 'unit') {
        if (!CLOUDWATCH_UNITS.has(value)) throw new SourceSyntaxError(`unit "${value.slice(0, 40)}" is not a CloudWatch unit`, source);
        unit = value;
      } else {
        const name = rawKey.startsWith('dim.') ? rawKey.slice(4) : rawKey;
        if (name === '' || name.length > 255) throw new SourceSyntaxError('dimension names must be 1–255 characters', source);
        if (value === '' || value.length > 1024) throw new SourceSyntaxError(`dimension "${name.slice(0, 80)}" needs a value of 1–1024 characters`, source);
        if (dimensions.some((d) => d.Name === name)) throw new SourceSyntaxError(`dimension "${name.slice(0, 80)}" appears twice`, source);
        dimensions.push({ Name: name, Value: value });
      }
    }
  }
  if (dimensions.length > MAX_DIMENSIONS) throw new SourceSyntaxError(`at most ${MAX_DIMENSIONS} dimensions`, source);
  const parsed = { region, namespace, metricName, dimensions, stat, periodS, unit };
  const out: MetricSource = { kind: 'metric', source, ...parsed, key: metricKey(parsed) };
  if (unit === undefined) delete out.unit;
  return out;
}

const RESERVED = new Set(['stat', 'period', 'unit']);

/**
 * Format a metric source. `region` `''` writes the connection-region form.
 * `stat` / `period` / `unit` are written only when given.
 */
export function formatMetricSource(m: {
  region: string;
  namespace: string;
  metricName: string;
  dimensions?: readonly Dimension[];
  stat?: string;
  periodS?: number;
  unit?: string;
}): string {
  const ns = m.namespace.split('/').map(encodePart).join('/');
  let out = `cloudwatch:${m.region}/${ns}/${encodePart(m.metricName)}`;
  const query: string[] = [];
  for (const d of m.dimensions ?? []) {
    const name = RESERVED.has(d.Name) || d.Name.startsWith('dim.') ? `dim.${d.Name}` : d.Name;
    query.push(`${encodePart(name)}=${encodePart(d.Value)}`);
  }
  if (m.stat !== undefined) query.push(`stat=${encodePart(m.stat)}`);
  if (m.periodS !== undefined) query.push(`period=${m.periodS}`);
  if (m.unit !== undefined) query.push(`unit=${encodePart(m.unit)}`);
  if (query.length) out += `?${query.join('&')}`;
  return out;
}

export function formatAlarmSource(region: string, alarmName: string): string {
  return `alarm:${region}/${encodePart(alarmName)}`;
}

// -----------------------------------------------------------------------------
// Browse paths
// -----------------------------------------------------------------------------

export type BrowsePath =
  | { level: 'root' }
  | { level: 'region'; region: string }
  | { level: 'alarms'; region: string }
  | { level: 'namespace'; region: string; namespace: string }
  | { level: 'metric'; region: string; namespace: string; metricName: string };

/**
 *   ''                                   regions
 *   region:<r>                           "Alarms" + namespaces of r
 *   alarms:<r>                           alarm leaves
 *   namespace:<r>/<enc ns>               metric names (namespace encoded as ONE segment)
 *   metric:<r>/<enc ns>/<enc metric>     one leaf per dimension combination
 *
 * Returns undefined for a path this provider did not produce.
 */
export function parseBrowsePath(path: string | undefined): BrowsePath | undefined {
  if (path === undefined || path === '') return { level: 'root' };
  if (typeof path !== 'string' || path.length > MAX_SOURCE_LENGTH) return undefined;
  const colon = path.indexOf(':');
  if (colon < 0) return undefined;
  const prefix = path.slice(0, colon);
  const parts = path.slice(colon + 1).split('/');
  const region = parts[0] as string;
  if (!REGION.test(region)) return undefined;
  try {
    if (prefix === 'region' && parts.length === 1) return { level: 'region', region };
    if (prefix === 'alarms' && parts.length === 1) return { level: 'alarms', region };
    if (prefix === 'namespace' && parts.length === 2 && parts[1]) {
      return { level: 'namespace', region, namespace: decodeURIComponent(parts[1]) };
    }
    if (prefix === 'metric' && parts.length === 3 && parts[1] && parts[2]) {
      return { level: 'metric', region, namespace: decodeURIComponent(parts[1]), metricName: decodeURIComponent(parts[2]) };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function formatBrowsePath(p: BrowsePath): string {
  switch (p.level) {
    case 'root':
      return '';
    case 'region':
      return `region:${p.region}`;
    case 'alarms':
      return `alarms:${p.region}`;
    case 'namespace':
      return `namespace:${p.region}/${encodeURIComponent(p.namespace)}`;
    case 'metric':
      return `metric:${p.region}/${encodeURIComponent(p.namespace)}/${encodeURIComponent(p.metricName)}`;
  }
}
