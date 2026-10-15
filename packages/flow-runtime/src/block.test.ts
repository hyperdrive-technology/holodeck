import { ContributionRegistry, HOLODECK_KINDS, runContributionKindConformance } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIADIC_MAX,
  DEFAULT_VARIADIC_MIN,
  FLOW_BLOCK_KIND,
  flowBlockDefinitionProblems,
  isBlockId,
  isFlowBlockDefinition,
  readBlockDefinition,
  resolveInputPort,
  type FlowBlockDefinition,
} from './block';
import { BUILTIN_FLOW_BLOCKS } from './builtins';
import { addBlock, andBlock, counterBlock, TEST_BLOCKS } from './test-helpers';

const base = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'test.block',
  label: 'Block',
  category: 'Test',
  inputs: [],
  outputs: [],
  evaluate: () => ({ outputs: {} }),
  ...extra,
});

describe('FLOW_BLOCK_KIND', () => {
  it('is the holodeck.flow.block kind with the definition validator', () => {
    expect(FLOW_BLOCK_KIND.kind).toBe(HOLODECK_KINDS.flowBlock);
    expect(FLOW_BLOCK_KIND.kind).toBe('holodeck.flow.block');
    expect(FLOW_BLOCK_KIND.validate).toBe(isFlowBlockDefinition);
    expect(Object.isFrozen(FLOW_BLOCK_KIND)).toBe(true);
  });

  it('passes the SDK contribution kind conformance kit', () => {
    const failures: string[] = [];
    runContributionKindConformance(() => new ContributionRegistry(), FLOW_BLOCK_KIND, [andBlock, addBlock], (ok, message) => {
      if (!ok) failures.push(message);
    });
    expect(failures).toEqual([]);
  });

  it('passes conformance with the built-in blocks too', () => {
    const failures: string[] = [];
    const [a, b] = BUILTIN_FLOW_BLOCKS;
    runContributionKindConformance(() => new ContributionRegistry(), FLOW_BLOCK_KIND, [a!, b!], (ok, message) => {
      if (!ok) failures.push(message);
    });
    expect(failures).toEqual([]);
  });

  it('makes a registry refuse invalid definitions', () => {
    const registry = new ContributionRegistry();
    registry.registerKind(FLOW_BLOCK_KIND);
    expect(() =>
      registry.install({ id: 'bad', version: '1.0.0', contributions: { [FLOW_BLOCK_KIND.kind]: [base({ evaluate: 'nope' }) as never] } }),
    ).toThrow(/failed validation/);
    expect(registry.list(FLOW_BLOCK_KIND.kind)).toEqual([]);
  });
});

