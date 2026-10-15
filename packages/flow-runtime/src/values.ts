/**
 * Values, port types, limits and small helpers shared by the flow runtime.
 *
 * Everything that travels on a wire is a `FlowValue`, which is the SDK's
 * `SignalValue` (JSON scalar). That keeps flow outputs, provider samples and
 * document bindings one value space: a `signal.in` block can forward any
 * provider sample unchanged, and every block output is publishable as a
 * provider source without conversion.
 */

import type { SignalQuality, SignalValue } from '@holodeck/sdk';

/** A value on a wire: number (finite), string, boolean or null. */
export type FlowValue = SignalValue;

/** Port and param value types. `any` accepts every `FlowValue` and is compatible with every type. */
export type FlowPortType = 'bool' | 'number' | 'string' | 'any';

export const FLOW_PORT_TYPES: readonly FlowPortType[] = Object.freeze(['bool', 'number', 'string', 'any']);

/**
 * Hard limits. Documents are untrusted input (they arrive from files, URLs
 * and other users), so every loop over document content is bounded here and
 * the work per scan is at most `maxNodes` evaluations plus `maxWires` reads.
 * Block definitions come from installed (trusted) packages but are bounded too
 * so one broken package cannot make validation unbounded.
 */
export const FLOW_LIMITS = Object.freeze({
  /** Nodes in one graph. */
  maxNodes: 10_000,
  /** Wires in one graph. */
  maxWires: 20_000,
  /** Node, wire, port and block id length. */
  maxIdLength: 128,
  /** Node label length. */
  maxLabelLength: 256,
  /** String params in documents and string `default`s in definitions. */
  maxStringLength: 4096,
  /** Params set on one node. */
  maxParamsPerNode: 64,
  /** Inputs, and separately outputs, of one block definition. */
  maxPortsPerBlock: 64,
  /** Params declared by one block definition. */
  maxParamsPerBlock: 64,
  /** Highest instance count of one variadic input. */
  maxVariadic: 64,
  /** String values a block may put on an output (longer = the node faults). */
  maxValueLength: 65_536,
  /** JSON values (scalars, arrays, objects) in one node's state. */
  maxStateValues: 10_000,
  /** Nesting depth of one node's state. */
  maxStateDepth: 32,
  /** Problems listed by one validation; the rest are counted in a final `TOO_MANY_PROBLEMS`. */
  maxProblems: 1000,
  /** Scan period bounds (ms). */
  minScanMs: 10,
  maxScanMs: 3_600_000,
});

/** Default scan period (ms). */
export const DEFAULT_SCAN_MS = 100;

/** Prefix of every source the flow runtime publishes: `flow:<nodeId>.<port>`. */
export const FLOW_SOURCE_PREFIX = 'flow:';

/**
 * Pseudo-port every node publishes: `flow:<nodeId>.$fault` is `null` while the
 * node is healthy and the error message while it is faulted. `$` cannot
 * appear in a port name, so it never collides with a real output.
 */
export const FAULT_PORT = '$fault';

/**
 * `flow:<nodeId>.<port>`. Port names never contain a dot, so splitting at the
 * last dot recovers the node id even when the node id contains dots, and two
 * different (node, port) pairs never produce the same source.
 */
export function flowSource(nodeId: string, port: string): string {
  return `${FLOW_SOURCE_PREFIX}${nodeId}.${port}`;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A JSON scalar: `null`, a boolean, a string, or a finite number. */
export function isFlowValue(v: unknown): v is FlowValue {
  return v === null || typeof v === 'boolean' || typeof v === 'string' || isFiniteNumber(v);
}

export function isPortType(v: unknown): v is FlowPortType {
  return typeof v === 'string' && (FLOW_PORT_TYPES as readonly string[]).includes(v);
}

/** Does `value` have exactly the type `type` (no conversion)? `any` accepts every flow value. */
export function matchesType(value: unknown, type: FlowPortType): value is FlowValue {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean';
    case 'number':
      return isFiniteNumber(value);
    case 'string':
      return typeof value === 'string';
    case 'any':
      return isFlowValue(value);
  }
}

/** Value of an unconnected input (unless its spec sets `default`): false / 0 / '' / null. */
export function typeDefault(type: FlowPortType): FlowValue {
  switch (type) {
    case 'bool':
      return false;
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'any':
      return null;
  }
}

/** Can an output of type `from` drive an input of type `to`? `any` is compatible with everything. */
export function typesCompatible(from: FlowPortType, to: FlowPortType): boolean {
  return from === to || from === 'any' || to === 'any';
}

/** Result of converting an `any` value to a typed input. */
export interface FlowConversion {
  readonly value: FlowValue;
  /**
   * `false` when the input carried no usable value of the target type (`null`,
   * or a string that is not a boolean/number) and `value` is a *substitute*
   * (the type default). The runtime then marks the reading `bad`, so a
   * substitute can never reach a `signal.out` write as if it were real data.
   */
  readonly exact: boolean;
}

