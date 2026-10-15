/**
 * Flow block contract (kind `holodeck.flow.block`; @holodeck/sdk docs/PACKAGING.md §7).
 *
 * A block is data plus an evaluator: typed ports, typed params, optional
 * per-node state, and `evaluate`, which the runtime calls once per scan:
 *
 *   evaluate({ inputs, params, state, dtMs, nowMs }) → { outputs, state? }
 *
 * `evaluate` must be pure apart from the state it returns: same arguments,
 * same result, no I/O, no timers, no mutation of its arguments (they are
 * frozen, so mutation throws and faults the node). Timers, latches and edge
 * detectors keep what they need in `state`; the runtime snapshots it.
 *
 * State carries value, not quality: a node's output quality is the worst of
 * the readings it consumed *this scan* (README "Quality and the write gate"),
 * whatever the readings were when its state was built. A timer that ran on an
 * uncertain input is `good` again as soon as its input is.
 *
 * Item shapes live with the package that registers the kind (SDK
 * `registry.ts`), so this file, not the SDK, defines `FlowBlockDefinition`.
 *
 * Variadic inputs (AND/OR with 2..N inputs): an input spec with
 * `variadic: true` named `in` stands for the ports `in1`, `in2`, … `in<max>`
 * (1-based, no leading zeros). Wires target those instance names. A node has
 * `max(min, highest wired index)` instances; unwired instances inside that
 * range read the input's default. `evaluate` receives `inputs.in` as a frozen
 * array of the instance values, in index order. A variadic name may not end in
 * a digit, and no other input may be named `<variadic name><digits>`, so
 * every port name resolves to exactly one input.
 */

import { HOLODECK_KINDS, type Contribution, type ContributionKind } from '@holodeck/sdk';
import {
  FLOW_LIMITS,
  dict,
  errorMessage,
  isFiniteNumber,
  isFlowValue,
  isPortName,
  isPortType,
  isRecord,
  matchesType,
  quote,
  typeDefault,
  type FlowPortType,
  type FlowValue,
} from './values';

/** Kind name of flow blocks: `holodeck.flow.block`. */
export const FLOW_BLOCK_KIND_NAME = HOLODECK_KINDS.flowBlock;

interface FlowPortSpecBase {
  /** Identifier (`[A-Za-z_][A-Za-z0-9_]*`, ≤ 64 characters). Unique among the block's inputs, or its outputs. */
  name: string;
  type: FlowPortType;
  label?: string;
  description?: string;
}

export interface FlowInputSpec extends FlowPortSpecBase {
  /** Value while unconnected. Must match `type`. Default: the type default (false / 0 / '' / null). */
  default?: FlowValue;
  /** Repeatable input: ports `<name>1` … `<name><max>` (see the file comment). */
  variadic?: boolean;
  /** Variadic only: fewest instances a node has (default 2). */
  min?: number;
  /** Variadic only: most instances (default 16, at most `FLOW_LIMITS.maxVariadic`). */
  max?: number;
}

export type FlowOutputSpec = FlowPortSpecBase;

/** Either port spec; `PortSpec` in the plan's wording. */
export type FlowPortSpec = FlowInputSpec | FlowOutputSpec;

interface FlowParamSpecBase {
  label?: string;
  description?: string;
  /** A node must set it (no default applies). */
  required?: boolean;
}

/**
 * Param spec. A param a node leaves unset takes `default`, else the type
 * default; a definition is invalid if that value would fail its own spec
 * (e.g. `min: 1` without a `default`) unless the param is `required`.
 * Param values are JSON scalars, like port values.
 */
export type FlowParamSpec =
  | (FlowParamSpecBase & { type: 'bool'; default?: boolean })
  | (FlowParamSpecBase & {
      type: 'number';
      default?: number;
      min?: number;
      max?: number;
      /** Editor step hint only. */
      step?: number;
      integer?: boolean;
      unit?: string;
    })
  | (FlowParamSpecBase & {
      type: 'string';
      default?: string;
      /** Allowed values (an editor shows a select). */
      options?: readonly string[];
      /** At most `FLOW_LIMITS.maxStringLength`. */
      maxLength?: number;
    })
  | (FlowParamSpecBase & { type: 'any'; default?: FlowValue });

