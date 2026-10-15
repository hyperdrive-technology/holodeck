/**
 * Shared fixtures for this package's tests (not exported from the package).
 * Small generic blocks stand in for the logic library (lane F3).
 */

import {
  ContributionRegistry,
  type HolodeckDocument,
  type HolodeckEngine,
  type HolodeckProvider,
  type ProviderConnection,
  type ProviderSession,
  type ProviderStatus,
  type Sample,
} from '@holodeck/sdk';
import { FLOW_BLOCK_KIND, type FlowBlockDefinition } from './block';
import { collectFlowBindings, FLOW_ENGINE_API_VERSION, FLOW_ENGINE_ID, validateFlowBody } from './engine';
import { flowGraphFormat, type FlowGraphBody, type FlowGraphNode, type FlowGraphWire } from './graph';
import type { FlowValue } from './values';

export const andBlock: FlowBlockDefinition = {
  id: 'test.and',
  label: 'AND',
  category: 'Test',
  inputs: [{ name: 'in', type: 'bool', variadic: true, min: 2, max: 8, default: true }],
  outputs: [{ name: 'out', type: 'bool' }],
  evaluate: ({ inputs }) => ({ outputs: { out: (inputs.in as readonly FlowValue[]).every((v) => v === true) } }),
};

export const notBlock: FlowBlockDefinition = {
  id: 'test.not',
  label: 'NOT',
  category: 'Test',
  inputs: [{ name: 'in', type: 'bool' }],
  outputs: [{ name: 'out', type: 'bool' }],
  evaluate: ({ inputs }) => ({ outputs: { out: !inputs.in } }),
};

export const addBlock: FlowBlockDefinition = {
  id: 'test.add',
  label: 'Add',
  category: 'Test',
  inputs: [
    { name: 'a', type: 'number' },
    { name: 'b', type: 'number' },
  ],
  outputs: [{ name: 'sum', type: 'number' }],
  evaluate: ({ inputs }) => ({ outputs: { sum: (inputs.a as number) + (inputs.b as number) } }),
};

/** Counts scans while `enable` is true; state `{ n }`. */
export const counterBlock: FlowBlockDefinition<{ n: number }> = {
  id: 'test.counter',
  label: 'Counter',
  category: 'Test',
  inputs: [{ name: 'enable', type: 'bool', default: true }],
  outputs: [{ name: 'count', type: 'number' }],
  params: { start: { type: 'number', default: 0, integer: true, min: 0 } },
  initialState: (params) => ({ n: params.start as number }),
  evaluate: ({ inputs, state }) => {
    const n = inputs.enable ? state.n + 1 : state.n;
    return { outputs: { count: n }, state: { n } };
  },
};

/** Echoes its `any` input as a string and a number (exercises conversion). */
export const probeBlock: FlowBlockDefinition = {
  id: 'test.probe',
  label: 'Probe',
  category: 'Test',
  inputs: [
    { name: 'b', type: 'bool' },
    { name: 'n', type: 'number' },
    { name: 's', type: 'string' },
    { name: 'x', type: 'any' },
  ],
  outputs: [
    { name: 'b', type: 'bool' },
    { name: 'n', type: 'number' },
    { name: 's', type: 'string' },
    { name: 'x', type: 'any' },
  ],
  evaluate: ({ inputs }) => ({ outputs: { b: inputs.b as boolean, n: inputs.n as number, s: inputs.s as string, x: inputs.x as FlowValue } }),
};

/** Outputs whatever its `mode` param asks for, including invalid things. */
export const misbehaveBlock: FlowBlockDefinition = {
  id: 'test.misbehave',
  label: 'Misbehave',
  category: 'Test',
  inputs: [{ name: 'trigger', type: 'bool' }],
  outputs: [{ name: 'out', type: 'number' }],
  params: { mode: { type: 'string', default: 'ok' } },
  evaluate: ({ inputs, params }) => {
    if (!inputs.trigger) return { outputs: { out: 1 } };
    switch (params.mode) {
      case 'throw':
        throw new Error('boom');
      case 'nan':
        return { outputs: { out: Number.NaN } };
      case 'string':
        return { outputs: { out: 'x' as unknown as number } };
      case 'unknown':
        return { outputs: { other: 1 } };
      case 'promise':
        return Promise.reject(new Error('async')) as never;
      case 'none':
        return undefined as never;
      default:
        return { outputs: { out: 2 } };
    }
  },
};

