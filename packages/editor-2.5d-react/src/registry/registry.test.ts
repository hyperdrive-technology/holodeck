import { ContributionRegistry, HOLODECK_KINDS, runContributionKindConformance } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { FILL_ANIMATOR, SPIN_ANIMATOR } from '../anim/animators';
import { BUILTIN_ISO_EXTENSION, BUILTIN_ISO_PARTS } from './builtin';
import { createIsoRegistryWithBuiltins } from './default';
import {
  ISO_ANIMATOR_KIND,
  ISO_INSPECTOR_KIND,
  ISO_KINDS,
  ISO_PART_KIND,
  ISO_THEME_KIND,
  createIsoRegistry,
  isIsoAnimator,
  isIsoInspectorPanel,
  isIsoPartDefinition,
  isIsoTheme,
  registerIsoKinds,
} from './kinds';
import { resolveParams } from './params';
import { getStore } from './react';
import { HOLODECK_THEME_DARK, HOLODECK_THEME_DEFAULT } from './themes';
import type { IsoInspectorPanel, IsoPartDefinition } from './types';

const noop = () => null;

const part = (id: string, extra: Partial<IsoPartDefinition> = {}): IsoPartDefinition => ({
  id,
  label: id,
  footprint: { w: 1, h: 1 },
  params: {},
  component: noop,
  ...extra,
});
const panel = (id: string): IsoInspectorPanel => ({ id, label: id, component: noop });

function conformance<T extends { id: string }>(kind: Parameters<typeof runContributionKindConformance<T>>[1], samples: [T, T]) {
  const failures: string[] = [];
  runContributionKindConformance<T>(() => new ContributionRegistry(), kind, samples, (ok, message) => {
    if (!ok) failures.push(message);
  });
  expect(failures).toEqual([]);
}

describe('conformance kit', () => {
  it('holodeck.iso.part', () => conformance(ISO_PART_KIND, [part('a'), part('b')]));
  it('holodeck.iso.theme', () =>
    conformance(ISO_THEME_KIND, [HOLODECK_THEME_DEFAULT, { ...HOLODECK_THEME_DARK, id: 'other' }]));
  it('holodeck.iso.animator', () => conformance(ISO_ANIMATOR_KIND, [SPIN_ANIMATOR, FILL_ANIMATOR]));
  it('holodeck.iso.inspector', () => conformance(ISO_INSPECTOR_KIND, [panel('a'), panel('b')]));
});

describe('structural validators', () => {
  it('accepts a minimal part and rejects malformed ones', () => {
    expect(isIsoPartDefinition(part('ok'))).toBe(true);
    expect(isIsoPartDefinition(null)).toBe(false);
    expect(isIsoPartDefinition(part(''))).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), footprint: { w: 0, h: 1 } })).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), footprint: { w: 1 } })).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), component: 'div' })).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), params: { a: { type: 'nope', label: 'a', default: 0 } } })).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), params: { a: { type: 'enum', label: 'a', default: 'q' } } })).toBe(false);
    expect(isIsoPartDefinition({ ...part('x'), animNodes: { level: { node: 'anim.liquid' } } })).toBe(false);
  });

  it('requires a pool renderer for instanced parts', () => {
    expect(isIsoPartDefinition(part('p', { instanced: true }))).toBe(false);
    expect(isIsoPartDefinition(part('p', { instanced: true, instancedRenderer: noop }))).toBe(true);
  });

  it('accepts memo / forwardRef style component objects', () => {
    expect(isIsoPartDefinition({ ...part('m'), component: { $$typeof: Symbol.for('react.memo') } })).toBe(true);
  });

  it('validates themes, animators and inspector panels', () => {
    expect(isIsoTheme(HOLODECK_THEME_DARK)).toBe(true);
    expect(isIsoTheme({ id: 't', label: 't', style: {} })).toBe(false);
    expect(isIsoAnimator(SPIN_ANIMATOR)).toBe(true);
    expect(isIsoAnimator({ ...SPIN_ANIMATOR, apply: undefined })).toBe(false);
    expect(isIsoAnimator({ ...SPIN_ANIMATOR, param: '' })).toBe(false);
    expect(isIsoInspectorPanel(panel('p'))).toBe(true);
    expect(isIsoInspectorPanel({ id: 'p', label: 'p' })).toBe(false);
  });

  it('rejects an install whose part fails validation and leaves the registry untouched', () => {
    const registry = createIsoRegistry();
    expect(() =>
      registry.install({
        id: 'bad',
        version: '1',
        contributions: { [HOLODECK_KINDS.isoPart]: [part('good'), { id: 'bad' } as never] },
      }),
    ).toThrow(/failed validation/);
    expect(registry.list(HOLODECK_KINDS.isoPart)).toHaveLength(0);
  });
});