export type FlowParamType = FlowParamSpec['type'];

/** A node's resolved params: every declared param, defaults applied. Frozen, null-prototype. */
export type FlowParams = Readonly<Record<string, FlowValue>>;

/** Input values: scalars, and frozen arrays for variadic inputs. Frozen, null-prototype. */
export type FlowInputs = Readonly<Record<string, FlowValue | readonly FlowValue[]>>;

/** Per-node state: JSON-like data (no functions, class instances, cycles or non-finite numbers). */
export type FlowState = null | boolean | number | string | readonly FlowState[] | { readonly [key: string]: FlowState };

export interface FlowEvalArgs<S extends FlowState = FlowState> {
  inputs: FlowInputs;
  params: FlowParams;
  /**
   * The node's state: `initialState(params)` (or `null`) on the first scan, then whatever `evaluate` last returned.
   * It has no quality of its own: outputs take the quality of this scan's inputs.
   */
  state: S;
  /** Milliseconds since the previous scan of this run; 0 on the first scan and if the clock goes backwards. */
  dtMs: number;
  /** The run's clock (ms since the Unix epoch by default) at the start of this scan. */
  nowMs: number;
}

export interface FlowEvalResult<S extends FlowState = FlowState> {
  /**
   * Output values by port name. An output left out (or set to `undefined`)
   * keeps its previous value; an unknown name, a non-finite number, a value
   * of the wrong type or a string longer than `FLOW_LIMITS.maxValueLength`
   * faults the node.
   */
  outputs: Readonly<Record<string, FlowValue | undefined>>;
  /** New state. Absent (or `undefined`) keeps the current state; return `null` to clear it. */
  state?: S;
}

export interface FlowBlockDefinition<S extends FlowState = FlowState> extends Contribution {
  /** Dotted, lowercase namespace first: `logic.and`, `flow.delay`, `signal.in`. */
  id: string;
  label: string;
  /** Palette group, e.g. `Logic`. */
  category: string;
  description?: string;
  inputs: readonly FlowInputSpec[];
  outputs: readonly FlowOutputSpec[];
  params?: Readonly<Record<string, FlowParamSpec>>;
  /**
   * Cross-param checks the specs cannot express (e.g. `low < high`). Called
   * during validation with the resolved params; every returned string is an
   * `INVALID_PARAM` problem. Must be pure.
   */
  checkParams?(params: FlowParams): readonly string[];
  /** State for a new node (or a new deployment). Default `null`. */
  initialState?(params: FlowParams): S;
  evaluate(args: FlowEvalArgs<S>): FlowEvalResult<S>;
}

// -----------------------------------------------------------------------------
// Snapshot + validation
// -----------------------------------------------------------------------------

/** Default instance bounds of a variadic input. */
export const DEFAULT_VARIADIC_MIN = 2;
export const DEFAULT_VARIADIC_MAX = 16;

/** Block ids: lowercase dotted namespace, then one or more segments that may be camelCase. */
const BLOCK_ID = /^[a-z][a-z0-9-]*(?:\.[a-zA-Z0-9][a-zA-Z0-9_-]*)+$/;

export function isBlockId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= FLOW_LIMITS.maxIdLength && BLOCK_ID.test(v);
}

/** Frozen copy of an input spec with variadic bounds resolved. */
export interface InputInfo {
  readonly name: string;
  readonly type: FlowPortType;
  readonly label: string | undefined;
  readonly description: string | undefined;
  readonly default: FlowValue;
  readonly variadic: boolean;
  readonly min: number;
  readonly max: number;
}

export interface OutputInfo {
  readonly name: string;
  readonly type: FlowPortType;
  readonly label: string | undefined;
  readonly description: string | undefined;
}

/**
 * Everything the runtime keeps of a definition: frozen copies of its data and
 * its functions bound to the original object (as the SDK registry does for
 * kind callbacks), so later edits to the caller's object change nothing.
 */
