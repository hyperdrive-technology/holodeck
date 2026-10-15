import { HolodeckHost, validateBindings, validateEngine } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import {
  collectFlowBindings,
  FLOW_ENGINE_API_RANGE,
  FLOW_ENGINE_API_VERSION,
  FLOW_ENGINE_ID,
  FLOW_GRAPH_FORMAT,
  flowGraphFormat,
  validateFlowBody,
} from './engine';
import { flowDoc, graph, node, registryWith, standInFlowEngine, wire } from './test-helpers';

describe('engine constants', () => {
  it('describe holodeck.flow 1.0.0 with holodeck.flow.graph.v1 bodies', () => {
    expect([FLOW_ENGINE_ID, FLOW_ENGINE_API_VERSION, FLOW_ENGINE_API_RANGE, FLOW_GRAPH_FORMAT]).toEqual([
      'holodeck.flow',
      '1.0.0',
      '^1.0',
      'holodeck.flow.graph.v1',
    ]);
  });

  it('build a descriptor that passes validateEngine and registers in a host', () => {
    expect(validateEngine(standInFlowEngine)).toEqual([]);
    const host = new HolodeckHost({ name: 'test' });
    const off = host.registerEngine(standInFlowEngine);
    expect(host.registry.hasKind('holodeck.flow.block')).toBe(true);
    off();
    expect(host.registry.hasKind('holodeck.flow.block')).toBe(false);
  });
});

describe('validateFlowBody', () => {
  it('checks structure without a registry (unknown blocks pass)', () => {
    expect(validateFlowBody(graph([node('a', 'logic.and'), node('b', 'logic.or')], [wire('w', 'a.out', 'b.in1')]))).toEqual([]);
    expect(validateFlowBody(graph([node('a', 'logic.not')], [wire('w', 'a.out', 'a.in')]))).toEqual([
      'cycle without a flow.delay block: "a" → "a"',
    ]);
    expect(validateFlowBody({ nodes: 'x' })).toEqual(['body.nodes: must be an array', 'body.wires: must be an array']);
  });

  it('checks blocks, ports and params with a registry; warnings are not errors', () => {
    const registry = registryWith();
    expect(validateFlowBody(graph([node('a', 'logic.and')]), registry)).toEqual([expect.stringMatching(/"logic.and" is not installed/)]);
    const twoWriters = graph([node('o1', 'signal.out', { connection: 'c', source: 's' }), node('o2', 'signal.out', { connection: 'c', source: 's' })]);
    expect(validateFlowBody(twoWriters, registry)).toEqual([]);
  });

  it('runs in HolodeckHost.checkDocument', async () => {
    const host = new HolodeckHost({ name: 'test' });
    host.registerEngine(standInFlowEngine);
    const diagnostics = await host.checkDocument(flowDoc(graph([node('a', 'x.y'), node('a', 'x.y')])));
    expect(diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_BODY', message: expect.stringMatching(/node id "a" is used by/) })]);
  });
});

describe('collectFlowBindings', () => {
  const body = graph(
    [
      node('in', 'signal.in', { connection: 'plc', source: 'Tank.Level' }),
      node('out', 'signal.out', { connection: 'aws', source: 'mem:x' }),
      node('k', 'flow.const', { value: 1 }),
      node('half', 'signal.in', { connection: 'plc' }),
      node('empty', 'signal.out', { connection: '', source: 'x' }),
    ],
    [wire('w', 'in.value', 'out.value')],
  );

  it('returns one binding per complete signal block, on param "value"', () => {
    expect(collectFlowBindings(body)).toEqual([
      { objectId: 'in', param: 'value', binding: { connection: 'plc', source: 'Tank.Level' } },
      { objectId: 'out', param: 'value', binding: { connection: 'aws', source: 'mem:x' } },
    ]);
  });

  it('feeds validateBindings, which reports connections the document lacks', () => {
    const problems = validateBindings({ connections: [{ id: 'plc', provider: 'acme.plc' }] }, collectFlowBindings(body));
    expect(problems).toEqual(['out.value: unknown connection "aws"']);
  });

  it('tolerates anything', () => {
    for (const junk of [null, 1, 'x', [], { nodes: 'x' }, { nodes: [null, 1, { id: 3 }] }]) expect(collectFlowBindings(junk)).toEqual([]);
    const trap = new Proxy({}, { get: () => { throw new Error('trap'); } });
    expect(collectFlowBindings(trap)).toEqual([]);
    expect(collectFlowBindings({ nodes: [{ id: 'a', block: 'signal.in', params: trap }] })).toEqual([]);
  });

  it('reads at most maxNodes nodes', () => {
    const many = { nodes: Array.from({ length: 10_050 }, (_, i) => ({ id: `n${i}`, block: 'signal.in', params: { connection: 'c', source: 's' } })) };
    expect(collectFlowBindings(many)).toHaveLength(10_000);
  });
});
