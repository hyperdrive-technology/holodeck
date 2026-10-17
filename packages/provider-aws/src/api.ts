/**
 * The CloudWatch / Tagging API calls, with batching and pagination limits:
 *
 * - `GetMetricData`: ≤ 500 queries and ≤ 100,800 datapoints per request
 *   (CloudWatch quotas). Live polls pack queries greedily under both limits.
 * - `DescribeAlarms`: ≤ 100 alarm names per request.
 * - Every paginated call stops at a page cap, so a huge account cannot make one
 *   provider call run unbounded.
 *
 * Every call takes the session's `AbortSignal`, so `close()` cancels requests in flight.
 */

import {
  DescribeAlarmHistoryCommand,
  DescribeAlarmsCommand,
  GetMetricDataCommand,
  ListMetricsCommand,
  type CloudWatchClient,
  type MetricDataQuery,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { GetResourcesCommand, type ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import type { HistoryRange, Sample, SignalValue } from '@holodeck/sdk';
import { isValidPeriod } from './config';
import { AwsProviderError } from './errors';
import type { Dimension, MetricSource } from './source';

/** CloudWatch GetMetricData limits. */
export const MAX_QUERIES_PER_REQUEST = 500;
export const MAX_DATAPOINTS_PER_REQUEST = 100_800;
/** Our own budget per request, a little under the quota. */
const DATAPOINT_BUDGET = 100_000;
/** DescribeAlarms `AlarmNames` limit. */
export const MAX_ALARMS_PER_REQUEST = 100;
/** Most samples `history` returns (same bound as the SDK's sim provider). */
export const MAX_HISTORY_SAMPLES = 100_000;
/** Page caps. */
const MAX_LIVE_PAGES = 5;
const MAX_HISTORY_PAGES = 50;
const MAX_LIST_PAGES = 20;

export interface Latest {
  value: SignalValue;
  ts: number;
  quality?: Sample['quality'];
}

export interface CallOptions {
  abortSignal: AbortSignal;
  now: () => number;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

const metricQuery = (id: string, m: Pick<MetricSource, 'namespace' | 'metricName' | 'dimensions' | 'stat' | 'unit'>, periodS: number): MetricDataQuery => ({
  Id: id,
  ReturnData: true,
  MetricStat: {
    Metric: { Namespace: m.namespace, MetricName: m.metricName, Dimensions: m.dimensions.map((d: Dimension) => ({ Name: d.Name, Value: d.Value })) },
    Period: periodS,
    Stat: m.stat,
    ...(m.unit ? { Unit: m.unit as StandardUnit } : {}),
  },
});

/** Live-poll look-back for one metric (config.ts `lookbackS`). */
export function lookbackSeconds(m: MetricSource, configured: number | undefined): number {
  return Math.max(configured ?? Math.max(900, 5 * m.periodS), m.periodS);
}

/**
 * Pack metrics into GetMetricData batches: ≤ 500 queries and ≤ the datapoint
 * budget each, where a metric costs ⌈window / period⌉ datapoints and a batch's
 * window is its longest member's. A metric whose window alone exceeds the
 * budget gets a shortened window (it still contains many periods).
 */
export function packBatches(metrics: readonly MetricSource[], configuredLookbackS: number | undefined): Array<{ metrics: MetricSource[]; windowS: number }> {
  const items = metrics.map((m) => {
    const window = Math.min(lookbackSeconds(m, configuredLookbackS), DATAPOINT_BUDGET * m.periodS);
    return { m, window };
  });
  // Longest windows first so a batch's window is fixed by its first member.
  items.sort((a, b) => b.window - a.window);
  const batches: Array<{ metrics: MetricSource[]; windowS: number }> = [];
  let current: { metrics: MetricSource[]; windowS: number; points: number } | undefined;
  for (const { m, window } of items) {
    const cost = (w: number) => Math.ceil(w / m.periodS);
    if (!current || current.metrics.length >= MAX_QUERIES_PER_REQUEST || current.points + cost(current.windowS) > DATAPOINT_BUDGET) {
      current = { metrics: [], windowS: window, points: 0 };
      batches.push(current);
    }
    current.metrics.push(m);
    current.points += cost(current.windowS);
  }
  return batches.map(({ metrics: ms, windowS }) => ({ metrics: ms, windowS }));
}

/**
 * Newest datapoint of every metric (keyed by `MetricSource.key`). A metric
 * with no datapoint in its window is `null` / `uncertain` (no data is normal
 * for idle resources); a per-metric `Forbidden` / `InternalError` is `bad`.
 */
export async function fetchLatest(
  client: CloudWatchClient,
  metrics: readonly MetricSource[],
  configuredLookbackS: number | undefined,
  opts: CallOptions,
): Promise<Map<string, Latest>> {
  const unique = [...new Map(metrics.map((m) => [m.key, m])).values()];
  const out = new Map<string, Latest>();
  for (const batch of packBatches(unique, configuredLookbackS)) {
    const now = opts.now();
    const byId = new Map(batch.metrics.map((m, i) => [`m${i}`, m]));
    const queries = batch.metrics.map((m, i) => metricQuery(`m${i}`, m, m.periodS));
    let nextToken: string | undefined;
    const statusById = new Map<string, string | undefined>();
    for (let page = 0; page < MAX_LIVE_PAGES; page++) {
      const res = await client.send(
        new GetMetricDataCommand({
          MetricDataQueries: queries,
          StartTime: new Date(now - batch.windowS * 1000),
          EndTime: new Date(now),
          ScanBy: 'TimestampDescending',
          NextToken: nextToken,
        }),
        { abortSignal: opts.abortSignal },
      );
      for (const r of res.MetricDataResults ?? []) {
        const m = r.Id ? byId.get(r.Id) : undefined;
        if (!m || out.has(m.key)) continue;
        statusById.set(r.Id as string, r.StatusCode);
        // Descending scan: the first value is the newest. Pick the max timestamp anyway, in case a page is unordered.
        const ts = r.Timestamps ?? [];
        const vs = r.Values ?? [];
        let best = -1;
        for (let i = 0; i < Math.min(ts.length, vs.length); i++) {
          const t = (ts[i] as Date).getTime();
          if (Number.isFinite(t) && Number.isFinite(vs[i]) && (best < 0 || t > (ts[best] as Date).getTime())) best = i;
        }
        if (best >= 0) out.set(m.key, { value: vs[best] as number, ts: (ts[best] as Date).getTime() });
      }
      for (const msg of res.Messages ?? []) opts.log('debug', `GetMetricData: ${msg.Code ?? ''} ${msg.Value ?? ''}`.trim());
      nextToken = res.NextToken;
      if (!nextToken || batch.metrics.every((m) => out.has(m.key))) break;
    }
    for (const [id, m] of byId) {
      if (out.has(m.key)) continue;
      const status = statusById.get(id);
      out.set(m.key, { value: null, ts: now, quality: status === 'Forbidden' || status === 'InternalError' ? 'bad' : 'uncertain' });
    }
  }
  return out;
}

/** State (`OK` | `ALARM` | `INSUFFICIENT_DATA`) of each alarm, keyed by name; missing alarms are absent. */
export async function fetchAlarmStates(client: CloudWatchClient, names: readonly string[], opts: CallOptions): Promise<Map<string, string>> {
  const unique = [...new Set(names)];
  const out = new Map<string, string>();
  for (let i = 0; i < unique.length; i += MAX_ALARMS_PER_REQUEST) {
    const chunk = unique.slice(i, i + MAX_ALARMS_PER_REQUEST);
    let nextToken: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const res = await client.send(
        new DescribeAlarmsCommand({ AlarmNames: chunk, AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, NextToken: nextToken }),
        { abortSignal: opts.abortSignal },
      );
      for (const a of [...(res.MetricAlarms ?? []), ...(res.CompositeAlarms ?? [])]) {
        if (a.AlarmName && a.StateValue) out.set(a.AlarmName, a.StateValue);
      }
      nextToken = res.NextToken;
      if (!nextToken) break;
    }
  }
  return out;
}

/** Valid CloudWatch period ≥ `seconds`: 1, 5, 10, 20, 30, then multiples of 60. */
export function ceilPeriod(seconds: number): number {
  const s = Math.max(1, Math.ceil(seconds));
  for (const p of [1, 5, 10, 20, 30]) if (s <= p) return p;
  return Math.ceil(s / 60) * 60;
}

/**
 * Period for a history query: the requested step (never finer than the
 * source's own period, which defines what one value means, e.g. a 5-minute
 * Sum), coarsened to what CloudWatch retains for data that old (< 60 s data
 * for 3 h, 1 min for 15 days, 5 min for 63 days, then 1 h) and so that the
 * range fits `MAX_HISTORY_SAMPLES`.
 */
export function historyPeriod(range: HistoryRange, sourcePeriodS: number, now: number): number {
  const stepS = range.stepMs !== undefined && range.stepMs > 0 ? range.stepMs / 1000 : 0;
  let p = Math.max(sourcePeriodS, stepS);
  const spanS = Math.max(0, (range.to - range.from) / 1000);
  p = Math.max(p, spanS / MAX_HISTORY_SAMPLES);
  // CloudWatch only answers with periods that are a multiple of the retention
  // tier of the data's age (holodeck#146): otherwise it returns no datapoints.
  const ageS = (now - range.from) / 1000;
  const tier = ageS > 63 * 86_400 ? 3600 : ageS > 15 * 86_400 ? 300 : ageS > 3 * 3600 ? 60 : 1;
  let out = tier === 1 ? ceilPeriod(p) : Math.ceil(p / tier) * tier;
  // Periods above 30 days are not useful; stay on the tier grid below the cap.
  const max = Math.floor((30 * 86_400) / Math.max(tier, 60)) * Math.max(tier, 60);
  if (out > max) out = max;
  return isValidPeriod(out) ? out : ceilPeriod(out);
}

/** Metric samples in [from, to], oldest first. */
export async function fetchMetricHistory(client: CloudWatchClient, m: MetricSource, range: HistoryRange, opts: CallOptions): Promise<Sample[]> {
  const periodS = historyPeriod(range, m.periodS, opts.now());
  const out: Sample[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES && out.length < MAX_HISTORY_SAMPLES; page++) {
    const res = await client.send(
      new GetMetricDataCommand({
        MetricDataQueries: [metricQuery('h0', m, periodS)],
        StartTime: new Date(range.from),
        EndTime: new Date(range.to),
        ScanBy: 'TimestampAscending',
        NextToken: nextToken,
      }),
      { abortSignal: opts.abortSignal },
    );
    for (const r of res.MetricDataResults ?? []) {
      if (r.Id !== 'h0') continue;
      // A 200 response can still fail per metric (holodeck#148): surface it,
      // so a chart can tell "no access / AWS error" from "no data".
      if (r.StatusCode === 'Forbidden' || r.StatusCode === 'InternalError') {
        const detail = [...(r.Messages ?? []), ...(res.Messages ?? [])].map((msg) => `${msg.Code ?? ''} ${msg.Value ?? ''}`.trim()).filter(Boolean)[0];
        throw new AwsProviderError(
          `metric ${m.namespace}/${m.metricName}: ${r.StatusCode}${detail ? ` (${detail})` : ''}`,
          r.StatusCode === 'Forbidden' ? 'auth' : 'aws',
          r.StatusCode,
        );
      }
      const ts = r.Timestamps ?? [];
      const vs = r.Values ?? [];
      for (let i = 0; i < Math.min(ts.length, vs.length); i++) {
        const t = (ts[i] as Date).getTime();
        if (Number.isFinite(t) && Number.isFinite(vs[i])) out.push({ source: m.source, value: vs[i] as number, ts: t });
      }
    }
    nextToken = res.NextToken;
    if (!nextToken) break;
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(0, MAX_HISTORY_SAMPLES);
}

/** The new state of a `StateUpdate` history item (`HistoryData` JSON, falling back to the summary text). */
export function stateFromHistory(data: string | undefined, summary: string | undefined): string | undefined {
  if (data) {
    try {
      const parsed = JSON.parse(data) as { newState?: { stateValue?: unknown } };
      if (typeof parsed?.newState?.stateValue === 'string') return parsed.newState.stateValue;
    } catch {
      /* fall through to the summary */
    }
  }
  const m = summary ? /\bto (OK|ALARM|INSUFFICIENT_DATA)\b/.exec(summary) : null;
  return m?.[1];
}

/** Alarm state changes in [from, to], oldest first. */
export async function fetchAlarmHistory(client: CloudWatchClient, source: string, alarmName: string, range: HistoryRange, opts: CallOptions): Promise<Sample[]> {
  const out: Sample[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_HISTORY_PAGES && out.length < MAX_HISTORY_SAMPLES; page++) {
    const res = await client.send(
      new DescribeAlarmHistoryCommand({
        AlarmName: alarmName,
        HistoryItemType: 'StateUpdate',
        StartDate: new Date(range.from),
        EndDate: new Date(range.to),
        ScanBy: 'TimestampAscending',
        MaxRecords: 100,
        NextToken: nextToken,
      }),
      { abortSignal: opts.abortSignal },
    );
    for (const item of res.AlarmHistoryItems ?? []) {
      const ts = item.Timestamp?.getTime();
      const state = stateFromHistory(item.HistoryData, item.HistorySummary);
      if (ts !== undefined && Number.isFinite(ts) && state) out.push({ source, value: state, ts });
    }
    nextToken = res.NextToken;
    if (!nextToken) break;
  }
  out.sort((a, b) => a.ts - b.ts);
  return out.slice(0, MAX_HISTORY_SAMPLES);
}

export interface ListedMetric {
  namespace: string;
  metricName: string;
  dimensions: Dimension[];
}

/** ListMetrics, paginated up to `maxItems` results / the page cap. `truncated` when more exist. */
export async function listMetrics(
  client: CloudWatchClient,
  filter: { namespace?: string; metricName?: string; recentlyActive: boolean },
  maxItems: number,
  opts: CallOptions,
  /** Stop early once this many distinct keys were seen (namespace / metric-name listings). */
  distinct?: (m: ListedMetric) => string,
): Promise<{ metrics: ListedMetric[]; truncated: boolean }> {
  const out: ListedMetric[] = [];
  const seen = new Set<string>();
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await client.send(
      new ListMetricsCommand({
        Namespace: filter.namespace,
        MetricName: filter.metricName,
        RecentlyActive: filter.recentlyActive ? 'PT3H' : undefined,
        NextToken: nextToken,
      }),
      { abortSignal: opts.abortSignal },
    );
    for (const raw of res.Metrics ?? []) {
      if (!raw.Namespace || !raw.MetricName) continue;
      const m: ListedMetric = {
        namespace: raw.Namespace,
        metricName: raw.MetricName,
        dimensions: (raw.Dimensions ?? []).filter((d) => d.Name && d.Value).map((d) => ({ Name: d.Name as string, Value: d.Value as string })),
      };
      out.push(m);
      if (distinct) seen.add(distinct(m));
      if ((distinct ? seen.size : out.length) >= maxItems) return { metrics: out, truncated: Boolean(res.NextToken) };
    }
    nextToken = res.NextToken;
    if (!nextToken) return { metrics: out, truncated: false };
  }
  return { metrics: out, truncated: true };
}

/** DescribeAlarms (all alarms of a region), names and states, up to `maxItems`. */
export async function listAlarms(
  client: CloudWatchClient,
  maxItems: number,
  opts: CallOptions,
): Promise<{ alarms: Array<{ name: string; state?: string; description?: string; metric?: string }>; truncated: boolean }> {
  const out: Array<{ name: string; state?: string; description?: string; metric?: string }> = [];
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const res = await client.send(
      new DescribeAlarmsCommand({ AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], MaxRecords: 100, NextToken: nextToken }),
      { abortSignal: opts.abortSignal },
    );
    for (const a of res.MetricAlarms ?? []) {
      if (a.AlarmName) out.push({ name: a.AlarmName, state: a.StateValue, description: a.AlarmDescription, metric: a.MetricName });
    }
    for (const a of res.CompositeAlarms ?? []) {
      if (a.AlarmName) out.push({ name: a.AlarmName, state: a.StateValue, description: a.AlarmDescription });
    }
    if (out.length >= maxItems) return { alarms: out.slice(0, maxItems), truncated: true };
    nextToken = res.NextToken;
    if (!nextToken) return { alarms: out, truncated: false };
  }
  return { alarms: out, truncated: true };
}