export interface BlockInfo {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly description: string | undefined;
  readonly inputs: readonly InputInfo[];
  readonly outputs: readonly OutputInfo[];
  /** name → frozen spec copy, in declaration order. */
  readonly params: ReadonlyMap<string, FlowParamSpec>;
  readonly evaluate: (args: FlowEvalArgs) => unknown;
  readonly initialState: ((params: FlowParams) => unknown) | undefined;
  readonly checkParams: ((params: FlowParams) => unknown) | undefined;
}

const optionalString = (raw: Record<string, unknown>, key: string, at: string, errors: string[]): string | undefined => {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > FLOW_LIMITS.maxStringLength) {
    errors.push(`${at}.${key}: must be a string of at most ${FLOW_LIMITS.maxStringLength} characters`);
    return undefined;
  }
  return value;
};

/** Problems with a param value against its spec; empty = valid. `at` prefixes every message. */
export function paramValueProblems(spec: FlowParamSpec, value: unknown, at: string): string[] {
  switch (spec.type) {
    case 'bool':
      return typeof value === 'boolean' ? [] : [`${at}: must be a boolean`];
    case 'number': {
      if (!isFiniteNumber(value)) return [`${at}: must be a finite number`];
      const errors: string[] = [];
      if (spec.integer && !Number.isInteger(value)) errors.push(`${at}: must be an integer`);
      if (spec.min !== undefined && value < spec.min) errors.push(`${at}: must be ≥ ${spec.min}`);
      if (spec.max !== undefined && value > spec.max) errors.push(`${at}: must be ≤ ${spec.max}`);
      return errors;
    }
    case 'string': {
      if (typeof value !== 'string') return [`${at}: must be a string`];
      const limit = Math.min(spec.maxLength ?? FLOW_LIMITS.maxStringLength, FLOW_LIMITS.maxStringLength);
      const errors: string[] = [];
      if (value.length > limit) errors.push(`${at}: must be at most ${limit} characters`);
      if (spec.options && !spec.options.includes(value)) {
        errors.push(`${at}: must be one of ${spec.options.map((o) => quote(o)).join(', ')}`);
      }
      return errors;
    }
    case 'any':
      if (!isFlowValue(value)) return [`${at}: must be a JSON scalar (finite number, string, boolean or null)`];
      if (typeof value === 'string' && value.length > FLOW_LIMITS.maxStringLength) {
        return [`${at}: must be at most ${FLOW_LIMITS.maxStringLength} characters`];
      }
      return [];
  }
}

/** The value a param takes when a node leaves it unset (ignoring `required`). */
export function paramFallback(spec: FlowParamSpec): FlowValue {
  if (spec.default !== undefined) return spec.default;
  return typeDefault(spec.type);
}

