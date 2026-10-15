/**
 * Built-in structural blocks, shipped as `holodeck.flow.block` contributions
 * by the `holodeck.flow-runtime` package:
 *
 * | id          | ports                  | params                    | semantics |
 * |-------------|------------------------|---------------------------|-----------|
 * | `flow.const`| out `value: any`       | `type`, `value`           | A constant, converted to `type` (bool / number / string). |
 * | `flow.delay`| in `in: any` → out `out: any` | `initial`          | One-scan delay: `out` is the value `in` had at the end of the previous scan (`initial` before that). The only legal way to close a loop. Quality: see below. |
 * | `signal.in` | out `value: any`       | `connection`, `source`    | The latest value of a provider signal (via the provider's `SignalBridge`). `null` until the first sample. |
 * | `signal.out`| in `value: any`        | `connection`, `source`    | Writes its input to a provider signal when it changes, only while its quality is `good` (holds otherwise). |
 *
 * The logic library (AND/OR/timers…) is `@holodeck/library-logic` (lane F3).
 *
 * The runtime treats three of these specially, by id, and always uses the
 * definitions below for them (a registry entry with the same id never
 * replaces them):
 * - `flow.delay` is evaluated in a final phase of each scan, after every
 *   other node, and all delays commit their outputs together (so chains of
 *   delays shift by one scan each). Its outputs therefore act as sources in
 *   the topological order, which is what makes feedback legal.
 *   Quality: a delay outside any loop is a plain time shift and carries its
 *   input's quality with the value. A delay on a feedback loop shows the
 *   loop's *health* in the scan that stored its value (worst reading the loop
 *   took from outside, `bad` on any fault or substitute on it), so the loop's
 *   state survives a bad scan without ever reading as good from bad data
 *   (run.ts header, README "Quality and the write gate").
 * - `signal.in`'s state *is* the latest external value: the runtime replaces
 *   it when a sample arrives (`FlowRun.setSignal`), and `evaluate` publishes it.
 * - `signal.out`'s input is forwarded to the bridge by the provider when it
 *   changes (`FlowScan.writes`); `evaluate` itself has nothing to do.
 */

import type { FlowBlockDefinition, FlowParams } from './block';
import { convertTo, type FlowPortType, type FlowValue } from './values';

export const FLOW_CONST_BLOCK = 'flow.const';
export const FLOW_DELAY_BLOCK = 'flow.delay';
export const SIGNAL_IN_BLOCK = 'signal.in';
export const SIGNAL_OUT_BLOCK = 'signal.out';

const signalParams = {
  connection: {
    type: 'string',
    required: true,
    maxLength: 128,
    label: 'Connection',
    description: 'Id of a connection in this document (`connections[].id`).',
  },
  source: {
    type: 'string',
    required: true,
    label: 'Source',
    description: "Signal address in the connection's provider syntax.",
  },
} as const;

/** `required` only says "set"; a signal also needs a non-empty connection and source. */
function checkSignalParams(params: FlowParams): string[] {
  const problems: string[] = [];
  if (params.connection === '') problems.push('connection: must not be empty');
  if (params.source === '') problems.push('source: must not be empty');
  return problems;
}

const CONST_TYPES = ['bool', 'number', 'string'] as const;

export const flowConstBlock: FlowBlockDefinition = {
  id: FLOW_CONST_BLOCK,
  label: 'Constant',
  category: 'Flow',
  description: 'A constant value of the chosen type.',
  inputs: [],
  outputs: [{ name: 'value', type: 'any', label: 'Value' }],
  params: {
    type: { type: 'string', options: CONST_TYPES, default: 'number', label: 'Type' },
    value: { type: 'any', label: 'Value', description: 'Defaults to the type default (false, 0 or "").' },
  },
  checkParams(params: FlowParams) {
    const type = params.type as FlowPortType;
    const value = params.value as FlowValue;
    if (value === null) return [];
    const ok = type === 'bool' ? typeof value === 'boolean' : type === 'number' ? typeof value === 'number' : typeof value === 'string';
    return ok ? [] : [`value: must be a ${type} (type is "${type}")`];
  },
  evaluate({ params }) {
    // null (the unset `any` default) becomes the type default: false, 0 or "".
    return { outputs: { value: convertTo(params.type as FlowPortType, params.value as FlowValue) } };
  },
};

export const flowDelayBlock: FlowBlockDefinition = {
  id: FLOW_DELAY_BLOCK,
  label: 'Delay',
  category: 'Flow',
  description: 'One-scan delay. Feedback loops must pass through one.',
  inputs: [{ name: 'in', type: 'any', label: 'In' }],
  outputs: [{ name: 'out', type: 'any', label: 'Out' }],
  params: {
    initial: { type: 'any', label: 'Initial value', description: 'Output before the first scan completes, trusted like a constant. null is "unknown": readers that need a typed value get a bad substitute, and a loop with a null initial is not healthy until it has stored a real value.' },
  },
  // Runs in the delay phase: its output is published for the *next* scan.
  evaluate({ inputs }) {
    return { outputs: { out: inputs.in as FlowValue } };
  },
};

export const signalInBlock: FlowBlockDefinition = {
  id: SIGNAL_IN_BLOCK,
  label: 'Signal in',
  category: 'Signals',
  description: 'Reads a provider signal. Holds its last value while the connection is down.',
  inputs: [],
  outputs: [{ name: 'value', type: 'any', label: 'Value' }],
  params: signalParams,
  checkParams: checkSignalParams,
  initialState: () => null,
  // The runtime stores the latest external value as this node's state.
  evaluate({ state }) {
    return { outputs: { value: state as FlowValue } };
  },
};

export const signalOutBlock: FlowBlockDefinition = {
  id: SIGNAL_OUT_BLOCK,
  label: 'Signal out',
  category: 'Signals',
  description: 'Writes its input to a provider signal when it changes, only while the input quality is good; holds the last write otherwise.',
  inputs: [{ name: 'value', type: 'any', label: 'Value' }],
  outputs: [],
  params: signalParams,
  checkParams: checkSignalParams,
  // The provider forwards the input; nothing to compute here.
  evaluate() {
    return { outputs: {} };
  },
};

/** The four structural blocks, in palette order. Frozen; `createExtension` copies the list. */
export const BUILTIN_FLOW_BLOCKS: readonly FlowBlockDefinition[] = Object.freeze(
  [flowConstBlock, flowDelayBlock, signalInBlock, signalOutBlock].map((block) => deepFreeze(block)),
);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