describe('isFlowBlockDefinition', () => {
  it('accepts every test and built-in block', () => {
    for (const block of [...TEST_BLOCKS, ...BUILTIN_FLOW_BLOCKS]) expect(flowBlockDefinitionProblems(block), block.id).toEqual([]);
  });

  it.each([
    ['non-object', null, /must be an object/],
    ['array', [], /must be an object/],
    ['missing id', base({ id: undefined }), /^id:/],
    ['uppercase namespace', base({ id: 'Test.block' }), /^id:/],
    ['single segment id', base({ id: 'block' }), /^id:/],
    ['NUL in id', base({ id: 'test.bl\u0000ock' }), /^id:/],
    ['overlong id', base({ id: `test.${'a'.repeat(130)}` }), /^id:/],
    ['empty label', base({ label: '' }), /^label:/],
    ['missing category', base({ category: undefined }), /^category:/],
    ['non-string description', base({ description: 3 }), /description/],
    ['inputs not array', base({ inputs: {} }), /^inputs: must be an array/],
    ['outputs not array', base({ outputs: 'x' }), /^outputs: must be an array/],
    ['port not object', base({ inputs: [1] }), /inputs\[0\]: must be an object/],
    ['bad port name', base({ inputs: [{ name: '1x', type: 'bool' }] }), /inputs\[0\].name/],
    ['__proto__ port', base({ outputs: [{ name: '__proto__', type: 'bool' }] }), /outputs\[0\].name/],
    ['$ in port name', base({ outputs: [{ name: '$fault', type: 'bool' }] }), /outputs\[0\].name/],
    ['bad port type', base({ inputs: [{ name: 'a', type: 'boolean' }] }), /inputs\[0\].type/],
    ['duplicate input', base({ inputs: [{ name: 'a', type: 'bool' }, { name: 'a', type: 'number' }] }), /duplicate input "a"/],
    ['duplicate output', base({ outputs: [{ name: 'q', type: 'bool' }, { name: 'q', type: 'bool' }] }), /duplicate output "q"/],
    ['default of wrong type', base({ inputs: [{ name: 'a', type: 'bool', default: 1 }] }), /inputs\[0\].default/],
    ['NaN default', base({ inputs: [{ name: 'a', type: 'number', default: Number.NaN }] }), /inputs\[0\].default/],
    ['output default', base({ outputs: [{ name: 'q', type: 'bool', default: true }] }), /only inputs may set default/],
    ['variadic output', base({ outputs: [{ name: 'q', type: 'bool', variadic: true }] }), /only inputs may set variadic/],
    ['min without variadic', base({ inputs: [{ name: 'a', type: 'bool', min: 1 }] }), /min\/max need variadic/],
    ['variadic min > max', base({ inputs: [{ name: 'in', type: 'bool', variadic: true, min: 5, max: 3 }] }), /min must be ≤ max/],
    ['variadic max too big', base({ inputs: [{ name: 'in', type: 'bool', variadic: true, max: 65 }] }), /\.max: must be an integer 1–64/],
    ['variadic fractional min', base({ inputs: [{ name: 'in', type: 'bool', variadic: true, min: 1.5 }] }), /\.min/],
    ['variadic name ends in digit', base({ inputs: [{ name: 'in2', type: 'bool', variadic: true }] }), /may not end in a digit/],
    [
      'input clashes with variadic instances',
      base({ inputs: [{ name: 'in', type: 'bool', variadic: true }, { name: 'in3', type: 'bool' }] }),
      /"in3" clashes with the instances of variadic input "in"/,
    ],
    ['too many ports', base({ inputs: Array.from({ length: 65 }, (_, i) => ({ name: `p${i}x`, type: 'bool' })) }), /at most 64 ports/],
    ['evaluate missing', base({ evaluate: undefined }), /^evaluate:/],
    ['initialState not function', base({ initialState: {} }), /^initialState:/],
    ['checkParams not function', base({ checkParams: 1 }), /^checkParams:/],
    ['params not object', base({ params: [] }), /^params:/],
    ['param bad name', base({ params: { 'a-b': { type: 'bool' } } }), /"a-b" is not an identifier/],
    ['param bad type', base({ params: { p: { type: 'boolean' } } }), /params.p.type/],
    ['param default wrong type', base({ params: { p: { type: 'number', default: '1' } } }), /params.p.default: must be a finite number/],
    ['param default out of range', base({ params: { p: { type: 'number', default: 5, max: 3 } } }), /params.p.default: must be ≤ 3/],
    ['param min > max', base({ params: { p: { type: 'number', min: 5, max: 3, default: 4 } } }), /min must be ≤ max/],
    ['param needs default', base({ params: { p: { type: 'number', min: 1 } } }), /params.p: needs a default/],
    ['options need default', base({ params: { p: { type: 'string', options: ['a', 'b'] } } }), /params.p: needs a default/],
    ['empty options', base({ params: { p: { type: 'string', options: [] } } }), /params.p.options/],
    ['duplicate option', base({ params: { p: { type: 'string', options: ['a', 'a'], default: 'a' } } }), /duplicate option/],
    ['default not in options', base({ params: { p: { type: 'string', options: ['a'], default: 'b' } } }), /must be one of "a"/],
    ['maxLength too big', base({ params: { p: { type: 'string', maxLength: 5000 } } }), /maxLength/],
    ['non-boolean required', base({ params: { p: { type: 'bool', required: 'yes' } } }), /required/],
    ['step not positive', base({ params: { p: { type: 'number', step: 0 } } }), /step: must be > 0/],
    ['any default object', base({ params: { p: { type: 'any', default: {} } } }), /JSON scalar/],
  ])('rejects %s', (_name, definition, pattern) => {
    const problems = flowBlockDefinitionProblems(definition);
    expect(problems.some((p) => pattern.test(p)), problems.join('\n')).toBe(true);
    expect(isFlowBlockDefinition(definition)).toBe(false);
  });

  it('lists every problem, not just the first', () => {
    const problems = flowBlockDefinitionProblems({ id: 'X', label: '', category: '', inputs: 1, outputs: 2 });
    expect(problems.length).toBeGreaterThanOrEqual(5);
  });

  it('accepts a required param without a default whatever its constraints', () => {
    expect(flowBlockDefinitionProblems(base({ params: { p: { type: 'number', min: 1, required: true } } }))).toEqual([]);
  });

  it('never throws on hostile definitions', () => {
    const throwing = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    expect(flowBlockDefinitionProblems(throwing)).toEqual([expect.stringMatching(/could not be read: trap/)]);
    const getter = base();
    Object.defineProperty(getter, 'inputs', {
      get() {
        throw new Error('getter');
      },
    });
    expect(isFlowBlockDefinition(getter)).toBe(false);
  });

  it('snapshots ports and params: later edits to the definition change nothing', () => {
    const definition = {
      ...base(),
      inputs: [{ name: 'a', type: 'bool' }],
      params: { p: { type: 'number', default: 1 } },
    } as unknown as FlowBlockDefinition;
    const { info } = readBlockDefinition(definition);
    (definition.inputs as unknown as Array<{ name: string }>)[0]!.name = 'changed';
    (definition.params as Record<string, { default: number }>).p!.default = 99;
    expect(info!.inputs[0]!.name).toBe('a');
    expect(info!.params.get('p')!.default).toBe(1);
    expect(Object.isFrozen(info)).toBe(true);
    expect(Object.isFrozen(info!.inputs[0])).toBe(true);
    expect(Object.isFrozen(info!.params.get('p'))).toBe(true);
  });

  it('reads each field once: a flipping getter cannot sneak an invalid value past validation', () => {
    let reads = 0;
    const port = { name: 'a', type: 'bool' };
    Object.defineProperty(port, 'default', { enumerable: true, get: () => (reads++ === 0 ? true : 'not a bool') });
    const { info, problems } = readBlockDefinition(base({ inputs: [port] }));
    expect(problems).toEqual([]);
    expect(info!.inputs[0]!.default).toBe(true);
    expect(reads).toBe(1);
  });

  it('accepts class-based definitions (methods on the prototype) and keeps `this`', () => {
    class Gain {
      id = 'test.gain';
      label = 'Gain';
      category = 'Test';
      inputs = [{ name: 'in', type: 'number' as const }];
      outputs = [{ name: 'out', type: 'number' as const }];
      factor = 2;
      evaluate(args: { inputs: Record<string, unknown> }) {
        return { outputs: { out: (args.inputs.in as number) * this.factor } };
      }
    }
    const gain = new Gain();
    expect(flowBlockDefinitionProblems(gain)).toEqual([]);
    const { info } = readBlockDefinition(gain);
    expect(info!.evaluate({ inputs: { in: 3 }, params: {}, state: null, dtMs: 0, nowMs: 0 })).toEqual({ outputs: { out: 6 } });
  });

  it('binds evaluate to the original definition object (method `this` works)', () => {
    const definition = {
      ...base(),
      outputs: [{ name: 'q', type: 'number' }],
      factor: 3,
      evaluate(this: { factor: number }) {
        return { outputs: { q: this.factor } };
      },
    };
    const { info } = readBlockDefinition(definition);
    expect(info!.evaluate({ inputs: {}, params: {}, state: null, dtMs: 0, nowMs: 0 })).toEqual({ outputs: { q: 3 } });
  });
});