function readParamSpec(input: unknown, at: string, errors: string[]): FlowParamSpec | undefined {
  if (!isRecord(input)) {
    errors.push(`${at}: must be an object`);
    return undefined;
  }
  // One read of every field: what is validated is what is kept.
  const raw = { ...input };
  const type = raw.type;
  if (type !== 'bool' && type !== 'number' && type !== 'string' && type !== 'any') {
    errors.push(`${at}.type: must be one of bool, number, string, any`);
    return undefined;
  }
  const start = errors.length;
  const base: FlowParamSpecBase = {};
  const label = optionalString(raw, 'label', at, errors);
  const description = optionalString(raw, 'description', at, errors);
  if (label !== undefined) base.label = label;
  if (description !== undefined) base.description = description;
  if (raw.required !== undefined) {
    if (typeof raw.required !== 'boolean') errors.push(`${at}.required: must be a boolean`);
    else base.required = raw.required;
  }
  let spec: FlowParamSpec;
  switch (type) {
    case 'bool':
      spec = { ...base, type };
      break;
    case 'number': {
      const number: FlowParamSpec & { type: 'number' } = { ...base, type };
      for (const key of ['min', 'max', 'step'] as const) {
        const v = raw[key];
        if (v === undefined) continue;
        if (!isFiniteNumber(v)) errors.push(`${at}.${key}: must be a finite number`);
        else number[key] = v;
      }
      if (number.step !== undefined && !(number.step > 0)) errors.push(`${at}.step: must be > 0`);
      if (number.min !== undefined && number.max !== undefined && number.min > number.max) {
        errors.push(`${at}: min must be ≤ max`);
      }
      if (raw.integer !== undefined) {
        if (typeof raw.integer !== 'boolean') errors.push(`${at}.integer: must be a boolean`);
        else number.integer = raw.integer;
      }
      const unit = optionalString(raw, 'unit', at, errors);
      if (unit !== undefined) number.unit = unit;
      spec = number;
      break;
    }
    case 'string': {
      const string: FlowParamSpec & { type: 'string' } = { ...base, type };
      if (raw.maxLength !== undefined) {
        const v = raw.maxLength;
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > FLOW_LIMITS.maxStringLength) {
          errors.push(`${at}.maxLength: must be an integer 0–${FLOW_LIMITS.maxStringLength}`);
        } else string.maxLength = v as number;
      }
      if (raw.options !== undefined) {
        const options = raw.options;
        const list: unknown[] = Array.isArray(options) ? Array.prototype.slice.call(options, 0, 257) : [];
        if (list.length === 0 || list.length > 256) {
          errors.push(`${at}.options: must be a non-empty array of at most 256 strings`);
        } else {
          const copy: string[] = [];
          for (let i = 0; i < list.length; i++) {
            const option: unknown = list[i];
            if (typeof option !== 'string' || option.length > FLOW_LIMITS.maxStringLength) {
              errors.push(`${at}.options[${i}]: must be a string`);
            } else if (copy.includes(option)) errors.push(`${at}.options[${i}]: duplicate option ${quote(option)}`);
            else copy.push(option);
          }
          string.options = Object.freeze(copy);
        }
      }
      spec = string;
      break;
    }
    case 'any':
      spec = { ...base, type };
      break;
  }
  if (raw.default !== undefined) {
    // Checked against the spec built so far (bounds, options, length).
    const problems = paramValueProblems(spec, raw.default, `${at}.default`);
    if (problems.length) errors.push(...problems);
    else (spec as { default?: FlowValue }).default = raw.default as FlowValue;
  }
  if (errors.length > start) return undefined;
  if (!spec.required) {
    const problems = paramValueProblems(spec, paramFallback(spec), `${at}`);
    if (problems.length) {
      errors.push(`${at}: needs a default (the type default ${JSON.stringify(paramFallback(spec))} fails: ${problems.join('; ')})`);
      return undefined;
    }
  }
  return Object.freeze(spec);
}

