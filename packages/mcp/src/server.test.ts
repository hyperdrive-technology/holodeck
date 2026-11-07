import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IDS_PER_CALL, MAX_RESULT_CHARS } from './limits';
import { harness, testHost, type Harness } from './test-support';
import { parseDocumentText } from './studio';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(() => h.close());

const readDoc = async (path: string) => JSON.parse(await readFile(join(h.dir, path), 'utf8'));
type Obj = { id: string; object: string; x: number; y: number; toX?: number; toY?: number; params?: Record<string, unknown>; attach?: Record<string, { object: string; port?: string }>; bindings?: Record<string, unknown> };
const objectsOf = async (path: string): Promise<Obj[]> => (await readDoc(path)).body.objects;

/** A new empty document `a.holodeck.json`, opened. */
async function newDoc(path = 'a.holodeck.json', template: 'empty' | 'starter' = 'empty') {
  const r = await h.call('scene_new', { path, template });
  expect(r.isError, r.text).toBe(false);
  return r.data;
}

describe('tool surface', () => {
  it('lists every tool with its tier and annotations', async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'holodeck_info',
        'parts_get',
        'parts_list',
        'scene_add_object',
        'scene_bind',
        'scene_connect',
        'scene_export',
        'scene_get',
        'scene_list',
        'scene_move',
        'scene_new',
        'scene_open',
        'scene_remove',
        'scene_render',
        'scene_update_params',
        'scene_validate',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.description).toMatch(/\[tier: (read|author|exec)\]$/);
      expect(t.annotations?.openWorldHint).toBe(false);
    }
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get('parts_list')?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get('scene_remove')?.annotations?.destructiveHint).toBe(true);
    expect(byName.get('scene_add_object')?.annotations?.readOnlyHint).toBe(false);
  });

  it('holodeck_info reports the workspace, tier and installed packages', async () => {
    const r = await h.call('holodeck_info');
    expect(r.data.tier).toBe('author');
    expect(r.data.root).toBeTypeOf('string');
    const packages = (r.data.packages as Array<{ id: string }>).map((p) => p.id);
    expect(packages).toEqual(expect.arrayContaining(['holodeck.iso', 'holodeck.cloud', 'holodeck.sim', 'holodeck.http', 'holodeck.provider-aws']));
    expect((r.data.providers as Array<{ id: string }>).map((p) => p.id)).toEqual(expect.arrayContaining(['holodeck.sim', 'holodeck.http', 'aws.cloudwatch']));
  });

  it('rejects arguments outside the schema bounds before the handler runs', async () => {
    await newDoc();
    const ids = Array.from({ length: MAX_IDS_PER_CALL + 1 }, (_, i) => `x-${i}`);
    const r = await h.call('scene_remove', { ids });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/500|too_big|Too big/i);
    const bad = await h.call('scene_add_object', { part: 'tank', x: 1e9, y: 0 });
    expect(bad.isError).toBe(true);
    expect((await objectsOf('a.holodeck.json')).length).toBe(0);
  });
});

describe('library', () => {
  it('parts_list searches like the studio sidebar and pages', async () => {
    const all = await h.call('parts_list', { limit: 500 });
    expect(all.data.total).toBeGreaterThan(20);
    const tank = await h.call('parts_list', { query: 'tank' });
    expect((tank.data.parts as Array<{ id: string }>).map((p) => p.id)).toContain('tank');
    const page = await h.call('parts_list', { limit: 2, offset: 1 });
    expect((page.data.parts as unknown[]).length).toBe(2);
    expect(page.data.total).toBe(all.data.total);
    const cloud = await h.call('parts_list', { package: 'holodeck.cloud' });
    expect((cloud.data.parts as Array<{ package: string }>).every((p) => p.package === 'holodeck.cloud')).toBe(true);
    const vessels = await h.call('parts_list', { category: 'vessels' });
    expect((vessels.data.parts as Array<{ category: string }>).every((p) => p.category === 'Vessels')).toBe(true);
    expect((await h.call('parts_list', { query: 'zzz-nothing' })).data.total).toBe(0);
  });

  it('parts_get returns the part contract: params, ports, footprint', async () => {
    const r = await h.call('parts_get', { id: 'tank' });
    const part = r.data.part as { ports: Record<string, { dir: string }>; params: Record<string, { type: string; min?: number; max?: number }>; footprint: unknown; package: string };
    expect(part.package).toBe('holodeck.iso');
    expect(part.ports.east?.dir).toBe('e');
    expect(part.params.level).toMatchObject({ type: 'number', min: 0, max: 1 });
    expect(part.footprint).toEqual({ w: 2, h: 2 });
    expect((await h.call('parts_get', { id: 'pipe' })).data.part).toMatchObject({ draw: 'run' });
  });

  it('parts_get on an unknown part suggests similar ones', async () => {
    const r = await h.call('parts_get', { id: 'tanks' });
    expect(r.isError).toBe(true);
    expect(r.data.error?.code).toBe('not_found');
    expect(r.text).toContain('similar');
  });
});

