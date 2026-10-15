/**
 * Node-side I/O for the visual tests: PNG read/write (pngjs), the artifacts
 * directory agents read, and the fidelity record. Kept out of fidelity.ts so
 * the metric stays pure.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { FidelityRecordFile, RgbaImage } from './fidelity';

const PKG_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Where visual runs write their output (gitignored). Override with
 * HOLODECK_ARTIFACTS_DIR, e.g. to collect several runs side by side.
 */
export function artifactsDir(sub = 'visual'): string {
  const dir = path.resolve(process.env.HOLODECK_ARTIFACTS_DIR ?? path.join(PKG_ROOT, 'artifacts'), sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The ratchet record: committed, tightened by `pnpm visual:record`. */
export const FIDELITY_RECORD_PATH = path.join(PKG_ROOT, 'tests/visual/reference-fidelity.json');

export function decodePng(buffer: Buffer): RgbaImage {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}

export function readPng(file: string): RgbaImage {
  return decodePng(readFileSync(file));
}

export function writePng(file: string, img: RgbaImage): void {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

export function readRecord(file = FIDELITY_RECORD_PATH): FidelityRecordFile {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as FidelityRecordFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { description: RECORD_DESCRIPTION, platforms: {} };
    }
    throw error;
  }
}

export function writeRecord(record: FidelityRecordFile, file = FIDELITY_RECORD_PATH): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}

export const RECORD_DESCRIPTION =
  'Arcentry fidelity ratchet for src/iso/scene-render.test.ts: render of tests/scene.json vs tests/snapshots/reference-canvas.png ' +
  '(760x540, DPR 1). fidelity = 1 - pixelmatch diff ratio (threshold 0.1, AA ignored). Runs fail below fidelity - epsilon; ' +
  '`pnpm visual:record` only raises the score. Lowering it is a deliberate hand edit with a reason in the PR.';