describe('registerIsoKinds / createIsoRegistry', () => {
  it('registers all four kinds and unregisters them together', () => {
    const registry = new ContributionRegistry();
    const undo = registerIsoKinds(registry);
    for (const k of ISO_KINDS) expect(registry.hasKind(k.kind)).toBe(true);
    undo();
    for (const k of ISO_KINDS) expect(registry.hasKind(k.kind)).toBe(false);
  });

  it('is all-or-nothing when a kind is already taken', () => {
    const registry = new ContributionRegistry();
    registry.registerKind({ kind: HOLODECK_KINDS.isoAnimator });
    expect(() => registerIsoKinds(registry)).toThrow(/already registered/);
    expect(registry.hasKind(HOLODECK_KINDS.isoPart)).toBe(false);
  });

  it('createIsoRegistry starts empty; late installs of unregistered packs stay pending', () => {
    const registry = createIsoRegistry();
    expect(registry.list(HOLODECK_KINDS.isoPart)).toHaveLength(0);
    const res = registry.install({ id: 'x', version: '1', contributions: { 'other.kind': [{ id: 'q' }] } });
    expect(res.pending).toEqual(['other.kind']);
  });
});

describe('built-in extension', () => {
  it('installs cleanly with the nine original parts, two themes and five animators', () => {
    const registry = createIsoRegistryWithBuiltins();
    expect(BUILTIN_ISO_EXTENSION.id).toBe('holodeck.iso.builtin');
    expect(
      registry
        .list<IsoPartDefinition>(HOLODECK_KINDS.isoPart)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['area', 'elbow', 'end-cap', 'label', 'mixer', 'pipe', 'shaft', 'tank', 'valve']);
    expect(registry.list(HOLODECK_KINDS.isoTheme)).toHaveLength(2);
    expect(
      registry
        .list(HOLODECK_KINDS.isoAnimator)
        .map((a) => a.id)
        .sort(),
    ).toEqual(['bob', 'fill', 'pulse', 'spin', 'visible']);
  });

  it('keeps the old footprints and pooled kinds', () => {
    const byId = Object.fromEntries(BUILTIN_ISO_PARTS.map((p) => [p.id, p]));
    expect(byId.tank?.footprint).toEqual({ w: 2, h: 2 });
    expect(byId.mixer?.footprint).toEqual({ w: 2, h: 2 });
    expect(byId.area?.footprint).toEqual({ w: 8, h: 6 });
    expect(byId.valve?.footprint).toEqual({ w: 1, h: 1 });
    expect(BUILTIN_ISO_PARTS.filter((p) => p.instanced).map((p) => p.id).sort()).toEqual([
      'elbow',
      'end-cap',
      'pipe',
      'valve',
    ]);
  });

  it('declares the param surface the doc asks for', () => {
    const byId = Object.fromEntries(BUILTIN_ISO_PARTS.map((p) => [p.id, p]));
    expect(Object.keys(byId.tank!.params)).toEqual(expect.arrayContaining(['level', 'temp']));
    expect(Object.keys(byId.mixer!.params)).toEqual(['level', 'rpm', 'alarm']);
    expect(byId.valve!.params.open?.type).toBe('boolean');
    expect(byId.label!.params.text?.type).toBe('string');
    expect(byId.tank!.params.level).toMatchObject({ min: 0, max: 1 });
  });
});

describe('contribution store (backs useIsoContributions)', () => {
  it('gives a stable snapshot until the registry changes, then a fresh one, and notifies', () => {
    const registry = createIsoRegistry();
    const store = getStore(registry);
    let calls = 0;
    const off = store.subscribe(() => (calls += 1));
    const empty = store.snapshot(HOLODECK_KINDS.isoPart);
    expect(store.snapshot(HOLODECK_KINDS.isoPart)).toBe(empty);

    registry.install({ id: 'late', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [part('late-part')] } });
    expect(calls).toBe(1);
    const after = store.snapshot(HOLODECK_KINDS.isoPart);
    expect(after).not.toBe(empty);
    expect(after.map((p) => p.id)).toEqual(['late-part']);

    registry.uninstall('late');
    expect(calls).toBe(2);
    expect(store.snapshot(HOLODECK_KINDS.isoPart)).toHaveLength(0);

    off();
    registry.install({ id: 'again', version: '1', contributions: {} });
    expect(calls).toBe(2);
    // A change with no subscriber must still invalidate the cache.
    registry.install({ id: 'quiet', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [part('q')] } });
    expect(store.snapshot(HOLODECK_KINDS.isoPart)).toHaveLength(1);
  });

  it('is shared per registry', () => {
    const registry = createIsoRegistry();
    expect(getStore(registry)).toBe(getStore(registry));
    expect(getStore(createIsoRegistry())).not.toBe(getStore(registry));
  });
});

