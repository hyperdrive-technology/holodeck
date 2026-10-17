import { createProviderContext, type ProviderSession, type ProviderStatus, type Sample } from '@holodeck/sdk';
import { createHttpProvider, type HttpProviderOptions } from '../provider';

export interface Harness {
  session: ProviderSession;
  logs: Array<[string, string]>;
  statuses: ProviderStatus[];
  controller: AbortController;
  /** Every string the provider exposed: log lines, status messages. */
  exposed(): string;
}

export async function connect(
  config: Record<string, unknown>,
  { secrets = {}, options = {} }: { secrets?: Record<string, string>; options?: HttpProviderOptions } = {},
): Promise<Harness> {
  const logs: Array<[string, string]> = [];
  const statuses: ProviderStatus[] = [];
  const controller = new AbortController();
  const provider = createHttpProvider(options);
  const session = await provider.connect(
    config,
    createProviderContext({
      signal: controller.signal,
      secret: async (key) => secrets[key],
      log: (level, message, data) => logs.push([level, message + (data === undefined ? '' : ` ${JSON.stringify(data)}`)]),
    }),
  );
  statuses.push(session.status());
  session.onStatus((s) => statuses.push(s));
  return {
    session,
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
