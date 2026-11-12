/**
 * The definitions in parts.json against the editor's part contract and
 * against each GLB's node contract (src/models.json): every rule here is one
 * a new part from the next Blender batch must also meet.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ISO_ANIMATORS, ISO_PART_ORIGINS, isIsoPartDefinition, isParamSpec } from '@holodeck/editor-2.5d-react/contracts';
import cloudParts from '../../library-cloud/src/parts.json';
import { PROCESS_MODELS, PROCESS_MODEL_SLUGS, processModelPath } from './models';
import { createProcessParts, PROCESS_PART_DEFINITIONS, type ProcessPartDefinition } from './parts';

/** Catalog families (docs/assets/process-catalog.md section headings), as palette categories. */
const CATEGORIES = ['Valves', 'Rotating equipment', 'Heat transfer', 'Separation', 'Vessels', 'Instruments', 'Piping', 'Electrical', 'Site'];
/** pipeWorldY() for the default pipe radius (editor assets/process/pipe-math.ts): floor nozzles meet floor runs here. */
const PIPE_Y = 0.32;
const HEADING = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] } as const;
const slugOf = (part: ProcessPartDefinition) => part.id.slice('process:'.length);
const parts = PROCESS_PART_DEFINITIONS.map((part) => [part.id, part] as const);

describe('process part definitions', () => {
  it('use ids process:<slug>, unique within the package and against library-cloud', () => {
    const ids = PROCESS_PART_DEFINITIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^process:[a-z0-9]+(-[a-z0-9]+)*$/);
    const cloudIds = new Set((cloudParts as Array<{ id: string }>).map((p) => p.id));
    expect(cloudIds.size).toBeGreaterThan(0);
    for (const id of ids) expect(cloudIds.has(id), id).toBe(false);
  });

  it('have distinct labels and hints (the palette shows both)', () => {
    expect(new Set(PROCESS_PART_DEFINITIONS.map((p) => p.label)).size).toBe(PROCESS_PART_DEFINITIONS.length);
    expect(new Set(PROCESS_PART_DEFINITIONS.map((p) => p.hint)).size).toBe(PROCESS_PART_DEFINITIONS.length);
  });

  it('are grouped by catalog family, families in catalog order, in the same order as the model contracts', () => {
    const seen = PROCESS_PART_DEFINITIONS.map((p) => p.category).filter((c, i, all) => all.indexOf(c) === i);
    // Each family is one contiguous run (the palette groups by first-seen category).
    const runs = PROCESS_PART_DEFINITIONS.map((p) => p.category).filter((c, i, all) => i === 0 || all[i - 1] !== c);
    expect(runs).toEqual(seen);
    expect(seen).toEqual(CATEGORIES.filter((c) => seen.includes(c)));
    expect(PROCESS_PART_DEFINITIONS.map(slugOf)).toEqual([...PROCESS_MODEL_SLUGS]);
  });

  it('round-trip through JSON (data-only: no functions, no components)', () => {
    for (const part of PROCESS_PART_DEFINITIONS) {
      expect(JSON.parse(JSON.stringify(part))).toEqual(part);
      expect(part).not.toHaveProperty('component');
    }
  });
});

