/**
 * Live values: HolodeckHost + holodeck.iso package + the SDK's sim provider
 * (driven by a manual schedule and a fixed clock) -> ProviderHub -> metrics.
 *
 * No DOM in this package's tests (environment: node, no @testing-library), so
 * the store behind `useHubMetrics` is tested directly and the hook itself
 * through server rendering, which reads the same snapshot.
 */
import {
  HolodeckHost,
  SIM_PROVIDER_ID,
  createManualSchedule,
  createSimProvider,
  type HolodeckPackageManifest,
  type ProviderHub,
} from '@holodeck/sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ISO_PACKAGE_MANIFEST, isoPackage } from '../holodeck-package';
import { BUILTIN_ISO_PARTS } from '../registry/builtin';
import { resolveParams } from '../registry/params';
import { loadIsoDocument, toIsoDocument } from './document';
import { isoEngine } from './iso-engine';
import { connectIsoDocument, hubMetricsStore, useHubMetrics } from './live';

const SIM_MANIFEST: HolodeckPackageManifest = {
  schemaVersion: 'holodeck.package.v1',
  id: 'holodeck.sim',
  name: 'Simulated signals',
  version: '1.0.0',
  license: 'MIT',
  contributes: ['holodeck.provider'],
  providers: [SIM_PROVIDER_ID],
  entry: 'index.js',
};

const plant = { id: 'plant', provider: SIM_PROVIDER_ID };
const toFraction = { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1 } as const;

function rawDocument(bindings: Record<string, Record<string, unknown>>) {
  return {
    format: 'holodeck.document.v1',
    id: 'plant-doc',
    name: 'Plant',
    engine: 'holodeck.iso',
    engineVersion: '1.0.0',
    connections: [plant],
    body: {
      id: 'plant',
      name: 'Plant',
      gridCellSize: 1,
      objects: [
        { id: 't1', object: 'tank', x: 0, y: 0, bindings: bindings.t1 },
        { id: 'v1', object: 'valve', x: 3, y: 0, bindings: bindings.v1 },
        { id: 'p1', object: 'pipe', x: 1, y: 0, toX: 2, toY: 0 },
      ],
    },
  };
}

async function setup(bindings: Record<string, Record<string, unknown>>) {
  const clock = { now: 2_500 };
  const schedule = createManualSchedule();
  const host = new HolodeckHost({ name: 'test' });
  host.registerEngine(isoEngine);
  await host.installPackage(ISO_PACKAGE_MANIFEST, isoPackage);
  await host.installPackage(SIM_MANIFEST, {
    id: 'holodeck.sim',
    version: '1.0.0',
    contributions: { 'holodeck.provider': [createSimProvider({ schedule: schedule.schedule, intervalMs: 100 })] },
  });
  // The document's parts resolve against the host's registry (built-ins came from the package).
  const { document, scene } = loadIsoDocument(rawDocument(bindings), host.registry);
  const hub = host.createProviderHub({ now: () => clock.now });
  connectIsoDocument(hub, document);
  await hub.settled();
  return { clock, schedule, host, hub, document, scene };
}

