import { describe, expect, it } from 'vitest';
import type { IsoSceneFile } from '../iso/scene';
import { createIsoRegistryWithBuiltins } from '../registry/default';
import { COMPONENT_COLUMNS, isoComponentTable, isoComponentsCsv } from './components';

const scene: Pick<IsoSceneFile, 'objects' | 'layers'> = {
  layers: [{ id: 'piping', name: 'Piping' }],
  objects: [
    { id: 'tank-1', object: 'tank', x: 2, y: -3, rotation: 90, params: { level: 0.5 }, meta: { tag: 'FV-101', volume: 20 } },
    { id: 'pipe-1', object: 'pipe', x: 0, y: 0, toX: 4, toY: 0, layer: 'piping', group: 'g1', bindings: { flow: { connection: 'plc', source: 'FT101' } } },
    { id: 'valve-1', object: 'valve', x: 2, y: 0, onPipe: 'pipe-1', opacity: 0.5, meta: { note: '=HYPERLINK("http://evil")', tag: '+danger' } },
    { id: 'ghost', object: 'not-installed', x: 9, y: 9, layer: 'missing-layer' },
  ],
};

describe('isoComponentTable', () => {
  const registry = createIsoRegistryWithBuiltins();
  const table = isoComponentTable(scene, registry);
  const col = (name: string) => table.header.indexOf(name);
  const row = (id: string) => table.rows.find((r) => r[0] === id)!;

  it('has the fixed columns, then sorted meta columns for every key used', () => {
    expect(table.header).toEqual([...COMPONENT_COLUMNS, 'meta:note', 'meta:tag', 'meta:volume']);
    expect(table.rows.every((r) => r.length === table.header.length)).toBe(true);
  });

  it('writes one row per placement in scene order', () => {
    expect(table.rows.map((r) => r[0])).toEqual(['tank-1', 'pipe-1', 'valve-1', 'ghost']);
  });

  it('resolves part labels, categories and packages from the registry', () => {
    const tank = row('tank-1');
    expect(tank[col('part')]).toBe('tank');
    expect(typeof tank[col('label')]).toBe('string');
    expect(tank[col('label')]).not.toBe('');
    expect(tank[col('package')]).toBe(registry.ownerOf('holodeck.iso.part', 'tank'));
  });

  it('leaves unknown parts unresolved but keeps the row', () => {
    const ghost = row('ghost');
    expect(ghost[col('label')]).toBeUndefined();
    expect(ghost[col('package')]).toBeUndefined();
    // An undeclared layer falls back to the default layer.
    expect(ghost[col('layer')]).toBe(row('tank-1')[col('layer')]);
  });

  it('writes geometry, layer names, groups and nested values', () => {
    const tank = row('tank-1');
    expect([tank[col('x')], tank[col('y')], tank[col('rotation')]]).toEqual([2, -3, 90]);
    expect(tank[col('params')]).toBe('{"level":0.5}');
    expect(tank[col('meta:volume')]).toBe(20);
    const pipe = row('pipe-1');
    expect(pipe[col('layer')]).toBe('Piping');
    expect(pipe[col('group')]).toBe('g1');
    expect([pipe[col('toX')], pipe[col('toY')]]).toEqual([4, 0]);
    expect(pipe[col('bindings')]).toBe('{"flow":{"connection":"plc","source":"FT101"}}');
    expect(pipe[col('params')]).toBeUndefined();
    expect(row('valve-1')[col('onPipe')]).toBe('pipe-1');
    expect(row('valve-1')[col('opacity')]).toBe(0.5);
  });

  it('works without a registry', () => {
    const bare = isoComponentTable(scene);
    expect(bare.rows).toHaveLength(4);
    expect(bare.rows[0]![bare.header.indexOf('label')]).toBeUndefined();
  });
});

describe('isoComponentsCsv', () => {
  it('starts with a BOM, uses CRLF and defuses formula text from the document', () => {
    const csv = isoComponentsCsv(scene, createIsoRegistryWithBuiltins());
    expect(csv.startsWith('﻿id,part,label,')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(6); // header + 4 rows + trailing empty
    expect(lines[lines.length - 1]).toBe('');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain(",'+danger,");
    // Negative coordinates are numbers, not defused text.
    expect(lines[1]).toContain(',2,-3,90,');
  });

  it('is just the header for an empty scene', () => {
    expect(isoComponentsCsv({ objects: [] })).toBe(`﻿${COMPONENT_COLUMNS.join(',')}\r\n`);
  });
});