describe.each(parts)('%s', (_id, part) => {
  const slug = slugOf(part);
  const model = PROCESS_MODELS[slug]!;
  const resolved = createProcessParts((path) => `https://cdn.example.test/process/${path}`).find((p) => p.id === part.id)!;

  it('is a valid E2 part definition once installed, and a data-only one', () => {
    expect(isIsoPartDefinition(resolved)).toBe(true);
    expect(resolved.model).toBe(`https://cdn.example.test/process/models/${slug}.glb`);
    expect(part.model).toBe(processModelPath(slug));
    expect(part.instanced).toBe(false);
    expect(CATEGORIES).toContain(part.category);
    expect(part.hint.length).toBeGreaterThan(12);
  });

  it('declares only valid params, with defaults that pass their own spec', () => {
    expect(Object.keys(part.params).length).toBeGreaterThan(0);
    for (const [name, spec] of Object.entries(part.params)) {
      expect(isParamSpec(spec), name).toBe(true);
      expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/);
      if (spec.type === 'number' && spec.unit === '%') expect([spec.min, spec.max], name).toEqual([0, 100]);
    }
  });

  it('places the model the way it was authored (inline on the pipe axis, others on the floor)', () => {
    if (part.origin !== undefined) expect(ISO_PART_ORIGINS).toContain(part.origin);
    if (model.kind === 'inline') {
      expect(part.origin).toBe('pipe-axis');
      expect(part.inlineLength).toBe(model.length);
      // The 1-cell footprint is the selection halo; the body may not be longer than the cells it claims.
      expect(part.inlineLength!).toBeLessThanOrEqual(Math.max(part.footprint.w, part.footprint.h));
    } else {
      expect(part.origin ?? 'floor').toBe('floor');
      expect(part.inlineLength).toBeUndefined();
    }
  });

  it('claims whole grid cells that cover the model footprint', () => {
    const { w, h } = part.footprint;
    expect(Number.isInteger(w) && Number.isInteger(h)).toBe(true);
    expect(w).toBeGreaterThanOrEqual(model.footprint[0] - 1e-9);
    expect(h).toBeGreaterThanOrEqual(model.footprint[1] - 1e-9);
    if (model.kind === 'floor') expect([w, h]).toEqual([...model.footprint]);
    // Small mounted instruments never block pipe routing.
    expect(part.floor ?? false).toBe(model.kind === 'mounted');
  });

  it("binds every anim.* pivot to a declared param through a built-in animator, with that animator's settings", () => {
    const nodes = Object.entries(part.animNodes ?? {}).map(([, a]) => a.node).sort();
    expect(nodes).toEqual(Object.keys(model.anim).map((n) => `anim.${n}`).sort());
    for (const [param, binding] of Object.entries(part.animNodes ?? {})) {
      expect(part.params[param], `${param} is declared`).toBeDefined();
      const animator = BUILTIN_ISO_ANIMATORS.find((a) => a.id === binding.animator);
      expect(animator, binding.animator).toBeDefined();
      for (const [key, value] of Object.entries(binding.settings ?? {})) {
        const spec = animator!.settings?.[key];
        expect(spec, `${binding.animator}.${key}`).toBeDefined();
        expect(isParamSpec({ ...spec, default: value }), `${binding.animator}.${key} = ${String(value)}`).toBe(true);
      }
      // A gated spin names a declared boolean.
      const gate = binding.settings?.enableParam;
      if (typeof gate === 'string' && gate !== '') expect(part.params[gate]?.type).toBe('boolean');
    }
  });

  it('mounted parts carry a per-placement mount height whose default stands them on the floor', () => {
    if (model.kind !== 'mounted') {
      expect(part.heightParam).toBeUndefined();
      return;
    }
    expect(part.heightParam).toBe('mountHeight');
    const spec = part.params.mountHeight!;
    expect(spec).toMatchObject({ type: 'number', min: 0, unit: 'cells' });
    // A horn that hangs below its flange (yMin < 0) is lifted so it rests on the floor.
    expect(spec.default).toBeCloseTo(-model.yMin, 9);
  });

  it('state colours name declared booleans, and a part with one has an hd.accent piece', () => {
    for (const state of part.stateColors ?? []) {
      expect(part.params[state.param]).toMatchObject({ type: 'boolean', default: false });
      expect(state.color).toMatch(/^#[\da-f]{6}$/i);
      expect(model.accent).toBe(true);
    }
  });

  it('shows state on hd.accent: a colour param when the model has one, and the alarm param is a declared boolean', () => {
    expect('color' in part.params).toBe(model.accent);
    if (model.accent) expect(part.params.color).toMatchObject({ type: 'color', default: '' });
    if (part.alarmParam !== undefined) {
      expect(model.accent, 'an alarm tint needs an hd.accent piece').toBe(true);
      expect(part.params[part.alarmParam]).toMatchObject({ type: 'boolean', default: false });
    }
  });

  it('declares grid ports only where a pipe from that node really meets a GLB nozzle', () => {
    for (const [name, port] of Object.entries(part.ports ?? {})) {
      const nozzle = model.ports[name];
      expect(nozzle, `port.${name} exists in the GLB`).toBeDefined();
      const [x, y, z] = nozzle!.at;
      // The grid heading is the nozzle's facing (n = -z, e = +x, s = +z, w = -x).
      expect(nozzle!.facing, `port.${name} faces its grid heading`).toBe({ n: '-z', e: '+x', s: '+z', w: '-x' }[port.dir]);
      // The nozzle face lies on the pipe leaving the port node in `dir`, within one cell,
      // at the pipe axis height (local Y 0 for inline parts, pipeWorldY() for floor parts).
      const [dx, dz] = HEADING[port.dir];
      const along = (x - port.x) * dx + (z - port.y) * dz;
      const across = Math.abs((x - port.x) * dz - (z - port.y) * dx);
      expect(along, `port.${name} is outward of its node`).toBeGreaterThanOrEqual(0);
      expect(along).toBeLessThan(1);
      expect(across, `port.${name} is on the pipe axis`).toBeLessThan(1e-6);
      expect(y).toBeCloseTo(model.kind === 'inline' ? 0 : PIPE_Y, 6);
    }
    if (model.kind === 'inline') {
      // Like the built-in valve: a pipe snaps to the body centre and leaves east or west (holodeck#47).
      expect(part.ports).toMatchObject({ in: { x: 0, y: 0, dir: 'w' }, out: { x: 0, y: 0, dir: 'e' } });
      // Every on-axis GLB nozzle of an inline part is routable.
      expect(Object.keys(part.ports!).sort()).toEqual(Object.keys(model.ports).sort());
    }
  });
});

describe('the catalog doc', () => {
  // docs/assets/process-catalog.md: a part is listed as placeable from this
  // package only when its GLB and definition are committed here.
  const doc = readFileSync(new URL('../../../docs/assets/process-catalog.md', import.meta.url), 'utf8');
  const claimed = [...doc.matchAll(/^\| `([a-z0-9-]+)`[^\n]*\| have \(`library-process`\)/gm)].map((m) => m[1]).sort();

  it('marks exactly the defined parts as placeable', () => {
    expect(claimed).toEqual(PROCESS_PART_DEFINITIONS.map(slugOf).sort());
  });
});