describe('connectIsoDocument + hubMetricsStore', () => {
  it('turns bound sim signals into metrics keyed by placement id and param', async () => {
    const { hub } = await setup({
      t1: { level: { connection: 'plant', source: 'ramp:10', transform: toFraction }, temp: { connection: 'plant', source: 'const:65' } },
      v1: { open: { connection: 'plant', source: 'square:4' } },
    });
    const store = hubMetricsStore(hub);
    // ramp:10 at t = 2.5 s is 25 (of 0..100), scaled to 0.25; square:4 is high for the first 2 s of 4.
    expect(store.getSnapshot()).toEqual({ t1: { level: 0.25, temp: 65 }, v1: { open: false } });
    expect(hub.getSnapshot().connections.plant?.status.state).toBe('live');
    await hub.dispose();
  });

  it('notifies subscribers on every tick that changes a value, and getSnapshot follows', async () => {
    const { hub, clock, schedule } = await setup({ t1: { level: { connection: 'plant', source: 'ramp:10', transform: toFraction } } });
    const store = hubMetricsStore(hub);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    clock.now = 5_000;
    schedule.tick();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().t1?.level).toBeCloseTo(0.5);
    clock.now = 7_500;
    schedule.tick();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().t1?.level).toBeCloseTo(0.75);
    off();
    clock.now = 9_000;
    schedule.tick();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().t1?.level).toBeCloseTo(0.9);
    await hub.dispose();
  });

  it('keeps the metrics identity until a value changes (cheap React re-renders)', async () => {
    const { hub, schedule } = await setup({ t1: { temp: { connection: 'plant', source: 'const:65' } } });
    const store = hubMetricsStore(hub);
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    schedule.tick(); // same constant again
    expect(store.getSnapshot()).toBe(before);
    expect(Object.isFrozen(before)).toBe(true);
    await hub.dispose();
  });

  it('writes go through the binding (mem: sources are writable)', async () => {
    const { hub, schedule } = await setup({ v1: { open: { connection: 'plant', source: 'mem:valve' } } });
    const store = hubMetricsStore(hub);
    expect(store.getSnapshot()).toEqual({ v1: { open: null } });
    await hub.write('v1', 'open', true);
    schedule.tick();
    expect(store.getSnapshot()).toEqual({ v1: { open: true } });
    await hub.dispose();
  });

  it('metrics feed resolveParams: live values override static params and defaults', async () => {
    const { hub, scene } = await setup({ t1: { level: { connection: 'plant', source: 'ramp:10', transform: toFraction } } });
    const tankDef = BUILTIN_ISO_PARTS.find((p) => p.id === 'tank')!;
    const t1 = scene.objects.find((o) => o.id === 't1')!;
    const params = resolveParams(tankDef, { ...t1, params: { level: 0.9, temp: 30 } }, hubMetricsStore(hub).getSnapshot());
    expect(params).toMatchObject({ level: 0.25, temp: 30, alarm: false });
    await hub.dispose();
  });

  it('re-connecting an edited document rebinds: removed bindings drop out', async () => {
    const { hub, document, schedule } = await setup({
      t1: { level: { connection: 'plant', source: 'ramp:10', transform: toFraction } },
      v1: { open: { connection: 'plant', source: 'const:true' } },
    });
    const edited = loadIsoDocument(rawDocument({ v1: { open: { connection: 'plant', source: 'const:false' } } }), undefined);
    expect(edited.scene.objects[0]?.bindings).toBeUndefined();
    connectIsoDocument(hub, { ...document, body: edited.scene });
    await hub.settled();
    schedule.tick();
    expect(hubMetricsStore(hub).getSnapshot()).toEqual({ v1: { open: false } });
    await hub.dispose();
  });

  it('a document without connections or bindings gives empty metrics', async () => {
    const host = new HolodeckHost({ name: 'test' });
    const hub = host.createProviderHub();
    connectIsoDocument(hub, toIsoDocument(loadIsoDocument({ id: 's', name: 'S', gridCellSize: 1, objects: [] }).scene));
    expect(hubMetricsStore(hub).getSnapshot()).toEqual({});
    await hub.dispose();
  });

  it('refuses a document for another engine', () => {
    const hub = new HolodeckHost({ name: 'test' }).createProviderHub();
    expect(() => connectIsoDocument(hub, { engine: 'holodeck.flow', body: { id: 'x', name: 'x', gridCellSize: 1, objects: [] } })).toThrow(
      /not "holodeck.iso"/,
    );
  });

  it('a malformed binding in an unvalidated body makes the hub throw (load documents first)', () => {
    const hub = new HolodeckHost({ name: 'test' }).createProviderHub();
    const body = { id: 'x', name: 'x', gridCellSize: 1, objects: [{ id: 't1', object: 'tank', x: 0, y: 0, bindings: { level: { connection: 'plant' } } }] };
    expect(() => connectIsoDocument(hub, { connections: [plant], body: body as never })).toThrow(TypeError);
  });
});

describe('hubMetricsStore without a hub', () => {
  it('is an empty, frozen, never-changing store', () => {
    const store = hubMetricsStore(undefined);
    expect(store.getSnapshot()).toEqual({});
    expect(store.getSnapshot()).toBe(hubMetricsStore(undefined).getSnapshot());
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    const off = store.subscribe(() => {
      throw new Error('never called');
    });
    expect(off).toBeTypeOf('function');
    off();
  });
});

describe('useHubMetrics', () => {
  function Probe({ hub }: { hub: ProviderHub | undefined }) {
    const metrics = useHubMetrics(hub);
    return <pre>{JSON.stringify(metrics)}</pre>;
  }

  it('renders the hub snapshot (server rendering uses getSnapshot as getServerSnapshot)', async () => {
    const { hub } = await setup({ t1: { temp: { connection: 'plant', source: 'const:65' } } });
    expect(renderToStaticMarkup(<Probe hub={hub} />)).toBe('<pre>{&quot;t1&quot;:{&quot;temp&quot;:65}}</pre>');
    await hub.dispose();
  });

  it('renders empty metrics without a hub', () => {
    expect(renderToStaticMarkup(<Probe hub={undefined} />)).toBe('<pre>{}</pre>');
  });
});
