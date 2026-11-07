import { describe, expect, it } from 'vitest';
import { listParts, partDetail, similarParts } from './parts';
import { testHost } from './test-support';

describe('parts', () => {
  it('every listed part has a JSON-safe detail', async () => {
    const host = await testHost();
    const { parts, total } = listParts(host, { limit: 500, offset: 0 });
    expect(parts.length).toBe(total);
    for (const p of parts) {
      const detail = partDetail(host, p.id);
      expect(JSON.parse(JSON.stringify(detail))).toEqual(detail);
      expect(detail.package).toBe(p.package);
    }
  });

  it('a hidden part is still described (scene files may place it)', async () => {
    const host = await testHost();
    const listed = new Set(listParts(host, { limit: 500, offset: 0 }).parts.map((p) => p.id));
    expect(listed.has('elbow')).toBe(true);
    const hidden = host.registry.list<{ id: string; hideInPalette?: boolean }>('holodeck.iso.part').filter((p) => p.hideInPalette);
    for (const part of hidden) {
      expect(listed.has(part.id)).toBe(false);
      expect(partDetail(host, part.id).hidden).toBe(true);
    }
  });

  it('similarParts finds plurals and shared words', async () => {
    const host = await testHost();
    expect(similarParts(host, 'tanks')).toContain('tank');
    expect(similarParts(host, 'big valve')).toContain('valve');
    expect(similarParts(host, 'zz')).toEqual([]);
  });
});
