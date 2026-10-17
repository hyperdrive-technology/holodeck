/**
 * `aws.cloudwatch`: live CloudWatch metrics and alarm states for Holodeck
 * documents (README.md; contract: @holodeck/sdk docs/PACKAGING.md §6). This
 * is Holodeck's equivalent of Arcentry's CloudWatch plugin.
 *
 *   subscribe  metric sources polled with GetMetricData (batched), alarm sources with DescribeAlarms
 *   read       one-shot fetch of the same
 *   history    GetMetricData time series / DescribeAlarmHistory state changes (chart widget)
 *   browse     regions → namespaces → metrics → dimension sets; regions → alarms
 *   discover   Resource Groups Tagging API → DiscoveredResource (partHint + suggested bindings)
 *
 * Polling: sources are grouped by (kind, region, poll interval). A metric's
 * interval is its own `period` (from the source), floored at
 * `minPollIntervalMs`; alarms use `alarmPollIntervalMs`. Each group has one
 * timer and makes one batched request per tick, however many subscriptions
 * share it. A failed poll backs off exponentially; a throttled poll never
 * retries faster than its normal interval.
 */

import {
  type DiscoveredResource,
  type HistoryRange,
  type HolodeckProvider,
  type ProviderContext,
  type ProviderSession,
  type ProviderStatus,
  type Sample,
  type SignalNode,
} from '@holodeck/sdk';
import {
  fetchAlarmHistory,
  fetchAlarmStates,
  fetchLatest,
  fetchMetricHistory,
  getTaggedResources,
  listAlarms,
  listMetrics,
  type CallOptions,
  type Latest,
} from './api';
import { backoffDelay } from './backoff';
import { AWS_ORIGINS, createClients, createRequestHandler, resolveCredentials, type AwsCredentialCallback, type AwsClients } from './clients';
import { AWS_CONFIG_SCHEMA, AWS_PROVIDER_SECRETS, parseAwsConfig, type AwsConnectionConfig } from './config';
import { toDiscoveredResource, type PartHints } from './discovery';
import { AwsProviderError, redactError, toProviderError } from './errors';
import { createRedactor, errorMessage, type Redactor } from './redact';
import {
  CLOUDWATCH_SOURCE_SYNTAX,
  formatAlarmSource,
  formatBrowsePath,
  formatMetricSource,
  parseBrowsePath,
  parseSource,
  type AlarmSource,
  type MetricSource,
  type ParsedSource,
  type SourceDefaults,
} from './source';

export const AWS_PROVIDER_ID = 'aws.cloudwatch';

/**
 * Largest delay `setTimeout` honours: browsers and Node store it as a signed
 * 32-bit integer and treat anything larger as 1 ms (holodeck#145).
 */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;
/** Longest poll interval: a metric with a longer period is still re-read daily. */
export const MAX_POLL_INTERVAL_MS = 86_400_000;

/** Most cached "current values" kept for initial deliveries. */
const MAX_CACHED_VALUES = 10_000;

export interface AwsProviderOptions {
  /**
   * Host credential callback, for `credentials.type: "host"` (and as the
   * source identity of `assumeRole` without static secrets). Never called for
   * other types.
   */
  credentials?: AwsCredentialCallback;
  /**
   * Kind → part id map (or a function) for `discover`'s `partHint`. Pass
   * `@holodeck/assets-aws`'s map here; it wins over `DEFAULT_PART_HINTS`.
   */
  partHints?: PartHints;
  /** Timer functions (default: the globals, looked up at call time so fake timers work). */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Random source for backoff jitter (default `Math.random`). */
  random?: () => number;
}

type GroupState = 'connecting' | 'live' | 'stale' | 'error';

interface Subscription {
  /** Group key → this subscription's parsed sources in that group. */
  byGroup: Map<string, ParsedSource[]>;
  deliver(samples: Sample[]): void;
}