/**
 * Convert a value arriving from an `any` output into a typed input. Typed
 * outputs are checked when the block returns them, so only `any` sources ever
 * need this. The rules are small and total (never throw). A cell marked
 * *(subst.)* is a substitute: `exact` is false and the runtime degrades the
 * reading's quality to `bad`.
 *
 * | to \ from | boolean        | number         | string                                   | null  |
 * |-----------|----------------|----------------|------------------------------------------|-------|
 * | bool      | itself         | `n !== 0`      | `"true"` → true, `"false"` → false, numeric → `n !== 0`, else false *(subst.)* | false *(subst.)* |
 * | number    | 1 / 0          | itself         | `Number(s)` when non-empty and finite, else 0 *(subst.)* | 0 *(subst.)* |
 * | string    | "true"/"false" | `String(n)`    | itself                                   | "" *(subst.)* |
 * | any       | itself         | itself         | itself                                   | null  |
 */
export function convertReading(type: FlowPortType, value: FlowValue): FlowConversion {
  const exact = (v: FlowValue): FlowConversion => ({ value: v, exact: true });
  const substitute = (): FlowConversion => ({ value: typeDefault(type), exact: false });
  if (type === 'any') return exact(value);
  if (value === null) return substitute();
  switch (type) {
    case 'bool': {
      if (typeof value === 'boolean') return exact(value);
      if (typeof value === 'number') return exact(value !== 0);
      const text = value.trim().toLowerCase();
      if (text === 'true') return exact(true);
      if (text === 'false') return exact(false);
      if (text === '') return substitute();
      const n = Number(text);
      return Number.isFinite(n) ? exact(n !== 0) : substitute();
    }
    case 'number': {
      if (typeof value === 'number') return exact(value);
      if (typeof value === 'boolean') return exact(value ? 1 : 0);
      const text = value.trim();
      if (text === '') return substitute();
      const n = Number(text);
      return Number.isFinite(n) ? exact(n) : substitute();
    }
    case 'string':
      return exact(typeof value === 'string' ? value : String(value));
  }
}

/**
 * The value part of `convertReading`. Use it only where a substitute is
 * harmless (e.g. a constant's unset value). The runtime itself always uses
 * `convertReading`, so substitutes degrade quality.
 */
export function convertTo(type: FlowPortType, value: FlowValue): FlowValue {
  return convertReading(type, value).value;
}

/**
 * Dictionary with a null prototype. Ids and param names come from documents,
 * so they can be `__proto__`, `constructor` and so on; with a null prototype
 * an assignment always creates an own property (it never reaches
 * `Object.prototype`) and lookups never see inherited members.
 */
export function dict<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/**
 * Collision-free composite key. JSON encoding means no separator character
 * (NUL, dot, colon) inside an id can forge another pair's key.
 */
export const pairKey = (a: string, b: string): string => JSON.stringify([a, b]);

/** ASCII control characters (U+0000–U+001F, U+007F) are never legitimate in ids. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A document id (node, wire): 1–`maxIdLength` characters, no control characters. */
export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= FLOW_LIMITS.maxIdLength && !CONTROL_CHARS.test(v);
}

/** Show an id in a message: JSON-quoted (control characters escaped) and shortened. */
export function quote(v: unknown): string {
  let text: string;
  try {
    text = typeof v === 'string' ? v : String(v);
  } catch {
    text = '<unprintable>';
  }
  if (text.length > 80) text = `${text.slice(0, 77)}...`;
  return JSON.stringify(text);
}

/** Message of an unknown thrown value. Never throws itself (hostile `toString`), bounded length. */
export function errorMessage(error: unknown): string {
  let text: string;
  try {
    text = error instanceof Error ? error.message : String(error);
  } catch {
    text = 'unknown error';
  }
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

export const QUALITIES: readonly SignalQuality[] = Object.freeze(['good', 'uncertain', 'bad']);

export function isQuality(v: unknown): v is SignalQuality {
  return typeof v === 'string' && (QUALITIES as readonly string[]).includes(v);
}

/** Severity order: good < uncertain < bad. */
const QUALITY_RANK: Readonly<Record<SignalQuality, number>> = Object.freeze({ good: 0, uncertain: 1, bad: 2 });

/** The worse of two qualities (bad beats uncertain beats good). */
export function worstQuality(a: SignalQuality, b: SignalQuality): SignalQuality {
  return QUALITY_RANK[b] > QUALITY_RANK[a] ? b : a;
}

/** Port and param names: identifiers. `__proto__` is refused so names are safe keys anywhere. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isPortName(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 64 && NAME.test(v) && v !== '__proto__';
}
