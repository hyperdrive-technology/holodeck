/**
 * tests/snapshots/ holds committed comparison inputs only; every review shot a
 * render test writes goes to artifacts/ (artifactsDir), which CI uploads as the
 * render-artifacts artifact. Before holodeck#73 six render tests wrote into the
 * gitignored tests/snapshots/, so CI runs lost their shots.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PKG_ROOT = path.resolve(import.meta.dirname, '../..');
/** The only tests/snapshots/ files a test may name: committed inputs it reads. */
const COMMITTED_INPUTS = new Set(['reference-canvas.png', 'reference.jpg']);

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile() && /\.test\.tsx?$/.test(d.name))
    .map((d) => path.join(d.parentPath, d.name));
}

describe('render output layout', () => {
  const files = testFiles(path.join(PKG_ROOT, 'src'));

  it('finds the render tests', () => {
    expect(files.filter((f) => f.endsWith('-render.test.ts')).length).toBeGreaterThanOrEqual(8);
  });

  it('never points a test at tests/snapshots/ except to read a committed input', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === import.meta.filename) continue;
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/tests\/snapshots(?:\/([\w.-]*))?/g)) {
        if (!m[1] || !COMMITTED_INPUTS.has(m[1])) offenders.push(`${path.relative(PKG_ROOT, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