describe('resolveParams', () => {
  const def = {
    params: {
      level: { type: 'number', label: 'Level', default: 0.35 },
      alarm: { type: 'boolean', label: 'Alarm', default: false },
    },
  } satisfies Pick<IsoPartDefinition, 'params'>;

  it('falls back to spec defaults', () => {
    expect(resolveParams(def, { id: 'a' })).toEqual({ level: 0.35, alarm: false });
  });

  it('layers placement.params over defaults and metrics over both', () => {
    const placement = { id: 'a', params: { level: 0.5, alarm: true } };
    expect(resolveParams(def, placement)).toEqual({ level: 0.5, alarm: true });
    expect(resolveParams(def, placement, { a: { level: 0.9 } })).toEqual({ level: 0.9, alarm: true });
  });

  it('only reads the metrics of its own placement', () => {
    expect(resolveParams(def, { id: 'a' }, { b: { level: 1 } })).toEqual({ level: 0.35, alarm: false });
  });

  it('lets undefined fall through but keeps null, 0 and false as real values', () => {
    const placement = { id: 'a', params: { level: 0.5 } };
    expect(resolveParams(def, placement, { a: { level: undefined } }).level).toBe(0.5);
    expect(resolveParams(def, placement, { a: { level: 0 } }).level).toBe(0);
    expect(resolveParams(def, placement, { a: { level: null } }).level).toBeNull();
    expect(resolveParams(def, { id: 'a', params: { alarm: true } }, { a: { alarm: false } }).alarm).toBe(false);
  });

  it('passes through undeclared keys so hosts can drive animNodes-only params', () => {
    expect(resolveParams(def, { id: 'a' }, { a: { agitatorRpm: 60 } }).agitatorRpm).toBe(60);
  });

  it('does not mutate its inputs', () => {
    const placement = { id: 'a', params: { level: 0.5 } };
    const metrics = { a: { level: 0.9 } };
    resolveParams(def, placement, metrics);
    expect(placement).toEqual({ id: 'a', params: { level: 0.5 } });
    expect(metrics).toEqual({ a: { level: 0.9 } });
  });
});

import { placementFootprint, snapParamValue } from './params';
describe('placementFootprint / snapParamValue', () => {
  it('uses footprintOf when the part sizes itself from a param, else the static footprint', () => {
    const registry = createIsoRegistryWithBuiltins();
    const sized: IsoPartDefinition = {
      id: 'test:sized',
      label: 'Sized',
      footprint: { w: 2, h: 2 },
      footprintOf: (p) => ({ w: Math.ceil(2 * Number(p.params?.radius ?? 1)), h: 2 }),
      params: { radius: { type: 'number', label: 'R', default: 1 } },
      component: () => null,
    };
    registry.install({ id: 'test.sized', version: '1', contributions: { [HOLODECK_KINDS.isoPart]: [sized] } });
    expect(placementFootprint(registry, { id: 'a', object: 'test:sized', x: 0, y: 0, params: { radius: 1.6 } })).toEqual({ w: 4, h: 2 });
    expect(placementFootprint(registry, { id: 'a', object: 'tank', x: 0, y: 0 })).toEqual({ w: 2, h: 2 });
    expect(placementFootprint(registry, { id: 'a', object: 'nope', x: 0, y: 0 })).toEqual({ w: 1, h: 1 });
  });

  it('snaps to the step and clamps to min/max without float noise', () => {
    const spec = { min: 0.3, max: 3, step: 0.05 };
    expect(snapParamValue(spec, 1.2345)).toBe(1.25);
    expect(snapParamValue(spec, 0.1)).toBe(0.3);
    expect(snapParamValue(spec, 9)).toBe(3);
    expect(snapParamValue({ step: 0.1 }, 0.3000000004)).toBe(0.3);
    expect(snapParamValue(undefined, 1.234)).toBe(1.234);
  });
});
