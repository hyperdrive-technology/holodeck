/**
 * Guard for the vitest pool split (vitest.config.ts BROWSER_TESTS): every test file that drives a
 * browser or a Vite dev server must run in the one-at-a-time browser pool. One that slipped into
 * the parallel unit pool would race the render suites for the GPU and time out at random.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { BROWSER_TESTS } from '../../vitest.config';
import workspace from '../../vitest.workspace';

const PKG_ROOT = path.resolve(import.meta.dirname, '../..');
/** What a browser-driving test file imports or calls. */
const DRIVES_BROWSER = /\b(launchRenderBrowser|startHarness|chromium\.launch)\b|from 'vite'|from 'playwright'/;

function testFiles(dir: string): string[] {
  return readdirSync(path.join(PKG_ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.test\.tsx?$/.test(f) && !f.includes('node_modules'))
    .map((f) => path.posix.join(dir, f.split(path.sep).join('/')));
}

const inBrowserPool = (file: string) => BROWSER_TESTS.some((glob) => path.matchesGlob(file, glob));

describe('browser test pool', () => {
  const files = [...testFiles('src'), ...testFiles('assets')];

  it('every browser-driving test file is in BROWSER_TESTS', () => {
    const self = 'src/test-support/browser-tests.test.ts'; // names the patterns, drives nothing
    const drivers = files.filter((f) => f !== self && DRIVES_BROWSER.test(readFileSync(path.join(PKG_ROOT, f), 'utf8')));
    // The scan must see the render suites, or it is checking nothing.
    expect(drivers.length).toBeGreaterThan(10);
    expect(drivers.filter((f) => !inBrowserPool(f))).toEqual([]);
  });

  it('every BROWSER_TESTS entry matches a file (no stale entries)', () => {
    for (const glob of BROWSER_TESTS) expect(files.some((f) => path.matchesGlob(f, glob)), glob).toBe(true);
  });

  it('the unit pool keeps the plain files', () => {
    expect(inBrowserPool('src/iso/scene.test.ts')).toBe(false);
    expect(inBrowserPool('src/iso/scene-render.test.ts')).toBe(true);
  });

  // The browser files run one at a time, each in a fresh child process (vitest.workspace.ts).
  // `singleFork: true` kept one child for all of them and their leftovers piled up: 7x slower
  // render files on boat-large and a 4 GB heap OOM on a Mac (2026-11-12).
  it('the browser project runs one fresh child process per file', () => {
    type Project = { test?: { name?: string; pool?: string; poolOptions?: { forks?: { singleFork?: boolean } }; isolate?: boolean } };
    const browser = (workspace as Project[]).find((p) => p.test?.name === 'browser');
    expect(browser?.test?.pool).toBe('forks');
    expect(browser?.test?.poolOptions?.forks?.singleFork).not.toBe(true);
    expect(browser?.test?.isolate).not.toBe(false);
    expect(config.test?.poolOptions?.forks).toMatchObject({ maxForks: 1, minForks: 1 });
  });
});