function readPorts(input: unknown, side: 'inputs' | 'outputs', errors: string[]): Array<InputInfo> {
  if (!Array.isArray(input)) {
    errors.push(`${side}: must be an array`);
    return [];
  }
  const list: unknown[] = Array.prototype.slice.call(input, 0, FLOW_LIMITS.maxPortsPerBlock + 1);
  if (list.length > FLOW_LIMITS.maxPortsPerBlock) {
    errors.push(`${side}: at most ${FLOW_LIMITS.maxPortsPerBlock} ports`);
    return [];
  }
  const ports: InputInfo[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const at = `${side}[${i}]`;
    const rawPort: unknown = list[i];
    if (!isRecord(rawPort)) {
      errors.push(`${at}: must be an object`);
      continue;
    }
    const port = { ...rawPort };
    const start = errors.length;
    const name = port.name;
    if (!isPortName(name)) errors.push(`${at}.name: must be an identifier such as "in" or "out"`);
    else if (seen.has(name)) errors.push(`${at}.name: duplicate ${side === 'inputs' ? 'input' : 'output'} ${quote(name)}`);
    const type = port.type;
    if (!isPortType(type)) errors.push(`${at}.type: must be one of bool, number, string, any`);
    const label = optionalString(port, 'label', at, errors);
    const description = optionalString(port, 'description', at, errors);
    let variadic = false;
    let min = 1;
    let max = 1;
    let fallback: FlowValue = isPortType(type) ? typeDefault(type) : null;
    if (side === 'outputs') {
      for (const key of ['default', 'variadic', 'min', 'max']) {
        if (port[key] !== undefined) errors.push(`${at}.${key}: only inputs may set ${key}`);
      }
    } else {
      if (port.default !== undefined) {
        if (!isPortType(type) || !matchesType(port.default, type)) errors.push(`${at}.default: must be a value of type ${String(type)}`);
        else if (typeof port.default === 'string' && port.default.length > FLOW_LIMITS.maxStringLength) {
          errors.push(`${at}.default: must be at most ${FLOW_LIMITS.maxStringLength} characters`);
        } else fallback = port.default;
      }
      if (port.variadic !== undefined && typeof port.variadic !== 'boolean') errors.push(`${at}.variadic: must be a boolean`);
      variadic = port.variadic === true;
      if (!variadic) {
        if (port.min !== undefined || port.max !== undefined) errors.push(`${at}: min/max need variadic: true`);
      } else {
        min = port.min === undefined ? DEFAULT_VARIADIC_MIN : (port.min as number);
        max = port.max === undefined ? Math.max(DEFAULT_VARIADIC_MAX, min) : (port.max as number);
        if (!Number.isInteger(min) || min < 0 || min > FLOW_LIMITS.maxVariadic) {
          errors.push(`${at}.min: must be an integer 0–${FLOW_LIMITS.maxVariadic}`);
        } else if (!Number.isInteger(max) || max < 1 || max > FLOW_LIMITS.maxVariadic) {
          errors.push(`${at}.max: must be an integer 1–${FLOW_LIMITS.maxVariadic}`);
        } else if (min > max) errors.push(`${at}: min must be ≤ max`);
        if (isPortName(name) && /[0-9]$/.test(name)) {
          errors.push(`${at}.name: a variadic input name may not end in a digit (its ports are ${quote(`${name}1`)}, …)`);
        }
      }
    }
    if (errors.length > start || !isPortName(name) || !isPortType(type)) continue;
    seen.add(name);
    ports.push(
      Object.freeze({ name, type, label, description, default: fallback, variadic, min: variadic ? min : 1, max: variadic ? max : 1 }),
    );
  }
  if (side === 'inputs') {
    // No input may be spelled like an instance of a variadic one.
    for (const v of ports.filter((p) => p.variadic)) {
      const instance = new RegExp(`^${v.name}[0-9]+$`);
      for (const other of ports) {
        if (other !== v && instance.test(other.name)) {
          errors.push(`inputs: ${quote(other.name)} clashes with the instances of variadic input ${quote(v.name)}`);
        }
      }
    }
  }
  return ports;
}

/**
 * Read a definition once into a frozen `BlockInfo` and list every problem.
 * Never throws: a definition with throwing getters or a Proxy yields a
 * problem. `info` is set only when there are no problems.
 */
