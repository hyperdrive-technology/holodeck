import { connectIsoDocument, type IsoPartDefinition } from '@holodeck/editor-2.5d-react';
import { HOLODECK_KINDS } from '@holodeck/sdk';
import { describe, expect, it, vi } from 'vitest';
import sample from '../../samples/three-tier-web-app.holodeck.json';
import { parseDocumentText } from '../documents/io';
import { createStudioHost, hostDocumentProblems } from '../host/studio-host';
import { createSampleDocument } from './three-tier-web-app';

describe('Three-tier web app sample', () => {
  it('imports through the real host with cloud assets, themes and valid connector anchors', async () => {
    const host = await createStudioHost();
    const result = parseDocumentText(JSON.stringify(sample), host);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(hostDocumentProblems(host, createSampleDocument())).toEqual([]);
    expect(host.registry.get(HOLODECK_KINDS.isoTheme, 'arcentry-light')).toBeDefined();
    const parts = host.registry.list<IsoPartDefinition>(HOLODECK_KINDS.isoPart).filter((p) => p.id.startsWith('cloud:'));
    expect(parts).toHaveLength(26);
    for (const part of parts) {
      expect(part.model).toMatch(/\.glb/);
      expect(part.logo?.url).toMatch(/\.svg|^data:image\/svg\+xml,/);
    }
    const doc = createSampleDocument();
    const ids = new Set(doc.body.objects.map((o) => o.id));
    for (const o of doc.body.objects.filter((o) => o.object === 'connector')) {
      for (const anchor of [o.link?.from, o.link?.to]) {
        expect(anchor && 'object' in anchor && ids.has(anchor.object)).toBe(true);
      }
    }
  });

  it('creates fresh copies with independent objects, connection configs and envelope/body ids', () => {
    const a = createSampleDocument();
    const b = createSampleDocument();
    expect(a.id).not.toBe(b.id);
    expect(a.body.id).toBe(a.id);
    expect(b.body.id).toBe(b.id);
    a.body.objects.pop();
    a.connections![0]!.label = 'Changed';
    expect(b.body.objects).toHaveLength(sample.body.objects.length);
    expect(createSampleDocument().connections![0]!.label).toBe('Demo traffic (simulated)');
  });

  it('streams real sim signals through threshold, format and scale transforms', async () => {
    vi.useFakeTimers();
    const host = await createStudioHost();
    let now = 1000;
    const hub = host.createProviderHub({ now: () => now });
    try {
      connectIsoDocument(hub, createSampleDocument());
      await vi.advanceTimersByTimeAsync(250);
      expect(hub.getSnapshot().connections.demo?.status.state).toBe('live');
      let metrics = hub.getSnapshot().metrics;
      expect(metrics['requests-label']?.text).toBe('Requests 200 req/s');
      expect(metrics['web-1']?.color).toBe('#22c55e');
      expect(metrics['cpu-label']?.value).toBe(0.125);
      now = 6000;
      await vi.advanceTimersByTimeAsync(250);
      metrics = hub.getSnapshot().metrics;
      expect(metrics['requests-label']?.text).toBe('Requests 100 req/s');
      expect(metrics['web-1']?.color).toBe('#f59e0b');
      expect(metrics['cpu-label']?.value).toBe(0.75);
      now = 7000;
      await vi.advanceTimersByTimeAsync(250);
      expect(hub.getSnapshot().metrics['web-1']?.color).toBe('#ef4444');
    } finally {
      await hub.dispose();
      vi.useRealTimers();
    }
  });
});
