/**
 * Test helpers for the Blender part tools: hand-built GLBs, a fake Blender
 * binary, and a throwaway holodeck repo layout. Test-only (no entry imports it).
 */

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { defaultRepoRoot, modelIndexSource } from './part-files';

/** A valid part: a 1 x 1 x 1 box on the floor (hd.white) with one port. */
export function goodPartJson(): Record<string, any> {
  return {
    asset: { version: '2.0', generator: 'holodeck test' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { name: 'body', mesh: 0 },
      { name: 'port.in', translation: [0.5, 0.5, 0] },
    ],
    meshes: [{ name: 'body', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'hd.white' }],
    accessors: [
      { count: 24, min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5], type: 'VEC3', componentType: 5126 },
      { count: 36, type: 'SCALAR', componentType: 5123 },
    ],
  };
}

/** A GLB (JSON chunk only) of `json`. */
export function glbOf(json: unknown): Uint8Array {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const body = Buffer.from(text, 'utf8');
  const out = Buffer.alloc(20 + body.byteLength);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.byteLength, 8);
  out.writeUInt32LE(body.byteLength, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  body.copy(out, 20);
  return new Uint8Array(out);
}

/** `goodPartJson()` changed by `edit`, as a GLB. */
export function partGlb(edit: (json: Record<string, any>) => void = () => undefined): Uint8Array {
  const json = goodPartJson();
  edit(json);
  return glbOf(json);
}

/** A small PNG that is not one flat colour. */
export function twoColourPng(): Buffer {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(i < png.data.length / 2 ? [255, 255, 255, 255] : [192, 57, 43, 255], i);
  return PNG.sync.write(png);
}

/**
 * A fake Blender (Node script). `--version` prints a version line; otherwise
 * it reads the `--python` script and acts on `# FAKE:` markers in it:
 *
 *   # FAKE: copy <abs glb>   copy that file to --out (default: write nothing)
 *   # FAKE: fail             print a Python traceback, exit 1
 *   # FAKE: hang <pidfile>   fork a `sleep` grandchild, write both pids, never exit
 *   # FAKE: spam             print ~1 MB of output first
 *
 * With `--preview`, it writes a small PNG there. Every run records its argv,
 * cwd and environment keys next to --out (`<out>.run.json`).
 */
export const FAKE_BLENDER = `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('Blender 9.9.9 (fake)'); console.log('\\tbuild date: never'); process.exit(0); }
const at = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const script = at('--python');
const after = argv.slice(argv.indexOf('--') + 1);
const out = after[after.indexOf('--out') + 1];
const preview = after.includes('--preview') ? after[after.indexOf('--preview') + 1] : undefined;
const src = fs.readFileSync(script, 'utf8');
const marker = (name) => { const m = new RegExp('# FAKE: ' + name + '(?: (.*))?').exec(src); return m ? (m[1] ?? '').trim() : null; };
fs.writeFileSync(out + '.run.json', JSON.stringify({ argv, cwd: process.cwd(), env: Object.keys(process.env).sort() }));
if (marker('spam') !== null) { const line = 'x'.repeat(99) + '\\n'; for (let i = 0; i < 10000; i++) process.stdout.write(line); console.log('LAST LINE'); }
if (marker('fail') !== null) {
  console.log('Blender 9.9.9 (fake)');
  console.error('Traceback (most recent call last):');
  console.error('  File "' + script + '", line 3, in build');
  console.error('RuntimeError: material "steel" is not hd.*');
  process.exit(1);
}
const hang = marker('hang');
if (hang !== null) {
  const child = spawn('sleep', ['300'], { stdio: 'ignore' });
  fs.writeFileSync(hang, JSON.stringify({ parent: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
} else {
  const copy = marker('copy');
  if (copy) fs.copyFileSync(copy, out);
  if (preview && copy) fs.writeFileSync(preview, Buffer.from(${JSON.stringify(twoColourPng().toString('base64'))}, 'base64'));
  console.log('[holodeck] wrote ' + out);
}
`;

export async function writeFakeBlender(dir: string): Promise<string> {
  const path = join(dir, 'fake-blender');
  await writeFile(path, FAKE_BLENDER);
  await chmod(path, 0o755);
  return path;
}

/**
 * A minimal holodeck repo: blender/holodeck_bpy.py (the real one),
 * blender/parts/valve.py, and assets/models with valve.glb and its index.ts.
 */
export async function makeRepo(dir: string): Promise<string> {
  const real = defaultRepoRoot();
  const root = join(dir, 'repo');
  const models = join(root, 'packages/editor-2.5d-react/assets/models');
  await mkdir(join(root, 'blender/parts'), { recursive: true });
  await mkdir(models, { recursive: true });
  await copyFile(join(real, 'blender/holodeck_bpy.py'), join(root, 'blender/holodeck_bpy.py'));
  await copyFile(join(real, 'blender/parts/valve.py'), join(root, 'blender/parts/valve.py'));
  await copyFile(join(real, 'packages/editor-2.5d-react/assets/models/valve.glb'), join(models, 'valve.glb'));
  await writeFile(join(models, 'index.ts'), modelIndexSource(['valve']));
  return resolve(root);
}
