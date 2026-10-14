/**
 * The brewery render tests use vendored copies of core's HMI scenes
 * (tests/fixtures/brewery) so they run in a holodeck-only checkout (CI). When
 * core is checked out next to this repo, fail if a copy drifted; refresh with
 *   cp <core>/src/typescript/packages/hyperdrive-ui/examples/brewery/hmi/{brewhouse,cellar}.iso.json tests/fixtures/brewery/
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pkgRoot = path.resolve(import.meta.dirname, '../..');
const fixtures = path.join(pkgRoot, 'tests/fixtures/brewery');
const coreHmi = path.resolve(pkgRoot, '../../../core/src/typescript/packages/hyperdrive-ui/examples/brewery/hmi');

describe('brewery scene fixtures', () => {
  for (const name of ['brewhouse', 'cellar']) {
    it(`${name}.iso.json fixture exists and parses`, () => {
      const scene = JSON.parse(readFileSync(path.join(fixtures, `${name}.iso.json`), 'utf8'));
      expect(scene.objects.length).toBeGreaterThan(0);
    });
    // Only meaningful where core is checked out as a sibling (local dev); a holodeck-only CI has nothing to compare.
    it.skipIf(!existsSync(path.join(coreHmi, `${name}.iso.json`)))(`${name}.iso.json matches core's copy`, () => {
      expect(readFileSync(path.join(fixtures, `${name}.iso.json`), 'utf8')).toBe(
        readFileSync(path.join(coreHmi, `${name}.iso.json`), 'utf8'),
      );
    });
  }
});
