import { connectIsoDocument, gridToWorld, isIsoPartDefinition, type IsoPartDefinition, type IsoPlacement } from '@holodeck/editor-2.5d-react';
import { PROCESS_MODELS, PROCESS_PART_DEFINITIONS } from '@holodeck/library-process';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it, vi } from 'vitest';
import sample from '../../samples/process-line.holodeck.json';
import { parseDocumentText } from '../documents/io';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { playgroundProcessSample } from '../playground/playground-state';
import { PLAYGROUND_DOCUMENT_ID, PLAYGROUND_DOCUMENT_NAME } from '../playground/starter';
import { createProcessLineDocument } from './process-line';

const objects = () => createProcessLineDocument('t').body.objects;
const byId = (id: string) => objects().find((o) => o.id === id)!;
const slug = (o: IsoPlacement) => o.object.slice('process:'.length);

describe('Process line sample', () => {
  it('imports through the real host, with every process part installed and valid', async () => {
    const host = await createStudioHost();
    const result = parseDocumentText(JSON.stringify(sample), host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(hostDocumentProblems(host, createProcessLineDocument())).toEqual([]);
    const used = new Set(objects().map((o) => o.object).filter((id) => id.startsWith('process:')));
    // Every pilot part appears in the sample.
    expect([...used].sort()).toEqual(PROCESS_PART_DEFINITIONS.map((p) => p.id).sort());
    for (const id of used) {
      const part = host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id);
      expect(part && isIsoPartDefinition(part), id).toBe(true);
    }
  });

  it('loads as the playground document (fixed id and name, requires filled in for this host)', async () => {
    const host = await createStudioHost();
    const doc = playgroundProcessSample(host);
    expect(doc.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(doc.body.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(doc.name).toBe(PLAYGROUND_DOCUMENT_NAME);
    expect(doc.requires).toMatchObject({ 'holodeck.process': expect.any(String), 'holodeck.sim': expect.any(String) });
    expect(hostDocumentProblems(host, doc)).toEqual([]);
  });

  it('puts both valves on the feed pipe, aligned with it', () => {
    const pipe = byId('feed-pipe');
    expect(pipe.y).toBe(pipe.toY);
    for (const id of ['xv-101', 'tv-101']) {
      const valve = byId(id);
      expect(valve.onPipe).toBe('feed-pipe');
      expect(valve.y).toBe(pipe.y);
      expect(valve.x).toBeGreaterThan(pipe.x);
      expect(valve.x).toBeLessThan(pipe.toX!);
      // Unrotated: the GLB's pipe axis (local X) runs along this east-west pipe.
      expect(valve.rotation ?? 0).toBe(0);
      expect(valve.at).toBeCloseTo((valve.x - pipe.x) / (pipe.toX! - pipe.x), 2);
    }
  });

  it("ends the exchanger pipe exactly on E-101's tube-in flange face", () => {
    const pipe = byId('exchanger-pipe');
    const exchanger = byId('e-101');
    expect(exchanger.rotation ?? 0).toBe(0);
    const [nx, ny, nz] = PROCESS_MODELS[slug(exchanger)]!.ports['tube-in']!;
    const [cx, , cz] = gridToWorld(exchanger.x, exchanger.y);
    const [ex, , ez] = gridToWorld(pipe.toX!, pipe.toY!);
    expect(ex).toBeCloseTo(cx + nx, 9);
    expect(ez).toBeCloseTo(cz + nz, 9);
    // The nozzle axis is at the floor pipe height, and the pipe arrives along it (north, into the +Z face).
    expect(ny).toBeCloseTo(0.32, 9);
    expect(pipe.x).toBe(pipe.toX);
    expect(pipe.y).toBeGreaterThan(pipe.toY!);
    // And the run is continuous from the tank: the feed pipe and this one meet at the elbow.
    const elbow = byId('feed-elbow');
    expect([byId('feed-pipe').toX, byId('feed-pipe').toY]).toEqual([elbow.x, elbow.y]);
    expect([pipe.x, pipe.y]).toEqual([elbow.x, elbow.y]);
  });

  it('keeps the floor parts off the pipes and each other', () => {
    const boxes = objects()
      .filter((o) => o.object.startsWith('process:') && !o.onPipe)
      .map((o) => {
        const [fx, fz] = PROCESS_MODELS[slug(o)]!.footprint;
        return { id: o.id, minX: o.x - fx / 2, maxX: o.x + fx / 2, minY: o.y - fz / 2, maxY: o.y + fz / 2 };
      });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlap, `${a.id} / ${b.id}`).toBe(false);
      }
    }
    const feed = byId('feed-pipe');
    for (const box of boxes) expect(box.minY > feed.y || box.maxY < feed.y || box.maxX < feed.x || box.minX > feed.toX!, box.id).toBe(true);
  });

  it('creates fresh copies', () => {
    const a = createProcessLineDocument();
    const b = createProcessLineDocument();
    expect(a.id).not.toBe(b.id);
    a.body.objects.pop();
    expect(b.body.objects).toHaveLength(sample.body.objects.length);
  });

  it('streams sim signals into the process params: stem position, running, fault and temperatures', async () => {
    vi.useFakeTimers();
    const host = await createStudioHost();
    let now = 1000;
    const hub = host.createProviderHub({ now: () => now });
    try {
      connectIsoDocument(hub, createProcessLineDocument());
      await vi.advanceTimersByTimeAsync(250);
      expect(hub.getSnapshot().connections.sim?.status.state).toBe('live');
      let metrics = hub.getSnapshot().metrics;
      // t = 1 s: sine:16:0:100 = 50 + 50 sin(2 pi / 16).
      expect(metrics['tv-101']?.position).toBeCloseTo(50 + 50 * Math.sin((2 * Math.PI) / 16), 6);
      expect(metrics['m-101']?.running).toBe(true); // square:10, first half
      expect(metrics['m-101']?.fault).toBe(false); // ramp:40 at 2.5 %
      expect(metrics['xv-101']?.open).toBe(true);
      expect(typeof metrics['tt-101']?.value).toBe('number');
      expect(metrics['tt-101']?.alarm).toBe(false);
      // t = 39 s: the ramp is at 97.5 %: every trip threshold (92, 95) is on; square:10 is in its off half.
      now = 39_000;
      await vi.advanceTimersByTimeAsync(250);
      metrics = hub.getSnapshot().metrics;
      expect(metrics['tv-101']?.fault).toBe(true);
      expect(metrics['mcc-1']?.fault).toBe(true);
      expect(metrics['m-101']?.fault).toBe(true);
      expect(metrics['m-101']?.running).toBe(false);
      expect(metrics['xv-101']?.open).toBe(true); // square:12 at 39 s: phase 3/12, first half
    } finally {
      await hub.dispose();
      vi.useRealTimers();
    }
  });
});
