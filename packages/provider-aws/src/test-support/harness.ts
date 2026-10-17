import { createProviderContext, type ProviderSession, type ProviderStatus, type Sample } from '@holodeck/sdk';
import { createAwsProvider, type AwsProviderOptions } from '../provider';
import { createFakeAws, type FakeAws } from './fake-aws';

/** Fake (non-AWS-issued) credentials. Shaped like real ones so redaction is exercised realistically. */
export const FAKE_KEYS = Object.freeze({
  accessKeyId: 'AKIAFAKEFAKEFAKE0001',
  secretAccessKey: 'fakeSecretKey/With+Special=Chars0000000001',
  sessionToken: 'FakeSessionToken//abc+def==',
});

/**
 * Manual timers for the provider's poll schedule. `advance(ms)` fires every
 * timer due within `ms`, in order. The SDK's own internals (retry sleeps,
 * request timeouts) still use real timers, which is fine: the fake backend
 * answers immediately.
 */
export class ManualTimers {
  now = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + Math.max(0, ms), fn });
    return id;
  };
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  /** Delays of the pending timers, relative to now, sorted. */
  pending(): number[] {
    return [...this.timers.values()].map((t) => t.at - this.now).sort((a, b) => a - b);
  }
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const next = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].fn();
      await settle();
    }
    this.now = end;
  }
}

/** Let promise chains (SDK middleware, fake fetch) run to completion. */
export async function settle(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

export async function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

export interface Harness {
  session: ProviderSession;
  fake: FakeAws;
  timers: ManualTimers;
  logs: Array<[string, string]>;
  statuses: ProviderStatus[];
  controller: AbortController;
  /** Every string the provider exposed: log lines, status messages. */
  exposed(): string;
}

export interface ConnectOptions {
  secrets?: Record<string, string | undefined>;
  options?: AwsProviderOptions;
  fake?: FakeAws;
  /** Wall clock for ctx.now() (default: Date.now). */
  now?: () => number;
}

export async function connect(config: Record<string, unknown>, opts: ConnectOptions = {}): Promise<Harness> {
  const fake = opts.fake ?? createFakeAws();
  const timers = new ManualTimers();
  const logs: Array<[string, string]> = [];
  const statuses: ProviderStatus[] = [];
  const controller = new AbortController();
  const secrets = opts.secrets ?? { accessKeyId: FAKE_KEYS.accessKeyId, secretAccessKey: FAKE_KEYS.secretAccessKey };
  const provider = createAwsProvider({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, random: () => 0.5, ...opts.options });
  const session = await provider.connect(
    config,
    createProviderContext({
      connectionId: 'prod',
      signal: controller.signal,
      fetch: fake.fetch,
      now: opts.now ?? (() => Date.now()),
      secret: async (key) => secrets[key],
      log: (level, message, data) => logs.push([level, message + (data === undefined ? '' : ` ${JSON.stringify(data)}`)]),
    }),
  );
  statuses.push(session.status());
  session.onStatus((s) => statuses.push(s));
  return {
    session,
    fake,
    timers,
    logs,
    statuses,
    controller,
    exposed: () => [...logs.map(([, m]) => m), ...statuses.map((s) => s.message ?? '')].join('\n'),
  };
}

/** Collects every delivered sample; `latest(source)` is the newest. */
export function collector() {
  const batches: Sample[][] = [];
  return {
    batches,
    onSamples: (samples: readonly Sample[]) => void batches.push([...samples]),
    all: () => batches.flat(),
    latest: (source: string) => batches.flat().filter((s) => s.source === source).at(-1),
    count: () => batches.length,
  };
}
