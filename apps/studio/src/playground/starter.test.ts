import { connectIsoDocument, type IsoPartDefinition } from '@holodeck/editor-2.5d-react';
import { HOLODECK_KINDS, SIM_PROVIDER_ID, type HolodeckHost } from '@holodeck/sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bindingProblems } from '../connections/bindings';
import { credentialInText } from '../connections/credentials';
import { parseDocumentText } from '../documents/io';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { playgroundStarter } from './playground-state';
import { createPlaygroundDocument, PERCENT_TO_FRACTION, PLAYGROUND_CONNECTION_ID, PLAYGROUND_DOCUMENT_ID, STARTER_SIGNALS } from './starter';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
afterEach(() => vi.useRealTimers());

describe('playground starter document', () => {
  it('is valid for the studio host, with requires filled in, and round-trips through import', () => {
    const doc = playgroundStarter(host);
    expect(hostDocumentProblems(host, doc)).toEqual([]);
    expect(doc.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(doc.body.id).toBe(PLAYGROUND_DOCUMENT_ID);
    expect(doc.requires).toMatchObject({ 'holodeck.iso': expect.any(String), 'holodeck.sim': expect.any(String) });
    const imported = parseDocumentText(JSON.stringify(doc), host);
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
  });

  it('has vessels, valves on pipes, labels, and every part installed', () => {
    const { body } = createPlaygroundDocument();
    const kinds = body.objects.map((o) => o.object);
    expect(kinds.filter((k) => k === 'tank' || k === 'mixer').length).toBeGreaterThanOrEqual(3);
    expect(kinds.filter((k) => k === 'valve')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'label').length).toBeGreaterThanOrEqual(3);
    for (const o of body.objects) expect(host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object), o.object).toBeDefined();
    expect(new Set(body.objects.map((o) => o.id)).size).toBe(body.objects.length);
    // Valves sit on existing pipes.
    for (const v of body.objects.filter((o) => o.object === 'valve')) expect(body.objects.some((p) => p.id === v.onPipe && p.object === 'pipe')).toBe(true);
  });

  it('starts and ends every pipe on the vessel port its attach record names (so dragging a vessel re-routes its pipes)', () => {
    const { body } = createPlaygroundDocument();
    const pipes = body.objects.filter((o) => o.object === 'pipe');
    expect(pipes).toHaveLength(2);
    for (const pipe of pipes) {
      for (const end of ['from', 'to'] as const) {
        const record = pipe.attach?.[end];
        expect(record, `${pipe.id}.${end}`).toBeDefined();
        const vessel = body.objects.find((o) => o.id === record!.object)!;
        const port = host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, vessel.object)!.ports![record!.port!]!;
        // Starter vessels are unrotated, so the port is the plain offset.
        expect(vessel.rotation ?? 0).toBe(0);
        const at = end === 'from' ? { x: pipe.x, y: pipe.y } : { x: pipe.toX, y: pipe.toY };
        expect(at, `${pipe.id}.${end}`).toEqual({ x: vessel.x + port.x, y: vessel.y + port.y });
      }
    }
  });

  it('has one secret-free sim connection, and every binding uses it with a valid source and transform', () => {
    const doc = createPlaygroundDocument();
    expect(doc.connections).toEqual([{ id: PLAYGROUND_CONNECTION_ID, provider: SIM_PROVIDER_ID, label: expect.any(String) }]);
    expect(credentialInText(JSON.stringify(doc))).toBeFalsy();
    const bindings = doc.body.objects.flatMap((o) => Object.entries(o.bindings ?? {}).map(([param, b]) => ({ object: o, param, b: b! })));
    expect(bindings.length).toBeGreaterThanOrEqual(8);
    for (const { object, param, b } of bindings) {
      expect(bindingProblems(doc.connections, b), `${object.id}.${param}`).toEqual([]);
      const def = host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, object.object)!;
      expect(def.params[param], `${object.object} has param ${param}`).toBeDefined();
    }
    // Vessel levels are 0..1 fractions: percent signals are scaled.
    for (const { object, b } of bindings.filter((x) => x.param === 'level')) expect(b.transform, object.id).toEqual(PERCENT_TO_FRACTION);
  });

  it('gives independent copies (edits never leak into the next Reset)', () => {
    const a = createPlaygroundDocument();
    a.body.objects.pop();
    a.body.objects[0]!.params!.fill = '#000000';
    a.connections![0]!.label = 'changed';
    const b = createPlaygroundDocument();
    expect(b.body.objects).toHaveLength(a.body.objects.length + 1);
    expect(b.body.objects[0]!.params!.fill).not.toBe('#000000');
    expect(b.connections![0]!.label).not.toBe('changed');
  });

  it('animates on its own: real sim values change the levels, the readings and the area accent over time', async () => {
    vi.useFakeTimers();
    let now = 0;
    const hub = host.createProviderHub({ now: () => now });
    try {
      connectIsoDocument(hub, createPlaygroundDocument());
      await vi.advanceTimersByTimeAsync(250);
      expect(hub.getSnapshot().connections[PLAYGROUND_CONNECTION_ID]?.status.state).toBe('live');
      const at = async (ms: number) => {
        now = ms;
        await vi.advanceTimersByTimeAsync(250);
        return hub.getSnapshot().metrics;
      };
      // sine:20:15:90 -> 52.5 % at t=0, 90 % at t=5 s, 15 % at t=15 s.
      let m = await at(0);
      expect(m['feed-tank']?.level).toBeCloseTo(0.525, 3);
      expect(m['feed-label']?.value).toBeCloseTo(52.5, 3);
      expect(m['feed-tank']?.alarm).toBe(false);
      expect(m['process-area']?.fill).toBe('#dcfce7');
      m = await at(5000);
      expect(m['feed-tank']?.level).toBeCloseTo(0.9, 3);
      expect(m['feed-tank']?.alarm).toBe(true);
      expect(m['feed-label']?.alarm).toBe(true);
      expect(m['process-area']?.fill).toBe('#fee2e2');
      m = await at(15000);
      expect(m['feed-tank']?.level).toBeCloseTo(0.15, 3);
      // Agitator rpm unscaled; valves follow square waves.
      expect(m.mixer?.rpm).toBeGreaterThanOrEqual(40);
      expect(m.mixer?.rpm).toBeLessThanOrEqual(180);
      expect(typeof m['inlet-valve']?.open).toBe('boolean');
      const v0 = (await at(1000))['inlet-valve']?.open;
      const v1 = (await at(4000))['inlet-valve']?.open;
      expect(v0).not.toBe(v1);
      expect(STARTER_SIGNALS.inletValve).toBe('square:6');
    } finally {
      await hub.dispose();
    }
  });
});