describe('variadic inputs', () => {
  const info = readBlockDefinition(andBlock).info!;

  it('resolves 1-based instance names up to max', () => {
    expect(resolveInputPort(info, 'in1')).toMatchObject({ input: { name: 'in' }, index: 1 });
    expect(resolveInputPort(info, 'in8')).toMatchObject({ index: 8 });
  });

  it.each(['in', 'in0', 'in01', 'in9', 'in-1', 'in1.0', 'IN1', 'in 1', 'inx'])('rejects %s', (port) => {
    expect(resolveInputPort(info, port)).toBeUndefined();
  });

  it('defaults min/max', () => {
    const { info: d } = readBlockDefinition(base({ inputs: [{ name: 'in', type: 'bool', variadic: true }] }));
    expect(d!.inputs[0]).toMatchObject({ variadic: true, min: DEFAULT_VARIADIC_MIN, max: DEFAULT_VARIADIC_MAX });
    const { info: wide } = readBlockDefinition(base({ inputs: [{ name: 'in', type: 'bool', variadic: true, min: 20 }] }));
    expect(wide!.inputs[0]).toMatchObject({ min: 20, max: 20 });
  });

  it('keeps similarly named variadic inputs apart', () => {
    const { info: d } = readBlockDefinition(
      base({
        inputs: [
          { name: 'a', type: 'bool', variadic: true },
          { name: 'ab', type: 'number', variadic: true },
        ],
      }),
    );
    expect(resolveInputPort(d!, 'a1')?.input.name).toBe('a');
    expect(resolveInputPort(d!, 'ab1')?.input.name).toBe('ab');
  });
});

describe('isBlockId', () => {
  it.each(['logic.and', 'flow.delay', 'signal.in', 'acme-co.pump.startStop', 'logic.r_trig'])('accepts %s', (id) => {
    expect(isBlockId(id)).toBe(true);
  });
  it.each(['', 'and', 'Logic.and', '.and', 'logic.', 'logic..and', 'logic.and ', 1, null])('rejects %s', (id) => {
    expect(isBlockId(id)).toBe(false);
  });
});

describe('counter fixture', () => {
  it('is a valid stateful block', () => {
    expect(isFlowBlockDefinition(counterBlock)).toBe(true);
  });
});