export function readBlockDefinition(definition: unknown): { info?: BlockInfo; problems: string[] } {
  const errors: string[] = [];
  try {
    if (!isRecord(definition)) return { problems: ['definition: must be an object'] };
    // One read of every own field (class-based definitions keep methods on
    // the prototype, so fall back to the object for the functions).
    const raw: Record<string, unknown> = { ...definition };
    for (const fn of ['evaluate', 'initialState', 'checkParams']) if (!(fn in raw)) raw[fn] = definition[fn];
    const id = raw.id;
    if (!isBlockId(id)) errors.push('id: must be a dotted block id such as "logic.and" (≤ 128 characters)');
    const label = raw.label;
    if (typeof label !== 'string' || label.length === 0 || label.length > FLOW_LIMITS.maxLabelLength) {
      errors.push(`label: must be a non-empty string of at most ${FLOW_LIMITS.maxLabelLength} characters`);
    }
    const category = raw.category;
    if (typeof category !== 'string' || category.length === 0 || category.length > FLOW_LIMITS.maxLabelLength) {
      errors.push(`category: must be a non-empty string of at most ${FLOW_LIMITS.maxLabelLength} characters`);
    }
    const description = optionalString(raw, 'description', 'definition', errors);
    const inputs = readPorts(raw.inputs, 'inputs', errors);
    const outputs = readPorts(raw.outputs, 'outputs', errors).map(
      ({ name, type, label: l, description: d }): OutputInfo => Object.freeze({ name, type, label: l, description: d }),
    );
    const params = new Map<string, FlowParamSpec>();
    const rawParams = raw.params;
    if (rawParams !== undefined) {
      if (!isRecord(rawParams)) errors.push('params: must be an object mapping names to param specs');
      else {
        const specs = { ...rawParams };
        const names = Object.keys(specs);
        if (names.length > FLOW_LIMITS.maxParamsPerBlock) errors.push(`params: at most ${FLOW_LIMITS.maxParamsPerBlock} params`);
        else {
          for (const name of names) {
            if (!isPortName(name)) {
              errors.push(`params: ${quote(name)} is not an identifier`);
              continue;
            }
            const spec = readParamSpec(specs[name], `params.${name}`, errors);
            if (spec) params.set(name, spec);
          }
        }
      }
    }
    const evaluate = raw.evaluate;
    if (typeof evaluate !== 'function') errors.push('evaluate: must be a function');
    const initialState = raw.initialState;
    if (initialState !== undefined && typeof initialState !== 'function') errors.push('initialState: must be a function');
    const checkParams = raw.checkParams;
    if (checkParams !== undefined && typeof checkParams !== 'function') errors.push('checkParams: must be a function');
    if (errors.length) return { problems: errors };
    const info: BlockInfo = Object.freeze({
      id: id as string,
      label: label as string,
      category: category as string,
      description,
      inputs: Object.freeze(inputs),
      outputs: Object.freeze(outputs),
      params,
      // Bound to the original object, like the registry binds kind callbacks.
      evaluate: (evaluate as (args: FlowEvalArgs) => unknown).bind(definition),
      initialState: typeof initialState === 'function' ? (initialState as (p: FlowParams) => unknown).bind(definition) : undefined,
      checkParams: typeof checkParams === 'function' ? (checkParams as (p: FlowParams) => unknown).bind(definition) : undefined,
    });
    return { info, problems: [] };
  } catch (error) {
    return { problems: [`definition could not be read: ${errorMessage(error)}`] };
  }
}

/** Every problem with a block definition; empty = valid. Never throws. */
export function flowBlockDefinitionProblems(item: unknown): string[] {
  return readBlockDefinition(item).problems;
}

/** Kind validator for `holodeck.flow.block`. Never throws. */
export function isFlowBlockDefinition(item: unknown): item is FlowBlockDefinition {
  return readBlockDefinition(item).problems.length === 0;
}

/**
 * The `holodeck.flow.block` contribution kind. The `holodeck.flow` engine
 * (editor-2d-react, lane F2) lists it in its `kinds`; hosts without the
 * engine can register it directly with `registry.registerKind(FLOW_BLOCK_KIND)`.
 */
export const FLOW_BLOCK_KIND: ContributionKind<FlowBlockDefinition> = Object.freeze({
  kind: FLOW_BLOCK_KIND_NAME,
  validate: isFlowBlockDefinition,
});

// -----------------------------------------------------------------------------
// Ports of a block
// -----------------------------------------------------------------------------

/** Resolve an input port name (`a`, or a variadic instance `in3`) to its spec. */
export function resolveInputPort(info: BlockInfo, port: string): { input: InputInfo; index: number | undefined } | undefined {
  for (const input of info.inputs) {
    if (!input.variadic) {
      if (input.name === port) return { input, index: undefined };
      continue;
    }
    if (port.length <= input.name.length || !port.startsWith(input.name)) continue;
    const digits = port.slice(input.name.length);
    if (!/^[1-9][0-9]*$/.test(digits)) continue;
    const index = Number(digits);
    if (index <= input.max) return { input, index };
  }
  return undefined;
}

export function findOutput(info: BlockInfo, port: string): OutputInfo | undefined {
  return info.outputs.find((o) => o.name === port);
}

/**
 * Resolve a node's params against the block: every declared param, the
 * node's value or the fallback. Returns a frozen null-prototype dict.
 * Assumes the node's params were validated.
 */
export function resolveParams(info: BlockInfo, given: Readonly<Record<string, FlowValue>>): FlowParams {
  const out = dict<FlowValue>();
  for (const [name, spec] of info.params) {
    out[name] = Object.prototype.hasOwnProperty.call(given, name) ? (given[name] as FlowValue) : paramFallback(spec);
  }
  return Object.freeze(out);
}