describe('documents', () => {
  it('scene_new writes a document the studio would import, and opens it', async () => {
    const data = await newDoc('screens/line.holodeck.json');
    expect(data.objectCount).toBe(0);
    const text = await readFile(join(h.dir, 'screens/line.holodeck.json'), 'utf8');
    const parsed = parseDocumentText(text, await testHost());
    expect(parsed.ok).toBe(true);
    expect(JSON.parse(text).metadata.updated).toBe('2026-11-07T00:00:00.000Z');
    expect(h.context.current).toBe('screens/line.holodeck.json');
    expect((await h.call('scene_list')).data.documents).toEqual(['screens/line.holodeck.json']);
  });

  it('scene_new refuses to replace a file unless overwrite is set', async () => {
    await newDoc();
    const again = await h.call('scene_new', { path: 'a.holodeck.json' });
    expect(again.data.error?.code).toBe('conflict');
    const over = await h.call('scene_new', { path: 'a.holodeck.json', name: 'Second', overwrite: true });
    expect(over.isError).toBe(false);
    expect((await readDoc('a.holodeck.json')).name).toBe('Second');
  });

  it('scene_new starter: the playground scene with a secret-free sim connection and bindings', async () => {
    const data = await newDoc('a.holodeck.json', 'starter');
    expect(data.connections).toEqual([{ id: 'sim', provider: 'holodeck.sim', label: 'Simulated plant' }]);
    const objects = await objectsOf('a.holodeck.json');
    expect(objects.some((o) => o.bindings && Object.keys(o.bindings).length > 0)).toBe(true);
    expect((await readDoc('a.holodeck.json')).id).not.toBe('playground');
  });

  it('scene_new refuses paths outside the workspace', async () => {
    for (const path of ['../x.holodeck.json', '/tmp/x.holodeck.json', 'x.json', '.x.holodeck.json']) {
      const r = await h.call('scene_new', { path });
      expect(r.data.error?.code, path).toBe('invalid_path');
    }
  });

  it('scene_get: summary, full, objectIds and missing ids', async () => {
    await newDoc('a.holodeck.json', 'starter');
    const summary = await h.call('scene_get');
    expect(summary.data.objectCount).toBe((summary.data.objects as unknown[]).length);
    const one = await h.call('scene_get', { objectIds: ['feed-tank', 'nope'] });
    expect((one.data.objects as Array<{ id: string }>).map((o) => o.id)).toEqual(['feed-tank']);
    expect(one.data.missing).toEqual(['nope']);
    const full = await h.call('scene_get', { view: 'full', objectIds: ['feed-tank'] });
    expect((full.data.document as { format: string; body: { objects: unknown[] } }).format).toBe('holodeck.document.v1');
    expect((full.data.document as { body: { objects: unknown[] } }).body.objects.length).toBe(1);
  });

  it('tools without a path and without an open document say so', async () => {
    const r = await h.call('scene_get');
    expect(r.data.error?.code).toBe('no_document');
  });

  it('scene_open validates and makes the document current; an invalid file is refused with every problem', async () => {
    await newDoc('a.holodeck.json');
    await writeFile(join(h.dir, 'bad.holodeck.json'), JSON.stringify({ format: 'holodeck.document.v1', id: 'x', name: 'x', engine: 'holodeck.iso', engineVersion: '1.0.0', body: { id: 'x', name: 'x', gridCellSize: 1, objects: [{ id: 't', object: 'no-such-part', x: 0, y: 0 }] } }));
    const bad = await h.call('scene_open', { path: 'bad.holodeck.json' });
    expect(bad.data.error?.code).toBe('invalid_document');
    expect(bad.text).toContain('no-such-part');
    expect(h.context.current).toBe('a.holodeck.json');
    await writeFile(join(h.dir, 'junk.holodeck.json'), '{not json');
    expect((await h.call('scene_open', { path: 'junk.holodeck.json' })).text).toContain('not valid JSON');
  });

  it('a bare legacy scene is wrapped on open and saved as an envelope on the first edit', async () => {
    await writeFile(join(h.dir, 'legacy.holodeck.json'), JSON.stringify({ id: 'legacy', name: 'Legacy', gridCellSize: 1, objects: [] }));
    const open = await h.call('scene_open', { path: 'legacy.holodeck.json' });
    expect(open.data.wrapped).toBe(true);
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    expect((await readDoc('legacy.holodeck.json')).format).toBe('holodeck.document.v1');
  });

  it('scene_validate: files, document values, credentials, and argument errors', async () => {
    await newDoc();
    expect((await h.call('scene_validate')).data).toMatchObject({ valid: true, problems: [] });
    await writeFile(join(h.dir, 'junk.holodeck.json'), '[]');
    const junk = await h.call('scene_validate', { path: 'junk.holodeck.json' });
    expect(junk.data.valid).toBe(false);
    const doc = await readDoc('a.holodeck.json');
    doc.connections = [{ id: 'api', provider: 'holodeck.http', config: { url: 'https://user:hunter2@example.com/data' } }];
    const creds = await h.call('scene_validate', { document: doc });
    expect(creds.data.valid).toBe(false);
    expect((creds.data.problems as string[]).join(' ')).toMatch(/connections\.api/);
    expect((await h.call('scene_validate', { path: 'a.holodeck.json', document: doc })).isError).toBe(true);
    expect((await h.call('scene_validate', { path: 'missing.holodeck.json' })).data.error?.code).toBe('not_found');
  });
});

