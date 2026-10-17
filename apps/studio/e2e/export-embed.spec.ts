/**
 * Export dialog (JSON, components CSV, embed link) and the read-only
 * `/embed/:doc` route with its postMessage API, over the production build
 * (holodeck#42). GPU-free like studio.spec.ts; the PNG export runs in
 * export-png.webgpu.spec.ts with WebGPU.
 *
 * The cross-origin parent page is served from 127.0.0.1 (PARENT, below), so
 * the iframe is a real cross-site frame (separate origin, partitioned storage). Waits are on DOM state and on messages,
 * never sleeps.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { EMBED_SCENE, seedEmbedDocument, withoutWebGPU } from './fixtures';

const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await withoutWebGPU(page);
});

test.afterEach(() => {
  expect(pageErrors.map((e) => e.message)).toEqual([]);
});

test('export dialog: document JSON, components CSV (formula-safe), embed link', async ({ page }, testInfo) => {
  await seedEmbedDocument(page);
  await page.keyboard.press('ControlOrMeta+Shift+E');
  const dialog = page.getByTestId('export-dialog');
  await expect(dialog).toBeVisible();
  // No WebGPU here: the PNG button explains itself instead of failing.
  await expect(dialog.getByTestId('export-png')).toBeDisabled();
  await expect(dialog.getByTestId('embed-url')).toHaveValue(/\/embed\/e2e-embed$/);
  await dialog.getByLabel(/Embedding page origin/).fill('https://app.example');
  await expect(dialog.getByTestId('embed-url')).toHaveValue(/\/embed\/e2e-embed\?parentOrigin=https%3A%2F%2Fapp\.example$/);

  // Components CSV.
  let downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download CSV' }).click();
  let download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('embed-plant.components.csv');
  const csvPath = testInfo.outputPath('components.csv');
  await download.saveAs(csvPath);
  const bytes = await readFile(csvPath);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
  const lines = bytes.subarray(3).toString('utf8').split('\r\n');
  expect(lines[0]).toBe('id,part,label,category,package,layer,group,x,y,rotation,toX,toY,onPipe,opacity,params,bindings,meta:tag,meta:volume');
  expect(lines[1]).toMatch(/^tank-1,tank,/);
  expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")",20`);
  expect(lines[2]).toMatch(/^valve-1,valve,/);
  expect(lines[3]).toBe('');
  await expect(dialog).toHaveCount(0);

  // Document JSON (envelope).
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Download JSON' }).click();
  download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('embed-plant.holodeck.json');
  const jsonPath = testInfo.outputPath('doc.holodeck.json');
  await download.saveAs(jsonPath);
  const doc = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(doc).toMatchObject({ format: 'holodeck.document.v1', id: 'e2e-embed', name: 'Embed Plant', engine: 'holodeck.iso' });
  expect(doc.body.objects.map((o: { id: string }) => o.id)).toEqual(['tank-1', 'valve-1']);
});

test('/embed/:doc renders the stored document read-only, without studio chrome', async ({ page }) => {
  await seedEmbedDocument(page);
  await page.goto('/embed/e2e-embed');
  const embed = page.getByTestId('embed');
  await expect(embed).toHaveAttribute('data-document-id', 'e2e-embed');
  const editor = embed.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-host-mode', 'run');
  await expect(editor).toHaveAttribute('data-object-count', '2');
  // Not framed: nobody to talk to.
  await expect(embed).toHaveAttribute('data-embed-api', 'off');
  // No studio chrome: header, sidebar, library, inspector, export.
  await expect(page.getByText('Holodeck Studio')).toHaveCount(0);
  await expect(page.getByTestId('sidebar')).toHaveCount(0);
  await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);
  // Editing keys do nothing in run mode.
  await editor.click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+d');
  await expect(editor).toHaveAttribute('data-object-count', '2');
  // And nothing was written: the studio still has revision 1.
  await page.goto('/d/e2e-embed');
  await expect(page.getByTestId('canvas')).toHaveAttribute('data-revision', '1');
});

test('/embed/:doc for an unknown id says so', async ({ page }) => {
  await page.goto('/embed/does-not-exist');
  await expect(page.getByTestId('embed').getByRole('status')).toHaveText('This document is not available here.');
});

// -----------------------------------------------------------------------------
// postMessage API from a cross-origin parent
// -----------------------------------------------------------------------------

/**
 * The parent page runs on its own tiny HTTP server on 127.0.0.1 (another site
 * than the studio on localhost), so the iframe is a real cross-site frame
 * with partitioned storage. Not `page.route` on a made-up host: Chrome's
 * Local Network Access treats a route-fulfilled page as public and refuses to
 * let it frame localhost ("The connection is blocked because it was
 * initiated by a public page..."), seen 2026-10-18.
 */