export const TEST_BLOCKS: readonly FlowBlockDefinition[] = [andBlock, notBlock, addBlock, counterBlock as FlowBlockDefinition, probeBlock, misbehaveBlock];

/** A registry with the block kind registered and `blocks` installed. */
export function registryWith(blocks: readonly FlowBlockDefinition[] = TEST_BLOCKS): ContributionRegistry {
  const registry = new ContributionRegistry();
  registry.registerKind(FLOW_BLOCK_KIND);
  if (blocks.length) registry.install({ id: 'test.blocks', version: '1.0.0', contributions: { [FLOW_BLOCK_KIND.kind]: [...blocks] } });
  return registry;
}

export function node(id: string, block: string, params?: Record<string, FlowValue>, extra: Partial<FlowGraphNode> = {}): FlowGraphNode {
  return { id, block, ...(params ? { params } : {}), position: { x: 0, y: 0 }, ...extra };
}

/** `wire('w', 'a.out', 'b.in1')`: ends are `node.port` (split at the last dot). */
export function wire(id: string, from: string, to: string): FlowGraphWire {
  const end = (s: string) => ({ node: s.slice(0, s.lastIndexOf('.')), port: s.slice(s.lastIndexOf('.') + 1) });
  return { id, from: end(from), to: end(to) };
}

export function graph(nodes: FlowGraphNode[], wires: FlowGraphWire[] = []): FlowGraphBody {
  return { nodes, wires };
}

export function flowDoc(body: unknown, connections: ProviderConnection[] = [], extra: Partial<HolodeckDocument> = {}): HolodeckDocument {
  return { format: 'holodeck.document.v1', id: 'doc', name: 'Test flow', engine: 'holodeck.flow', engineVersion: '1.0.0', connections, body, ...extra };
}

/** Manual clock. */
export function clock(start = 1_000_000): { now: () => number; advance(ms: number): void; set(t: number): void } {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(next) {
      t = next;
    },
  };
}

/** What lane F2 registers (minus the React kinds), built from this package's helpers. */
export const standInFlowEngine: HolodeckEngine<FlowGraphBody> = Object.freeze({
  id: FLOW_ENGINE_ID,
  label: 'Holodeck flow (test stand-in)',
  apiVersion: FLOW_ENGINE_API_VERSION,
  documentFormat: flowGraphFormat,
  kinds: [FLOW_BLOCK_KIND],
  validateBody: (body: unknown) => validateFlowBody(body),
  collectBindings: (body: FlowGraphBody) => collectFlowBindings(body),
});

/** A provider whose sessions we can drive by hand: status, deliveries, subscription count. */
export function controllableProvider(
  id = 'test.ctl',
  options: {
    writes?: Array<{ source: string; value: unknown }>;
    /** Delivered synchronously to every new subscriber, like a provider's value cache. */
    cached?: () => readonly Sample[] | undefined;
  } = {},
) {
  const sessions: Array<{
    session: ProviderSession;
    subscribers: Set<(samples: readonly Sample[]) => void>;
    setStatus(state: ProviderStatus['state']): void;
    deliver(samples: unknown): void;
    closed: boolean;
  }> = [];
  const provider: HolodeckProvider = {
    id,
    label: 'Controllable',
    capabilities: {},
    async connect() {
      const subscribers = new Set<(samples: readonly Sample[]) => void>();
      const listeners = new Set<(s: ProviderStatus) => void>();
      let status: ProviderStatus = { state: 'live', since: 0 };
      const entry = {
        subscribers,
        closed: false,
        setStatus(state: ProviderStatus['state']) {
          status = { state, since: 0 };
          for (const l of [...listeners]) l(status);
        },
        deliver(samples: unknown) {
          for (const s of [...subscribers]) s(samples as readonly Sample[]);
        },
        session: {
          status: () => status,
          onStatus: (l: (s: ProviderStatus) => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
          },
          subscribe: (_sources: readonly string[], cb: (samples: readonly Sample[]) => void) => {
            subscribers.add(cb);
            const cached = options.cached?.();
            if (cached) cb(cached);
            return () => subscribers.delete(cb);
          },
          close: async () => {
            entry.closed = true;
          },
          ...(options.writes
            ? {
                write: async (source: string, value: unknown) => {
                  options.writes!.push({ source, value });
                },
              }
            : {}),
        } as ProviderSession,
      };
      sessions.push(entry);
      return entry.session;
    },
  };
  return { provider, sessions };
}