describe('editing', () => {
  it('scene_add_object places a part with palette defaults and params', async () => {
    await newDoc();
    const r = await h.call('scene_add_object', { part: 'tank', x: 0, y: 0, params: { level: 0.5 } });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.added).toEqual(['tank-1']);
    const [tank] = await objectsOf('a.holodeck.json');
    expect(tank).toMatchObject({ id: 'tank-1', object: 'tank', x: 0, y: 0, params: { level: 0.5 } });
    expect((tank as unknown as { height: number }).height).toBe(3.05);
    // Without x/y: right of the scene, never on top of it.
    const next = await h.call('scene_add_object', { part: 'tank' });
    const placed = (next.data.objects as Obj[])[0]!;
    expect(placed.x).toBeGreaterThan(1);
  });

  it('scene_add_object draws a run part from x/y to `to`', async () => {
    await newDoc();
    const r = await h.call('scene_add_object', { part: 'pipe', x: 0, y: 0, to: { x: 4, y: 0 } });
    expect(r.isError, r.text).toBe(false);
    const pipe = (await objectsOf('a.holodeck.json')).find((o) => o.object === 'pipe')!;
    expect([pipe.x, pipe.y, pipe.toX, pipe.toY]).toEqual([0, 0, 4, 0]);
    const notRun = await h.call('scene_add_object', { part: 'tank', x: 0, y: 5, to: { x: 4, y: 5 } });
    expect(notRun.isError).toBe(true);
  });

  it('an invalid param value is refused with the problem and nothing is written', async () => {
    await newDoc();
    const before = await readFile(join(h.dir, 'a.holodeck.json'), 'utf8');
    const r = await h.call('scene_add_object', { part: 'tank', x: 0, y: 0, params: { level: 5 } });
    expect(r.data.error?.code).toBe('invalid_edit');
    expect(r.text).toMatch(/level/);
    expect(await readFile(join(h.dir, 'a.holodeck.json'), 'utf8')).toBe(before);
  });

  it('argument errors: unknown part, half a position', async () => {
    await newDoc();
    expect((await h.call('scene_add_object', { part: 'warp-core' })).data.error?.code).toBe('not_found');
    expect((await h.call('scene_add_object', { part: 'tank', x: 1 })).isError).toBe(true);
  });

  it('scene_connect routes a pipe between two ports and records them; scene_move drags it along', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    await h.call('scene_add_object', { part: 'mixer', x: 8, y: 0 });
    const c = await h.call('scene_connect', { from: { id: 'tank-1', port: 'east' }, to: { id: 'mixer-1', port: 'west' } });
    expect(c.isError, c.text).toBe(false);
    expect(c.data.attached).toEqual({ from: true, to: true });
    const pipes = (await objectsOf('a.holodeck.json')).filter((o) => o.object === 'pipe');
    expect(pipes.length).toBeGreaterThan(0);
    expect(pipes[0]!.attach?.from).toEqual({ object: 'tank-1', port: 'east' });
    expect(pipes[pipes.length - 1]!.attach?.to).toEqual({ object: 'mixer-1', port: 'west' });

    const m = await h.call('scene_move', { id: 'mixer-1', x: 8, y: 4 });
    expect(m.isError, m.text).toBe(false);
    const after = await objectsOf('a.holodeck.json');
    expect(after.find((o) => o.id === 'mixer-1')).toMatchObject({ x: 8, y: 4 });
    // The run still ends on the mixer's west port (7, 4) and still records it.
    const run = after.filter((o) => o.object === 'pipe');
    const last = run.find((o) => o.attach?.to?.object === 'mixer-1')!;
    expect(last).toBeDefined();
    expect([last.toX, last.toY]).toEqual([7, 4]);
  });

  it('scene_connect: unknown port lists the part ports; a free cell end works', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    const bad = await h.call('scene_connect', { from: { id: 'tank-1', port: 'north' }, to: { x: 6, y: 0 } });
    expect(bad.data.error?.code).toBe('not_found');
    expect(bad.text).toContain('east, west');
    const ok = await h.call('scene_connect', { from: { id: 'tank-1', port: 'east' }, to: { x: 6, y: 0 } });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.data.attached).toEqual({ from: true, to: true });
    expect((await h.call('scene_connect', { from: { x: 3, y: 3 }, to: { x: 3, y: 3 } })).isError).toBe(true);
  });

  it('scene_update_params: params, null resets, fields, protected fields refused', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0, params: { level: 0.4, temp: 20 } });
    const r = await h.call('scene_update_params', { id: 'tank-1', params: { level: 0.9, temp: null }, fields: { fillColor: '#3366ff' } });
    expect(r.isError, r.text).toBe(false);
    const [tank] = await objectsOf('a.holodeck.json');
    expect(tank!.params).toEqual({ level: 0.9 });
    expect((tank as unknown as { fillColor: string }).fillColor).toBe('#3366ff');
    const blocked = await h.call('scene_update_params', { id: 'tank-1', fields: { x: 5 } });
    expect(blocked.isError).toBe(true);
    expect(blocked.text).toContain('scene_move');
    expect((await h.call('scene_update_params', { id: 'tank-1' })).isError).toBe(true);
    expect((await h.call('scene_update_params', { id: 'nope', params: { level: 1 } })).data.error?.code).toBe('not_found');
  });

  it('an edit that changes nothing is reported, not written', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    const before = await readFile(join(h.dir, 'a.holodeck.json'), 'utf8');
    const r = await h.call('scene_move', { id: 'tank-1', x: 0, y: 0 });
    expect(r.data.error?.code).toBe('no_change');
    expect(await readFile(join(h.dir, 'a.holodeck.json'), 'utf8')).toBe(before);
  });

  it('scene_move rotates in quarter turns to an absolute angle', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    const r = await h.call('scene_move', { id: 'tank-1', rotationDegrees: 270 });
    expect(r.isError, r.text).toBe(false);
    expect((r.data.objects as Array<{ rotationDegrees?: number }>)[0]!.rotationDegrees).toBe(-90);
    const back = await h.call('scene_move', { id: 'tank-1', rotationDegrees: 0 });
    expect((back.data.objects as Array<{ rotationDegrees?: number }>)[0]!.rotationDegrees).toBeUndefined();
    expect((await h.call('scene_move', { id: 'tank-1', rotationDegrees: 45 })).isError).toBe(true);
  });

  it('scene_remove deletes and frees pipe ends; a grouped object needs its whole group', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    await h.call('scene_connect', { from: { id: 'tank-1', port: 'east' }, to: { x: 6, y: 0 } });
    const r = await h.call('scene_remove', { ids: ['tank-1'] });
    expect(r.isError, r.text).toBe(false);
    expect(r.data.removed).toEqual(['tank-1']);
    const left = await objectsOf('a.holodeck.json');
    expect(left.every((o) => o.attach?.from?.object !== 'tank-1')).toBe(true);

    const doc = await readDoc('a.holodeck.json');
    doc.body.objects.push({ id: 'g1', object: 'tank', x: 20, y: 0, group: 'group-1' }, { id: 'g2', object: 'tank', x: 24, y: 0, group: 'group-1' });
    await writeFile(join(h.dir, 'a.holodeck.json'), JSON.stringify(doc));
    const grouped = await h.call('scene_remove', { ids: ['g1'] });
    expect(grouped.data.error?.code).toBe('grouped');
    expect(grouped.text).toContain('g2');
    expect((await h.call('scene_remove', { ids: ['g1', 'g2'] })).data.removed).toEqual(['g1', 'g2']);
  });

  it('scene_bind binds and unbinds, validated by the SDK and the credential rules', async () => {
    await newDoc('a.holodeck.json', 'starter');
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 8 });
    const ok = await h.call('scene_bind', {
      id: 'tank-1',
      param: 'level',
      binding: { connection: 'sim', source: 'sine:10:0:100', transform: { kind: 'scale', inMin: 0, inMax: 100, outMin: 0, outMax: 1, clamp: true } },
    });
    expect(ok.isError, ok.text).toBe(false);
    expect((await objectsOf('a.holodeck.json')).find((o) => o.id === 'tank-1')!.bindings).toMatchObject({ level: { connection: 'sim', source: 'sine:10:0:100' } });

    const unknownConnection = await h.call('scene_bind', { id: 'tank-1', param: 'temp', binding: { connection: 'nope', source: 'sine:10' } });
    expect(unknownConnection.data.error?.code).toBe('invalid_edit');
    expect(unknownConnection.text).toContain('nope');
    const secret = await h.call('scene_bind', { id: 'tank-1', param: 'temp', binding: { connection: 'sim', source: '/api?api_key=abc123' } });
    expect(secret.data.error?.code).toBe('invalid_edit');
    expect(secret.text).toMatch(/credential|secret/i);
    expect((await h.call('scene_bind', { id: 'tank-1', param: 'warp', binding: { connection: 'sim', source: 'sine:1' } })).data.error?.code).toBe('not_found');

    const off = await h.call('scene_bind', { id: 'tank-1', param: 'level', binding: null });
    expect(off.isError, off.text).toBe(false);
    expect((await objectsOf('a.holodeck.json')).find((o) => o.id === 'tank-1')!.bindings).toBeUndefined();
  });

  it('an etag from an older read is a conflict; the current one edits', async () => {
    const created = await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    const stale = await h.call('scene_add_object', { part: 'tank', x: 5, y: 0, etag: created.etag });
    expect(stale.data.error?.code).toBe('conflict');
    const current = (await h.call('scene_get')).data.etag;
    const ok = await h.call('scene_add_object', { part: 'tank', x: 5, y: 0, etag: current });
    expect(ok.isError, ok.text).toBe(false);
    expect(ok.data.etag).not.toBe(current);
  });

  it('an invalid file on disk is never edited', async () => {
    await writeFile(join(h.dir, 'bad.holodeck.json'), '{"format":"holodeck.document.v1"}');
    const r = await h.call('scene_add_object', { path: 'bad.holodeck.json', part: 'tank' });
    expect(r.data.error?.code).toBe('invalid_document');
    expect(await readFile(join(h.dir, 'bad.holodeck.json'), 'utf8')).toBe('{"format":"holodeck.document.v1"}');
  });

  it('requires is recomputed from the parts and providers used', async () => {
    await newDoc();
    await h.call('scene_add_object', { part: 'tank', x: 0, y: 0 });
    expect(Object.keys((await readDoc('a.holodeck.json')).requires)).toEqual(['holodeck.iso']);
    const cloudPart = ((await h.call('parts_list', { package: 'holodeck.cloud', limit: 1 })).data.parts as Array<{ id: string }>)[0]!.id;
    await h.call('scene_add_object', { part: cloudPart, x: 10, y: 0 });
    expect(Object.keys((await readDoc('a.holodeck.json')).requires)).toEqual(['holodeck.cloud', 'holodeck.iso']);
  });
});

