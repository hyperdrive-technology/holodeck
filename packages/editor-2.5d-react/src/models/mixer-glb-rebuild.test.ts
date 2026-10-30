/**
 * mixer.glb rebuild-and-compare (holodeck#229): rebuilds the mixer from
 * blender/parts/mixer.py + blender/primitives.py with headless Blender and
 * requires the committed GLB to match (same rule as valve-glb.test.ts:
 * geometry byte-identical, glTF JSON within compareGlb's float tolerance).
 * Skips without Blender; .github/workflows/blender-drift.yml runs it with
 * HOLODECK_REQUIRE_BLENDER=1 (valve-glb.test.ts holds the "Blender found" guard).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs build script, no type declarations
import { buildPart, compareGlb, findBlender } from '../../scripts/build-parts.mjs';

const GLB = resolve(import.meta.dirname, '../../assets/models/mixer.glb');
const blender = findBlender() as string | null;

describe.skipIf(!blender)('mixer.glb rebuild (needs Blender)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hd-mixer-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('the committed mixer.glb matches a fresh build of blender/parts/mixer.py', async () => {
    await buildPart('mixer', { outDir: dir, blender, quiet: true });
    const out = join(dir, 'mixer.glb');
    expect(existsSync(out)).toBe(true);
    expect(compareGlb(readFileSync(out), readFileSync(GLB)).problems).toEqual([]);
  }, 180_000);
});