interface PollGroup {
  key: string;
  kind: 'metric' | 'alarm';
  region: string;
  intervalMs: number;
  subs: Set<Subscription>;
  timer?: unknown;
  scheduled: boolean;
  inFlight: boolean;
  again: boolean;
  failures: number;
  everLive: boolean;
  state: GroupState;
  message?: string;
}

export function createAwsProvider(options: AwsProviderOptions = {}): HolodeckProvider {
  return {
    id: AWS_PROVIDER_ID,
    label: 'AWS CloudWatch',
    description: 'CloudWatch metrics and alarm states, metric history, metric browsing and resource discovery.',
    capabilities: { read: true, browse: true, history: true, discover: true },
    sourceSyntax: CLOUDWATCH_SOURCE_SYNTAX,
    configSchema: AWS_CONFIG_SCHEMA,
    secrets: AWS_PROVIDER_SECRETS.map((s) => ({ ...s })),
    origins: [...AWS_ORIGINS],
    connect: (config, ctx) => connectAws(config, ctx, options),
  };
}

/**
 * Single exit point for errors (same design as provider-http, holodeck#89):
 * every error `connect` or a session method throws is rebuilt by
 * `redactError`, so a credential that reached a message by any path never
 * leaves the provider. Logs and status messages are redacted where they are
 * emitted (`log`, `setStatus`).
 */
async function connectAws(rawConfig: Record<string, unknown>, ctx: ProviderContext, options: AwsProviderOptions): Promise<ProviderSession> {
  const redact = createRedactor();
  try {
    return guardSession(await openSession(rawConfig, ctx, options, redact), redact);
  } catch (error) {
    throw redactError(error, redact);
  }
}

/** Wrap every promise-returning session method so its rejections are redacted. */
function guardSession(session: ProviderSession, redact: Redactor): ProviderSession {
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        throw redactError(error, redact);
      }
    };
  const guarded: ProviderSession = { ...session };
  if (session.read) guarded.read = guard(session.read);
  if (session.browse) guarded.browse = guard(session.browse);
  if (session.history) guarded.history = guard(session.history);
  if (session.discover) guarded.discover = guard(session.discover);
  guarded.close = guard(session.close);
  return guarded;
}

/** Bounded insertion-ordered map: the oldest key goes first. */
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