/** GetResources (Resource Groups Tagging API), up to `maxItems`. */
export async function getTaggedResources(
  client: ResourceGroupsTaggingAPIClient,
  filter: { resourceTypes?: string[]; tags?: Array<{ key: string; values?: string[] }> },
  maxItems: number,
  opts: CallOptions,
): Promise<{ resources: Array<{ ResourceARN?: string; Tags?: Array<{ Key?: string; Value?: string }> }>; truncated: boolean }> {
  const out: Array<{ ResourceARN?: string; Tags?: Array<{ Key?: string; Value?: string }> }> = [];
  let token: string | undefined;
  // GetResources pages hold ≤ 100 resources; allow enough pages for maxItems.
  const maxPages = Math.ceil(maxItems / 100) + 1;
  for (let page = 0; page < maxPages; page++) {
    const res = await client.send(
      new GetResourcesCommand({
        ResourcesPerPage: 100,
        PaginationToken: token,
        ResourceTypeFilters: filter.resourceTypes,
        TagFilters: filter.tags?.map((t) => (t.values ? { Key: t.key, Values: t.values } : { Key: t.key })),
      }),
      { abortSignal: opts.abortSignal },
    );
    out.push(...(res.ResourceTagMappingList ?? []));
    if (out.length >= maxItems) return { resources: out.slice(0, maxItems), truncated: true };
    // GetResources signals the last page with an empty token.
    token = res.PaginationToken || undefined;
    if (!token) return { resources: out, truncated: false };
  }
  return { resources: out, truncated: true };
}
