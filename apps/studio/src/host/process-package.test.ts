import { HOLODECK_KINDS } from '@holodeck/sdk';
import type { IsoPartDefinition } from '@holodeck/editor-2.5d-react';
import { PROCESS_MODEL_SLUGS, PROCESS_PART_DEFINITIONS } from '@holodeck/library-process';
import { describe, expect, it } from 'vitest';
import { PROCESS_ASSET_URLS, processAssetUrl } from './process-package';
import { createStudioHost } from './studio-host';

describe('studio process package', () => {
  it('bundles exactly the GLBs the package definitions reference', () => {
    expect(Object.keys(PROCESS_ASSET_URLS).sort()).toEqual(PROCESS_PART_DEFINITIONS.map((p) => p.model).sort());
    expect(Object.keys(PROCESS_ASSET_URLS).sort()).toEqual(PROCESS_MODEL_SLUGS.map((s) => `models/${s}.glb`).sort());
    for (const [path, url] of Object.entries(PROCESS_ASSET_URLS)) {
      expect(url, path).toMatch(new RegExp(`${path.slice('models/'.length).replace('.', '\\.')}`));
    }
    expect(Object.isFrozen(PROCESS_ASSET_URLS)).toBe(true);
  });

  it('installs through its manifest with every model resolved to a bundled URL', async () => {
    const host = await createStudioHost();
    const parts = host.registry.list<IsoPartDefinition>(HOLODECK_KINDS.isoPart).filter((p) => p.id.startsWith('process:'));
    expect(parts.map((p) => p.id)).toEqual(PROCESS_PART_DEFINITIONS.map((p) => p.id));
    for (const part of parts) {
      expect(host.registry.ownerOf(HOLODECK_KINDS.isoPart, part.id)).toBe('holodeck.process');
      expect(Object.values(PROCESS_ASSET_URLS)).toContain(part.model);
    }
    // The editor contract the parts rely on reached the registry intact.
    const valve = parts.find((p) => p.id === 'process:valve-control')!;
    expect(valve.origin).toBe('pipe-axis');
    expect(valve.alarmParam).toBe('fault');
    expect(valve.animNodes?.position).toEqual({ node: 'anim.stem', animator: 'travel', settings: { axis: 'y', distance: 0.08, scale: 100 } });
  });

  it('refuses an asset path it did not bundle, including Object.prototype keys', () => {
    expect(processAssetUrl('models/motor.glb')).toBe(PROCESS_ASSET_URLS['models/motor.glb']);
    expect(() => processAssetUrl('models/pump.glb')).toThrow(/Unknown process asset: models\/pump.glb/);
    expect(() => processAssetUrl('toString')).toThrow(/Unknown process asset/);
  });
});