async function openSession(
  rawConfig: Record<string, unknown>,
  ctx: ProviderContext,
  options: AwsProviderOptions,
  redact: Redactor,
): Promise<ProviderSession> {
  const config: AwsConnectionConfig = parseAwsConfig(rawConfig);
  const handler = createRequestHandler(ctx, AWS_ORIGINS, config.timeoutMs);
  const controller = new AbortController();
  const resolved = await resolveCredentials(
    { config, ctx, redact, origins: AWS_ORIGINS, hostCredentials: options.credentials, signal: controller.signal },
    handler,
  );
  const clients: AwsClients = createClients(config, handler, resolved.credentials);
  const defaults: SourceDefaults = { region: config.region, periodS: config.defaultPeriodS, stat: config.defaultStat };

  const setTimer = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const random = options.random ?? Math.random;

  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => {
    try {
      ctx.log(level, redact(message));
    } catch {
      /* a host logger must not break the provider */
    }
  };
  const call: CallOptions = { abortSignal: controller.signal, now: () => ctx.now(), log };

  const statusListeners = new Set<(s: ProviderStatus) => void>();
  const groups = new Map<string, PollGroup>();
  const values = new Map<string, Latest>();
  const subscriptions = new Set<() => void>();
  let status: ProviderStatus = { state: 'live', message: 'idle', since: ctx.now() };
  let closed = false;

  const emitStatus = () => {
    for (const listener of [...statusListeners]) {
      try {
        listener(status);
      } catch (error) {
        log('error', `aws.cloudwatch status listener threw: ${errorMessage(error)}`);
      }
    }
  };
  const setStatus = (state: ProviderStatus['state'], message?: string) => {
    const msg = message === undefined ? undefined : redact(message);
    if (status.state === state && status.message === msg) return;
    status = msg === undefined ? { state, since: ctx.now() } : { state, message: msg, since: ctx.now() };
    emitStatus();
  };

  /** Session status = the worst group state (error > stale > connecting > live). */
  const recomputeStatus = () => {
    if (closed) return;
    if (groups.size === 0) {
      setStatus('live', 'idle');
      return;
    }
    const rank: Record<GroupState, number> = { live: 0, connecting: 1, stale: 2, error: 3 };
    let worst: PollGroup | undefined;
    for (const g of groups.values()) if (!worst || rank[g.state] > rank[worst.state]) worst = g;
    const w = worst as PollGroup;
    setStatus(w.state, w.message === undefined ? undefined : groups.size > 1 ? `${w.kind}s ${w.region}: ${w.message}` : w.message);
  };

  const ensureOpen = (method: string) => {
    if (closed) throw new AwsProviderError(`aws.cloudwatch: ${method}() on a closed session`, 'closed');
  };

  const groupFor = (p: ParsedSource): { key: string; kind: PollGroup['kind']; intervalMs: number } => {
    if (p.kind === 'alarm') return { key: `alarm|${p.region}|${config.alarmPollIntervalMs}`, kind: 'alarm', intervalMs: config.alarmPollIntervalMs };
    // "Poll period from the source": a metric is polled once per period, never faster than the floor.
    // Capped at a day (holodeck#145): a 30-day period would otherwise exceed the
    // setTimeout limit and poll every millisecond.
    const intervalMs = Math.min(MAX_POLL_INTERVAL_MS, Math.max(p.periodS * 1000, config.minPollIntervalMs));
    return { key: `metric|${p.region}|${intervalMs}`, kind: 'metric', intervalMs };
  };

  /** Parse sources; unparsable ones become `bad` samples (and a warning). */
  const parseAll = (sources: readonly string[]) => {
    const parsed: ParsedSource[] = [];
    const invalid: Sample[] = [];
    const ts = ctx.now();
    for (const source of sources) {
      try {
        parsed.push(parseSource(source, defaults));
      } catch (error) {
        log('warn', `aws.cloudwatch: source "${String(source).slice(0, 200)}" ignored: ${errorMessage(error)}`);
        invalid.push({ source: String(source), value: null, ts, quality: 'bad' });
      }
    }
    return { parsed, invalid };
  };

  const toSample = (p: ParsedSource, v: Latest): Sample => (v.quality ? { source: p.source, value: v.value, ts: v.ts, quality: v.quality } : { source: p.source, value: v.value, ts: v.ts });

  /** Fetch current values for parsed sources of one kind + region. */
  const fetchValues = async (kind: PollGroup['kind'], region: string, members: readonly ParsedSource[]): Promise<Map<string, Latest>> => {
    const client = clients.cloudwatch(region);
    if (kind === 'metric') return fetchLatest(client, members as MetricSource[], config.lookbackS, call);
    const alarms = members as AlarmSource[];
    const states = await fetchAlarmStates(client, alarms.map((a) => a.alarmName), call);
    const now = ctx.now();
    const out = new Map<string, Latest>();
    for (const a of alarms) {
      const state = states.get(a.alarmName);
      // An alarm that does not exist (deleted, misspelt, other region) is `bad`.
      out.set(a.key, state === undefined ? { value: null, ts: now, quality: 'bad' } : { value: state, ts: now });
    }
    return out;
  };

  const deliverGroup = (group: PollGroup, only?: ReadonlySet<string>) => {
    for (const sub of [...group.subs]) {
      if (!group.subs.has(sub)) continue; // unsubscribed by an earlier callback
      const samples: Sample[] = [];
      for (const p of sub.byGroup.get(group.key) ?? []) {
        if (only && !only.has(p.key)) continue;
        const v = values.get(p.key);
        if (v) samples.push(toSample(p, v));
      }
      if (samples.length) sub.deliver(samples);
    }
  };

  const schedule = (group: PollGroup, delayMs: number) => {
    if (closed || groups.get(group.key) !== group) return;
    if (group.timer !== undefined) clearTimer(group.timer);
    // Belt and braces: no delay (interval, backoff) may exceed what setTimeout honours.
    const safe = Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Number.isFinite(delayMs) ? delayMs : MAX_POLL_INTERVAL_MS));
    group.timer = setTimer(() => {
      group.timer = undefined;
      void poll(group);
    }, safe);
  };

  const poll = async (group: PollGroup): Promise<void> => {
    if (closed || groups.get(group.key) !== group) return;
    if (group.inFlight) {
      group.again = true;
      return;
    }
    const members = [...new Map([...group.subs].flatMap((s) => s.byGroup.get(group.key) ?? []).map((p) => [p.key, p])).values()];
    if (members.length === 0) return;
    group.inFlight = true;
    group.again = false;
    let delay = group.intervalMs;
    try {
      const result = await fetchValues(group.kind, group.region, members);
      if (closed || groups.get(group.key) !== group) return;
      for (const [key, v] of result) setBounded(values, key, v, MAX_CACHED_VALUES);
      group.failures = 0;
      group.everLive = true;
      group.state = 'live';
      group.message = undefined;
      recomputeStatus();
      deliverGroup(group);
    } catch (error) {
      if (closed || groups.get(group.key) !== group) return;
      const err = toProviderError(error, group.kind === 'metric' ? 'GetMetricData' : 'DescribeAlarms', group.region, redact);
      group.failures++;
      const backoff = backoffDelay(group.failures, config.backoff, random);
      // Throttled: slow down, never speed up. Other failures retry sooner, but no sooner than the backoff.
      delay = err.kind === 'throttled' ? Math.max(group.intervalMs, backoff) : Math.min(group.intervalMs, backoff);
      log('warn', `aws.cloudwatch: ${err.message}; retrying in ${delay} ms`);
      group.state = group.everLive ? 'stale' : 'error';
      group.message = `${err.message}; retrying in ${delay} ms`;
      recomputeStatus();
      // Sources that never had a value get one `bad` sample, so bindings show the failure.
      const fresh = new Set<string>();
      const now = ctx.now();
      for (const p of members) {
        if (!values.has(p.key)) {
          setBounded(values, p.key, { value: null, ts: now, quality: 'bad' }, MAX_CACHED_VALUES);
          fresh.add(p.key);
        }
      }
      if (fresh.size) deliverGroup(group, fresh);
    } finally {
      group.inFlight = false;
    }
    if (group.again) pollSoon(group);
    else schedule(group, delay);
  };

  /** Poll now (coalesced: many subscribes in one tick make one request). */
  const pollSoon = (group: PollGroup) => {
    if (group.inFlight) {
      group.again = true;
      return;
    }
    if (group.scheduled) return;
    group.scheduled = true;
    if (group.timer !== undefined) {
      clearTimer(group.timer);
      group.timer = undefined;
    }
    queueMicrotask(() => {
      group.scheduled = false;
      void poll(group);
    });
  };

  const session: ProviderSession = {
    status: () => status,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    subscribe(sources, onSamples) {
      if (closed) return () => {};
      const { parsed, invalid } = parseAll([...sources]);
      let active = true;
      const sub: Subscription = {
        byGroup: new Map(),
        deliver(samples) {
          if (!active || closed) return;
          try {
            onSamples(samples);
          } catch (error) {
            log('error', `aws.cloudwatch subscriber threw: ${errorMessage(error)}`);
          }
        },
      };
      for (const p of parsed) {
        const g = groupFor(p);
        const list = sub.byGroup.get(g.key) ?? [];
        list.push(p);
        sub.byGroup.set(g.key, list);
      }
      const initial: Sample[] = [...invalid];
      for (const [key, list] of sub.byGroup) {
        let group = groups.get(key);
        if (!group) {
          const g = groupFor(list[0] as ParsedSource);
          group = {
            key,
            kind: g.kind,
            region: (list[0] as ParsedSource).region,
            intervalMs: g.intervalMs,
            subs: new Set(),
            scheduled: false,
            inFlight: false,
            again: false,
            failures: 0,
            everLive: false,
            state: 'connecting',
          };
          groups.set(key, group);
        }
        group.subs.add(sub);
        // First delivery includes current values when we have them; anything new is fetched now.
        let missing = false;
        for (const p of list) {
          const v = values.get(p.key);
          if (v) initial.push(toSample(p, v));
          else missing = true;
        }
        if (missing || (group.timer === undefined && !group.inFlight)) pollSoon(group);
      }
      recomputeStatus();
      if (initial.length) queueMicrotask(() => sub.deliver(initial));

      const stop = () => {
        if (!active) return;
        active = false;
        subscriptions.delete(stop);
        for (const key of sub.byGroup.keys()) {
          const group = groups.get(key);
          if (!group) continue;
          group.subs.delete(sub);
          if (group.subs.size === 0) {
            if (group.timer !== undefined) clearTimer(group.timer);
            group.timer = undefined;
            groups.delete(key);
          }
        }
        recomputeStatus();
      };
      subscriptions.add(stop);
      return stop;
    },

    async read(sources) {
      ensureOpen('read');
      const { parsed, invalid } = parseAll([...sources]);
      const out: Sample[] = [...invalid];
      const byTarget = new Map<string, ParsedSource[]>();
      for (const p of parsed) {
        const key = `${p.kind}|${p.region}`;
        byTarget.set(key, [...(byTarget.get(key) ?? []), p]);
      }
      await Promise.all(
        [...byTarget.values()].map(async (list) => {
          const { kind, region } = list[0] as ParsedSource;
          try {
            const result = await fetchValues(kind, region, list);
            for (const p of list) {
              const v = result.get(p.key) ?? { value: null, ts: ctx.now(), quality: 'uncertain' as const };
              setBounded(values, p.key, v, MAX_CACHED_VALUES);
              out.push(toSample(p, v));
            }
          } catch (error) {
            const err = toProviderError(error, kind === 'metric' ? 'GetMetricData' : 'DescribeAlarms', region, redact);
            log('warn', `aws.cloudwatch read failed: ${err.message}`);
            const ts = ctx.now();
            for (const p of list) out.push({ source: p.source, value: null, ts, quality: 'bad' });
          }
        }),
      );
      // Same order as requested.
      const order = new Map(sources.map((s, i) => [s, i]));
      return out.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
    },

    async history(source: string, range: HistoryRange) {
      ensureOpen('history');
      if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to)) throw new RangeError('history range: from and to must be finite');
      if (!(range.to >= range.from)) throw new RangeError('history range: to must be ≥ from');
      if (range.stepMs !== undefined && !(Number.isFinite(range.stepMs) && range.stepMs >= 0)) {
        throw new RangeError('history range: stepMs must be a non-negative number');
      }
      const p = parseSource(source, defaults);
      const client = clients.cloudwatch(p.region);
      try {
        return p.kind === 'metric' ? await fetchMetricHistory(client, p, range, call) : await fetchAlarmHistory(client, p.source, p.alarmName, range, call);
      } catch (error) {
        throw toProviderError(error, p.kind === 'metric' ? 'GetMetricData' : 'DescribeAlarmHistory', p.region, redact);
      }
    },

    async browse(path?: string): Promise<SignalNode[]> {
      ensureOpen('browse');
      const at = parseBrowsePath(path);
      if (!at) return [];
      const max = config.browseMaxItems;
      try {
        switch (at.level) {
          case 'root':
            return config.regions.map((region) => ({ path: formatBrowsePath({ level: 'region', region }), label: region, hasChildren: true }));
          case 'region': {
            const { metrics, truncated } = await listMetrics(
              clients.cloudwatch(at.region),
              { recentlyActive: config.browseRecentlyActive },
              max,
              call,
              (m) => m.namespace,
            );
            const namespaces = [...new Set(metrics.map((m) => m.namespace))].sort().slice(0, Math.max(0, max - 1));
            const nodes: SignalNode[] = [
              { path: formatBrowsePath({ level: 'alarms', region: at.region }), label: 'Alarms', hasChildren: true, description: 'CloudWatch alarm states' },
              ...namespaces.map((namespace) => ({ path: formatBrowsePath({ level: 'namespace', region: at.region, namespace }), label: namespace, hasChildren: true })),
            ];
            if (truncated) log('info', `aws.cloudwatch browse ${at.region}: namespace list truncated at ${max}`);
            return nodes;
          }
          case 'namespace': {
            const { metrics } = await listMetrics(
              clients.cloudwatch(at.region),
              { namespace: at.namespace, recentlyActive: config.browseRecentlyActive },
              max,
              call,
              (m) => m.metricName,
            );
            return [...new Set(metrics.map((m) => m.metricName))]
              .sort()
              .slice(0, max)
              .map((metricName) => ({
                path: formatBrowsePath({ level: 'metric', region: at.region, namespace: at.namespace, metricName }),
                label: metricName,
                hasChildren: true,
              }));
          }
          case 'metric': {
            const { metrics } = await listMetrics(
              clients.cloudwatch(at.region),
              { namespace: at.namespace, metricName: at.metricName, recentlyActive: config.browseRecentlyActive },
              max,
              call,
            );
            const seen = new Set<string>();
            const nodes: SignalNode[] = [];
            for (const m of metrics) {
              const source = formatMetricSource({ region: at.region, namespace: m.namespace, metricName: m.metricName, dimensions: m.dimensions });
              if (seen.has(source)) continue;
              seen.add(source);
              const label = m.dimensions.length ? m.dimensions.map((d) => `${d.Name}=${d.Value}`).join(', ') : '(no dimensions)';
              nodes.push({ path: source, label, source, type: 'number', writable: false });
            }
            return nodes.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)).slice(0, max);
          }
          case 'alarms': {
            const { alarms } = await listAlarms(clients.cloudwatch(at.region), max, call);
            return alarms.map((a): SignalNode => {
              const source = formatAlarmSource(at.region, a.name);
              const node: SignalNode = { path: source, label: a.name, source, type: 'string', writable: false };
              const description = a.description ?? (a.metric ? `alarm on ${a.metric}` : undefined);
              if (description) node.description = description;
              return node;
            });
          }
        }
      } catch (error) {
        throw toProviderError(error, at.level === 'alarms' ? 'DescribeAlarms' : 'ListMetrics', 'region' in at ? at.region : config.region, redact);
      }
    },

    async discover(): Promise<DiscoveredResource[]> {
      ensureOpen('discover');
      const out: DiscoveredResource[] = [];
      const seen = new Set<string>();
      for (const region of config.regions) {
        const remaining = config.discover.maxResources - out.length;
        if (remaining <= 0) break;
        let resources: Awaited<ReturnType<typeof getTaggedResources>>['resources'];
        try {
          ({ resources } = await getTaggedResources(
            clients.tagging(region),
            { resourceTypes: config.discover.resourceTypes, tags: config.discover.tags },
            remaining,
            call,
          ));
        } catch (error) {
          throw toProviderError(error, 'GetResources', region, redact);
        }
        for (const item of resources) {
          const resource = toDiscoveredResource(item, region, options.partHints);
          // Global resources (S3, CloudFront, IAM) can be returned by several regions.
          if (!resource || seen.has(resource.key)) continue;
          seen.add(resource.key);
          out.push(resource);
        }
      }
      return out.slice(0, config.discover.maxResources);
    },

    async close() {
      if (closed) return;
      closed = true;
      for (const stop of [...subscriptions]) stop();
      for (const group of groups.values()) if (group.timer !== undefined) clearTimer(group.timer);
      groups.clear();
      controller.abort();
      clients.destroy();
      resolved.destroy();
      // `closed` already set, so set the status directly.
      status = { state: 'disconnected', since: ctx.now() };
      emitStatus();
    },
  };

  if (ctx.signal.aborted) await session.close();
  else ctx.signal.addEventListener('abort', () => void session.close(), { once: true });
  return session;
}
