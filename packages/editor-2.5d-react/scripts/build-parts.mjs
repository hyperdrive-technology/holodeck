#!/usr/bin/env node
/**
 * Build Holodeck 3D parts: runs Blender headless on holodeck/blender/parts/*.py
 * and writes assets/models/<part>.glb.
 *
 *   node scripts/build-parts.mjs                 # every part
 *   node scripts/build-parts.mjs valve mixer     # named parts
 *   node scripts/build-parts.mjs --watch [part]  # rebuild on .py change
 *   node scripts/build-parts.mjs --out-dir /tmp/x valve
 *
 * Blender is located via $BLENDER, then the macOS app bundle, then `blender`
 * on PATH. `--factory-startup` keeps user prefs/add-ons out of the export
 * (determinism); `--python-exit-code 1` makes a Python exception exit
 * non-zero (Blender otherwise exits 0 after a traceback).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export { compareGlb, splitGlb } from './glb-compare.mjs';

export const BLENDER_DIR = resolve(PKG_DIR, '../../blender');
export const PARTS_DIR = join(BLENDER_DIR, 'parts');
export const HELPER = join(BLENDER_DIR, 'holodeck_bpy.py');
export const DEFAULT_OUT_DIR = join(PKG_DIR, 'assets/models');
const MAC_BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender';

/** Absolute Blender binary, or null when none is installed. */
export function findBlender() {
  if (process.env.BLENDER) return existsSync(process.env.BLENDER) ? process.env.BLENDER : null;
  if (existsSync(MAC_BLENDER)) return MAC_BLENDER;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const hit = which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : '';
  return hit || null;
}

export function listParts() {
  return readdirSync(PARTS_DIR)
    .filter((f) => f.endsWith('.py') && !f.startsWith('_'))
    .map((f) => basename(f, '.py'))
    .sort();
}

/** Keep the useful part of Blender's chatty log for an error message. */
function summarize(log) {
  const lines = log.split(/\r?\n/);
  const tb = lines.findIndex((l) => l.startsWith('Traceback'));
  const picked = tb >= 0 ? lines.slice(tb) : lines.filter((l) => /error|exception|warning/i.test(l));
  return (picked.length ? picked : lines.slice(-25)).filter(Boolean).slice(0, 60).join('\n');
}

/**
 * Build one part. Resolves { part, out, ms } or rejects with an Error whose
 * message holds the traceback.
 */
export function buildPart(part, { outDir = DEFAULT_OUT_DIR, blender = findBlender(), quiet = false } = {}) {
  const script = join(PARTS_DIR, `${part}.py`);
  const out = join(outDir, `${part}.glb`);
  if (!blender) return Promise.reject(new Error('Blender not found: set $BLENDER or install Blender'));
  if (!existsSync(script)) return Promise.reject(new Error(`no such part: ${script}`));
  const started = Date.now();
  const before = existsSync(out) ? statSync(out).mtimeMs : 0;
  return new Promise((ok, fail) => {
    const child = spawn(
      blender,
      ['-b', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', '--out', out],
      { cwd: BLENDER_DIR, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let log = '';
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    child.on('error', (err) => fail(new Error(`${part}: failed to start Blender (${blender}): ${err.message}`)));
    child.on('close', (code, signal) => {
      const fresh = existsSync(out) && statSync(out).mtimeMs !== before;
      if (code !== 0 || !fresh) {
        const why = code !== 0 ? `exit ${code ?? signal}` : 'no GLB written';
        fail(new Error(`${part}: Blender ${why}\n${summarize(log)}`));
        return;
      }
      const ms = Date.now() - started;
      if (!quiet) console.log(`✓ ${part} -> ${out} (${statSync(out).size} B, ${ms} ms)`);
      ok({ part, out, ms });
    });
  });
}

/** Build sequentially; returns the number of failures. */
async function buildAll(parts, opts) {
  let failed = 0;
  for (const part of parts) {
    try {
      await buildPart(part, opts);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${err.message}`);
    }
  }
  return failed;
}

function watchParts(parts, opts) {
  const pending = new Set();
  let timer = null;
  let running = false;
  const flush = async () => {
    if (running) return; // re-flushed when the current batch ends
    running = true;
    while (pending.size) {
      const batch = [...pending];
      pending.clear();
      await buildAll(batch, opts);
    }
    running = false;
  };
  const queue = (names) => {
    names.forEach((n) => pending.add(n));
    clearTimeout(timer);
    timer = setTimeout(flush, 200); // editors write files in several events
  };
  // Watch directories, not files: editors that save via rename would
  // otherwise detach a per-file watcher.
  watch(BLENDER_DIR, (_evt, file) => {
    if (file === basename(HELPER)) queue(parts.length ? parts : listParts());
  });
  watch(PARTS_DIR, (_evt, file) => {
    if (!file || !file.endsWith('.py')) return;
    const name = basename(file, '.py');
    if ((parts.length === 0 || parts.includes(name)) && existsSync(join(PARTS_DIR, file))) queue([name]);
  });
  console.log(`watching ${BLENDER_DIR} (ctrl-c to stop)`);
}

async function main(argv) {
  const args = [...argv];
  const opts = {};
  let watchMode = false;
  const parts = [];
  while (args.length) {
    const a = args.shift();
    if (a === '--watch') watchMode = true;
    else if (a === '--out-dir') opts.outDir = resolve(args.shift() ?? '');
    else if (a === '-h' || a === '--help') {
      console.log('usage: build-parts.mjs [--watch] [--out-dir DIR] [part ...]');
      return 0;
    } else if (a.startsWith('-')) {
      console.error(`unknown flag ${a}`);
      return 2;
    } else parts.push(a.replace(/\.py$/, ''));
  }
  opts.blender = findBlender();
  if (!opts.blender) {
    console.error('Blender not found. Set $BLENDER or install Blender (macOS: /Applications/Blender.app).');
    return 1;
  }
  const known = listParts();
  const unknown = parts.filter((p) => !known.includes(p));
  if (unknown.length) {
    console.error(`unknown part(s): ${unknown.join(', ')} — available: ${known.join(', ')}`);
    return 1;
  }
  const failed = await buildAll(parts.length ? parts : known, opts);
  if (watchMode) {
    watchParts(parts, opts);
    return null; // keep running
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== null) process.exit(code);
  });
}
