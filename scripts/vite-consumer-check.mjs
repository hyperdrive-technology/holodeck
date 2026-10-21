#!/usr/bin/env node
/**
 * Browser-level check that a *built* @holodeck/editor-2.5d-react keeps working
 * when a Vite app consumes it (holodeck#28):
 *
 *   node scripts/vite-consumer-check.mjs packages/editor-2.5d-react
 *
 * Run after `pnpm build`. It makes a throwaway Vite app in a temp dir whose
 * node_modules holds a COPY of the package (dist/ + package.json, as a registry
 * install would; a symlink would make Vite treat it as linked source and skip
 * the pre-bundling that causes the bug), imports BUILTIN_MODEL_URLS in real
 * Chromium and fetches every GLB URL, which must return 200 and a `glTF` header.
 *
 *   dev, documented config  optimizeDeps.exclude: [pkg], include: [drei, fiber]  -> must pass
 *   build                   `vite build` + `vite preview`                          -> must pass
 *   dev, no exclude         the bug repro (URLs rewritten to /node_modules/.vite/deps/models/ -> 404)
 *                           Informational only: prints a warning if Vite stops
 *                           breaking so the README caveat can be revisited, and
 *                           only a warning if the run itself throws (holodeck#48).
 *
 * Needs a Chromium for Playwright (`pnpm exec playwright install chromium`, or
 * point HOLODECK_CHROMIUM at an existing binary).
 * It does not need a GPU: nothing is rendered, only URLs are fetched.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInformational } from './lib/informational.mjs';

const pkgArg = process.argv[2];
if (!pkgArg) {
  console.error('usage: node scripts/vite-consumer-check.mjs <package-dir>');
  process.exit(2);
}
const PKG_DIR = resolve(pkgArg);
if (!existsSync(join(PKG_DIR, 'dist/index.mjs'))) {
  console.error(`no dist/ in ${PKG_DIR}; run pnpm build first`);
  process.exit(2);
}
const require = createRequire(join(PKG_DIR, 'package.json'));
const { createServer, build, preview } = await import(
  // Vite's ESM Node API (the CJS one is deprecated); path avoids `exports` resolution quirks.
  pathToFileURL(join(dirname(require.resolve('vite/package.json')), 'dist/node/index.js')).href
);
const { chromium } = require('playwright');

const NAME = '@holodeck/editor-2.5d-react';
const DEPS = ['react', 'react-dom', 'three', '@react-three/drei', '@react-three/fiber', '@holodeck/sdk'];
const failures = [];

/** Fixture app: copy of the built package + symlinks to its (pnpm-installed) deps. */
function makeFixture() {
  // realpath: macOS tmpdir is a /var -> /private/var symlink, which confuses Vite's fs checks.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'holodeck-vite-consumer-')));
  const nm = join(root, 'node_modules');
  for (const dep of DEPS) {
    mkdirSync(join(nm, dep, '..'), { recursive: true });
    symlinkSync(realpathSync(join(PKG_DIR, 'node_modules', dep)), join(nm, dep));
  }
  const dest = join(nm, NAME);
  mkdirSync(dest, { recursive: true });
  cpSync(join(PKG_DIR, 'dist'), join(dest, 'dist'), { recursive: true });
  cpSync(join(PKG_DIR, 'package.json'), join(dest, 'package.json'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', private: true, type: 'module' }));
  writeFileSync(
    join(root, 'index.html'),
    `<!doctype html><html><body><script type="module" src="/main.js"></script></body></html>`,
  );
  writeFileSync(
    join(root, 'main.js'),
    `// A real app imports react itself, so Vite's scan finds and pre-bundles it; the\n// excluded package's own bare imports are NOT scanned (hence drei/fiber in include).\nimport 'react';\nimport 'react/jsx-runtime';\nimport 'react-dom/client';\nimport { BUILTIN_MODEL_URLS } from '${NAME}';\nwindow.__urls = BUILTIN_MODEL_URLS;\nwindow.__ready = true;\n`,
  );
  return root;
}

/** Opens `url` in Chromium, fetches every BUILTIN_MODEL_URLS entry, returns problems. */
async function fetchModels(browser, url, label) {
  const page = await browser.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`${label}: page error ${e.message}`));
  page.on('console', (m) => process.env.DEBUG_CHECK && console.log('[browser]', m.text()));
  page.on('requestfailed', (r) => process.env.DEBUG_CHECK && console.log('[reqfailed]', r.url()));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 }).catch((e) => {
    throw new Error(`${label}: fixture never became ready (${problems.join('; ') || 'no page errors'}): ${e.message}`);
  });
  const results = await page.evaluate(async () => {
    const out = [];
    for (const [name, u] of Object.entries(window.__urls)) {
      const r = await fetch(u);
      const head = new TextDecoder().decode((await r.arrayBuffer()).slice(0, 4));
      out.push({ name, url: u, status: r.status, head });
    }
    return out;
  });
  await page.close();
  if (results.length === 0) problems.push(`${label}: BUILTIN_MODEL_URLS is empty`);
  for (const r of results) {
    if (r.status !== 200 || r.head !== 'glTF') {
      problems.push(`${label}: ${r.name} -> ${r.url} gave ${r.status} (header ${JSON.stringify(r.head)})`);
    }
  }
  console.log(`${label}: ${results.length} GLB URLs fetched, ${problems.length} problem(s)`);
  return problems;
}

async function runDev(browser, root, label, optimizeDeps) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    cacheDir: join(root, '.vite-cache'),
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps,
  });
  await server.listen();
  try {
    return await fetchModels(browser, server.resolvedUrls.local[0], label);
  } finally {
    await server.close();
  }
}

const root = makeFixture();
const browser = await chromium.launch({ executablePath: process.env.HOLODECK_CHROMIUM || undefined });
try {
  failures.push(
    ...(await runDev(browser, root, 'dev (documented optimizeDeps)', {
      exclude: [NAME],
      include: ['@react-three/drei', '@react-three/fiber'],
    })),
  );

  await build({ root, configFile: false, logLevel: 'error', build: { outDir: 'out' } });
  const pv = await preview({ root, configFile: false, logLevel: 'error', build: { outDir: 'out' }, preview: { host: '127.0.0.1', port: 0 } });
  try {
    failures.push(...(await fetchModels(browser, pv.resolvedUrls.local[0], 'vite build + preview')));
  } finally {
    await new Promise((r) => pv.httpServer.close(r));
  }

  // Informational only: a timeout or rejected fetch here must not fail the
  // run once both required checks above have passed (holodeck#48).
  const repro = await runInformational('dev (no exclude, expected to break)', async () => {
    rmSync(join(root, '.vite-cache'), { recursive: true, force: true });
    return runDev(browser, root, 'dev (no exclude, expected to break)', {});
  });
  if (repro.ok && repro.value.length === 0) {
    console.warn('WARNING: dev without optimizeDeps.exclude now works; the README caveat may be obsolete.');
  }
} finally {
  await browser.close();
  rmSync(root, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\nvite-consumer-check FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('vite-consumer-check OK');