describe('export', () => {
  it('returns the document or the components CSV, or writes them in the workspace', async () => {
    await newDoc('a.holodeck.json', 'starter');
    const doc = await h.call('scene_export');
    expect(JSON.parse(doc.data.text as string).format).toBe('holodeck.document.v1');
    const csv = await h.call('scene_export', { format: 'components-csv' });
    expect(csv.data.text as string).toContain('feed-tank');
    const out = await h.call('scene_export', { format: 'components-csv', out: 'exports/a.components.csv' });
    expect(out.isError, out.text).toBe(false);
    expect(await readFile(join(h.dir, 'exports/a.components.csv'), 'utf8')).toBe(csv.data.text);
    expect((await h.call('scene_export', { format: 'components-csv', out: 'exports/a.components.csv' })).data.error?.code).toBe('conflict');
    expect((await h.call('scene_export', { format: 'document', out: 'exports/a.csv' })).data.error?.code).toBe('invalid_path');
    const copy = await h.call('scene_export', { out: 'copy.holodeck.json' });
    expect(copy.isError, copy.text).toBe(false);
    expect((await h.call('scene_open', { path: 'copy.holodeck.json' })).isError).toBe(false);
  });
});

describe('tiers', () => {
  it('a read-tier server lists author tools but refuses them, writing nothing', async () => {
    const reader = await harness({ tier: 'read', dir: h.dir });
    try {
      const r = await reader.call('scene_new', { path: 'a.holodeck.json' });
      expect(r.data.error?.code).toBe('tier');
      expect(r.text).toContain('HOLODECK_MCP_TIER=author');
      expect(await reader.call('scene_list').then((x) => x.data.documents)).toEqual([]);
      expect((await reader.call('parts_list')).isError).toBe(false);
      await h.call('scene_new', { path: 'a.holodeck.json' });
      expect((await reader.call('scene_export', { path: 'a.holodeck.json' })).isError).toBe(false);
      expect((await reader.call('scene_export', { path: 'a.holodeck.json', out: 'b.holodeck.json' })).data.error?.code).toBe('tier');
    } finally {
      await reader.close();
    }
  });
});

describe('size bounds', () => {
  it('a result over the limit is refused with a hint to narrow it', async () => {
    await newDoc();
    const doc = await readDoc('a.holodeck.json');
    const text = 'x'.repeat(3000);
    doc.body.objects = Array.from({ length: 120 }, (_, i) => ({ id: `l-${i}`, object: 'label', x: i * 3, y: 0, params: { text } }));
    await writeFile(join(h.dir, 'a.holodeck.json'), JSON.stringify(doc));
    expect(JSON.stringify(doc).length).toBeGreaterThan(MAX_RESULT_CHARS);
    const r = await h.call('scene_get', { view: 'full' });
    expect(r.data.error?.code).toBe('too_large');
    expect(r.text).toContain('objectIds');
    expect((await h.call('scene_get', { view: 'full', objectIds: ['l-1'] })).isError).toBe(false);
  });
});