let parentServer: Server;
let PARENT = '';
/** The HTML the parent server returns for the next request (set per test). */
let parentHtml = '';

test.beforeAll(async () => {
  parentServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(parentHtml);
  });
  await new Promise<void>((resolve) => parentServer.listen(0, '127.0.0.1', resolve));
  PARENT = `http://127.0.0.1:${(parentServer.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => parentServer?.close(resolve));
});

interface Received {
  frame: number;
  origin: string;
  data: { protocol: string; type: string; requestId?: string; ok?: boolean; error?: string; documentId?: string | null; objects?: unknown[] };
}

/** Opens a parent page on PARENT with one iframe per src; it records every message from its frames. */
async function openParent(page: Page, baseURL: string | undefined, iframeSrcs: (parent: string) => string[]): Promise<void> {
  if (!baseURL) throw new Error('baseURL is not configured (playwright.config.ts)');
  const studio = new URL(baseURL).origin;
  const frames = iframeSrcs(PARENT)
    .map((src, i) => `<iframe name="f${i}" src="${studio}${src}" style="width:640px;height:400px;border:0"></iframe>`)
    .join('');
  parentHtml = `<!doctype html><html><body><script>
    window.__messages = [];
    addEventListener('message', (e) => {
      const frame = [...document.querySelectorAll('iframe')].findIndex((f) => f.contentWindow === e.source);
      window.__messages.push({ frame, origin: e.origin, data: e.data });
    });
    window.__send = (frame, data) => document.querySelectorAll('iframe')[frame].contentWindow.postMessage(data, ${JSON.stringify(studio)});
  </script>${frames}</body></html>`;
  await page.goto(`${PARENT}/`);
}

const messages = (page: Page) => page.evaluate(() => (window as unknown as { __messages: Received[] }).__messages);
const send = (page: Page, frame: number, data: unknown) =>
  page.evaluate(([f, d]) => (window as unknown as { __send(f: number, d: unknown): void }).__send(f as number, d), [frame, data] as const);
const reply = async (page: Page, frame: number, requestId: string) => {
  await expect.poll(async () => (await messages(page)).find((m) => m.frame === frame && m.data.requestId === requestId)).toBeTruthy();
  return (await messages(page)).find((m) => m.frame === frame && m.data.requestId === requestId)!;
};

test('postMessage: an allowed parent loads a document and sets object state', async ({ page, baseURL }) => {
  await openParent(page, baseURL, (parent) => [`/embed/e2e-embed?parentOrigin=${encodeURIComponent(parent)}`]);
  const frame = page.frameLocator('iframe[name="f0"]');
  const embed = frame.getByTestId('embed');
  await expect(embed).toHaveAttribute('data-embed-api', 'on');
  // Partitioned storage: the cross-site frame has no stored documents.
  await expect(embed.getByRole('status')).toHaveText('This document is not available here.');

  // ready reached the parent, addressed to its origin.
  await expect.poll(async () => (await messages(page)).map((m) => m.data.type)).toContain('ready');
  const ready = (await messages(page)).find((m) => m.data.type === 'ready')!;
  expect(ready).toMatchObject({ frame: 0, data: { protocol: 'holodeck.embed.v1', type: 'ready', documentId: null } });

  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'loadDocument', requestId: 'load-1', document: EMBED_SCENE });
  expect((await reply(page, 0, 'load-1')).data).toEqual({ protocol: 'holodeck.embed.v1', type: 'result', requestId: 'load-1', ok: true });
  const editor = embed.getByTestId('process-editor');
  await expect(editor).toHaveAttribute('data-host-mode', 'run');
  await expect(editor).toHaveAttribute('data-object-count', '2');

  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'setObjectState', requestId: 'set-1', objectId: 'tank-1', state: { level: 0.25, running: true } });
  expect((await reply(page, 0, 'set-1')).data.ok).toBe(true);
  await expect(embed).toHaveAttribute('data-object-states', '1');

  // Untrusted input is refused with a reason.
  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'setObjectState', requestId: 'set-2', objectId: 'ghost', state: { level: 1 } });
  expect((await reply(page, 0, 'set-2')).data).toMatchObject({ ok: false, error: 'objectId: "ghost" is not in the document' });
  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'setObjectState', requestId: 'set-3', objectId: 'tank-1', state: { level: { $gt: 1 } } });
  expect((await reply(page, 0, 'set-3')).data).toMatchObject({ ok: false, error: expect.stringContaining('state.level') });
  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'nuke', requestId: 'bad-type' });
  expect((await reply(page, 0, 'bad-type')).data).toMatchObject({ ok: false, error: expect.stringContaining('unknown message type') });
  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'loadDocument', requestId: 'load-2', document: { format: 'holodeck.document.v1', id: 'x', name: 'X', engine: 'holodeck.flow', body: {} } });
  expect((await reply(page, 0, 'load-2')).data).toMatchObject({ ok: false, error: expect.stringContaining('holodeck.flow') });
  // ...and changed nothing.
  await expect(editor).toHaveAttribute('data-object-count', '2');
  await expect(embed).toHaveAttribute('data-object-states', '1');

  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'getInfo', requestId: 'info' });
  expect((await reply(page, 0, 'info')).data).toMatchObject({
    type: 'info',
    documentId: 'e2e-embed',
    objects: [
      { id: 'tank-1', part: 'tank' },
      { id: 'valve-1', part: 'valve' },
    ],
  });
  // Every reply was addressed to (and so only delivered to) the parent's origin.
  expect((await messages(page)).every((m) => m.frame === 0)).toBe(true);
});

test('postMessage: a parent that is not allowed gets nothing and changes nothing', async ({ page, baseURL }) => {
  // Frame 0 names the parent; frame 1 does not, so the parent is not allowed there.
  await openParent(page, baseURL, (parent) => [`/embed/e2e-embed?parentOrigin=${encodeURIComponent(parent)}`, '/embed/e2e-embed']);
  const allowed = page.frameLocator('iframe[name="f0"]').getByTestId('embed');
  const denied = page.frameLocator('iframe[name="f1"]').getByTestId('embed');
  await expect(allowed).toHaveAttribute('data-embed-api', 'on');
  await expect(denied).toHaveAttribute('data-embed-api', 'on');

  // Watch what frame 1 receives, so we know our message reached it before checking for a reply.
  const deniedFrame = page.frames().find((f) => f.name() === 'f1')!;
  await deniedFrame.evaluate(() => {
    (window as unknown as { __seen: string[] }).__seen = [];
    addEventListener('message', (e) => (window as unknown as { __seen: string[] }).__seen.push(String(e.data?.requestId)));
  });

  await send(page, 1, { protocol: 'holodeck.embed.v1', type: 'loadDocument', requestId: 'denied-load', document: EMBED_SCENE });
  await send(page, 1, { protocol: 'holodeck.embed.v1', type: 'getInfo', requestId: 'denied-info' });
  await expect.poll(() => deniedFrame.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual(['denied-load', 'denied-info']);
  // A round trip through the allowed frame, sent after: by the time it answers, a reply from frame 1 would have been posted too.
  await send(page, 0, { protocol: 'holodeck.embed.v1', type: 'getInfo', requestId: 'allowed-info' });
  await reply(page, 0, 'allowed-info');

  expect((await messages(page)).filter((m) => m.frame === 1)).toEqual([]); // not even `ready`
  await expect(denied.getByRole('status')).toHaveText('This document is not available here.');
  await expect(denied.getByTestId('process-editor')).toHaveCount(0);
});
