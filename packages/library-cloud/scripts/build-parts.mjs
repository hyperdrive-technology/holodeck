#!/usr/bin/env node
/** Build the complete catalogue, or named parts, with the shared Blender contract. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compareGlb, findBlender } from '../../editor-2.5d-react/scripts/build-parts.mjs';

export { compareGlb, findBlender };
export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PARTS_DIR = resolve(PACKAGE_DIR, '../../blender/parts/cloud');
export const DEFAULT_OUT_DIR = join(PACKAGE_DIR, 'assets/models');
const definitions = JSON.parse(readFileSync(join(PACKAGE_DIR, 'src/parts.json'), 'utf8'));
export const listParts = () => definitions.map((part) => part.id.slice('cloud:'.length));

export async function buildPart(part, { outDir = DEFAULT_OUT_DIR, previewDir, blender = findBlender(), quiet = false } = {}) {
  if (!listParts().includes(part)) throw new Error(`Unknown cloud archetype: ${part}`);
  if (!blender) throw new Error('Blender not found; set BLENDER or install Blender.');
  const script = join(PARTS_DIR, `${part}.py`);
  if (!existsSync(script)) throw new Error(`Missing Blender script: ${script}`);
  mkdirSync(outDir, { recursive: true });
  if (previewDir) mkdirSync(previewDir, { recursive: true });
  const out = resolve(outDir, `${part}.glb`);
  const preview = previewDir ? resolve(previewDir, `${part}.png`) : undefined;
  const outputs = [out, ...(preview ? [preview] : [])];
  const before = outputs.map((path) => existsSync(path) ? statSync(path).mtimeMs : null);
  const args = ['-b', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', '--out', out];
  if (preview) args.push('--preview', preview);
  await new Promise((ok, fail) => {
    const child = spawn(blender, args, { cwd: PARTS_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (data) => { log += data; });
    child.stderr.on('data', (data) => { log += data; });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      const fresh = outputs.every((path, i) => existsSync(path) && statSync(path).size > 0 && statSync(path).mtimeMs !== before[i]);
      if (code !== 0 || !fresh) {
        fail(new Error(`${part}: Blender ${code !== 0 ? `exited ${code ?? signal}` : 'did not write all outputs'}\n${log.trim().slice(-8000)}`));
      } else ok();
    });
  });
  if (!quiet) console.log(`${part}: ${statSync(out).size} bytes${preview ? `; preview ${preview}` : ''}`);
  return { part, out, preview };
}

async function main(args) {
  const options = {};
  const selected = [];
  while (args.length) {
    const arg = args.shift();
    if (arg === '--out-dir' || arg === '--preview-dir') {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a directory`);
      options[arg === '--out-dir' ? 'outDir' : 'previewDir'] = resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      console.log('build-parts.mjs [--out-dir DIR] [--preview-dir DIR] [archetype ...]');
      return;
    } else if (!listParts().includes(arg)) throw new Error(`Unknown archetype/option: ${arg}`);
    else selected.push(arg);
  }
  const parts = selected.length ? [...new Set(selected)] : listParts();
  let failures = 0;
  for (const part of parts) {
    try { await buildPart(part, options); }
    catch (error) { failures++; console.error(error.message); }
  }
  console.log(`${parts.length - failures}/${parts.length} cloud archetypes built`);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
