import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Build scripts are plain Node ESM, not part of the published TS API.
import { compareGlb, splitGlb } from '../../scripts/glb-compare.mjs';

/** A GLB 2.0 buffer with `json` and an optional BIN chunk (both 4-byte padded). */
function glb(json: unknown, bin?: Buffer): Buffer {
  const pad = (b: Buffer, fill: number) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const chunk = (type: number, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(body.length, 0);
    head.writeUInt32LE(type, 4);
    return Buffer.concat([head, body]);
  };
  const chunks = [chunk(0x4e4f534a, pad(Buffer.from(JSON.stringify(json)), 0x20))];
  if (bin) chunks.push(chunk(0x004e4942, pad(bin, 0)));
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([head, body]);
}

const geometry = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
// The real macOS vs Linux difference seen on cdn.glb (holodeck#136).
const mac = { nodes: [{ name: 'edge-node.0', rotation: [0, 0.3826834559440613, 0, 0.9238795042037964] }] };
const linux = { nodes: [{ name: 'edge-node.0', rotation: [0, 0.3826834559440613, 0, 0.9238795638084412] }] };

describe('compareGlb', () => {
  it('reports identical bytes as identical', () => {
    expect(compareGlb(glb(mac, geometry), glb(mac, geometry))).toEqual({ identical: true, problems: [] });
  });

  it('accepts a one-ULP quaternion difference between platforms when geometry is identical', () => {
    expect(compareGlb(glb(linux, geometry), glb(mac, geometry))).toEqual({ identical: false, problems: [] });
  });

  it('rejects changed geometry (the BIN chunk)', () => {
    const moved = Buffer.from(geometry);
    moved[3] = 99;
    expect(compareGlb(glb(mac, moved), glb(mac, geometry)).problems).toEqual([
      'BIN chunk differs (8 vs 8 bytes): geometry changed',
    ]);
  });

  it('rejects numbers that moved by more than eps, names and structure, with the JSON path', () => {
    const turned = { nodes: [{ name: 'edge-node.0', rotation: [0, 0.39, 0, 0.92] }] };
    expect(compareGlb(glb(turned, geometry), glb(mac, geometry)).problems).toEqual([
      '$.nodes[0].rotation[1]: 0.39 != 0.3826834559440613',
      '$.nodes[0].rotation[3]: 0.92 != 0.9238795042037964',
    ]);
    const renamed = { nodes: [{ ...mac.nodes[0], name: 'edge-node.9' }] };
    expect(compareGlb(glb(renamed, geometry), glb(mac, geometry)).problems).toEqual(['$.nodes[0].name: "edge-node.9" != "edge-node.0"']);
    const extra = { nodes: [...mac.nodes, { name: 'new' }] };
    expect(compareGlb(glb(extra, geometry), glb(mac, geometry)).problems).toHaveLength(1);
    const withExtras = { nodes: [{ ...mac.nodes[0], extras: { a: 1 } }] };
    expect(compareGlb(glb(withExtras, geometry), glb(mac, geometry)).problems).toEqual(['$.nodes[0].extras: only in rebuilt']);
  });

  it('honours a custom eps', () => {
    const near = { v: 1.00001 };
    expect(compareGlb(glb(near), glb({ v: 1 })).problems).toHaveLength(1);
    expect(compareGlb(glb(near), glb({ v: 1 }), { eps: 1e-4 }).problems).toEqual([]);
    expect(splitGlb(glb({ v: 1 })).bin.length).toBe(0);
  });

  it('throws on a buffer that is not a GLB', () => {
    expect(() => compareGlb(Buffer.from('nope, not a glb'), glb(mac))).toThrow(/not a GLB/);
  });

  it('splits the committed valve.glb', () => {
    const { json, bin } = splitGlb(readFileSync(resolve(__dirname, '../../assets/models/valve.glb')));
    expect(json.asset.version).toBe('2.0');
    expect(bin.length).toBeGreaterThan(0);
  });
});
