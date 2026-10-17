import {
  ContributionRegistry,
  HOLODECK_KINDS,
  type ContributionKind,
} from '@holodeck/sdk';
import type { IsoAnimator, IsoInspectorPanel, IsoPartDefinition, IsoPartParamSpec, IsoTheme } from './types';
import { assetUrlProblem, isHexColor, paramValueProblem } from '../objects/validate';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A React component is a function, or an object (`memo`, `forwardRef`, `lazy`). */
const isComponent = (v: unknown): boolean => typeof v === 'function' || (isObj(v) && '$$typeof' in v);

const PARAM_TYPES = ['number', 'boolean', 'string', 'enum', 'color'];

export function isParamSpec(v: unknown): v is IsoPartParamSpec {
  if (!isObj(v) || !PARAM_TYPES.includes(v.type as string) || typeof v.label !== 'string' || !('default' in v)) {
    return false;
  }
  if (v.type === 'enum' && !(Array.isArray(v.options) && v.options.length > 0 && v.options.every((o) => typeof o === 'string'))) {
    return false;
  }
  for (const bound of ['min', 'max', 'step', 'maxLength'] as const) {
    if (v[bound] !== undefined && !isNum(v[bound])) return false;
  }
  if (isNum(v.min) && isNum(v.max) && v.min > v.max) return false;
  if (v.reading !== undefined && (typeof v.reading !== 'boolean' || v.type !== 'number')) return false;
  // The default must itself be a value the spec accepts (undefined = "no default").
  return paramValueProblem(v as unknown as IsoPartParamSpec, v.default) === null;
}

/** Largest data-only block / logo size in world units: a part, not a landscape. */
const MAX_DATA_PART_SIZE = 64;
const isPositiveSize = (v: unknown): boolean => isNum(v) && v > 0 && v <= MAX_DATA_PART_SIZE;

const isParamSpecMap = (v: unknown): boolean => isObj(v) && Object.values(v).every(isParamSpec);

export function isIsoPartDefinition(item: unknown): item is IsoPartDefinition {
  if (!isObj(item) || !isStr(item.id) || typeof item.label !== 'string') return false;
  const fp = item.footprint;
  if (!isObj(fp) || !isNum(fp.w) || !isNum(fp.h) || fp.w <= 0 || fp.h <= 0) return false;
  if (!isParamSpecMap(item.params)) return false;
  // component is optional: data-only parts render through DataPart (model / logo / colours).
  if (item.component !== undefined && !isComponent(item.component)) return false;
  if (item.logo !== undefined) {
    if (!isObj(item.logo) || assetUrlProblem(item.logo.url) !== null) return false;
    if (item.logo.size !== undefined && !isPositiveSize(item.logo.size)) return false;
  }
  if (item.colors !== undefined) {
    if (!isObj(item.colors)) return false;
    for (const [key, value] of Object.entries(item.colors)) {
      if (!['body', 'accent', 'edge'].includes(key) || !isHexColor(value)) return false;
    }
  }
  if (item.blockHeight !== undefined && !isPositiveSize(item.blockHeight)) return false;
  if (item.floor !== undefined && typeof item.floor !== 'boolean') return false;
  if (item.extent !== undefined && typeof item.extent !== 'function') return false;
  if (item.instanced && !isComponent(item.instancedRenderer)) return false;
  if (item.model !== undefined && typeof item.model !== 'string') return false;
  if (item.animNodes !== undefined) {
    if (!isObj(item.animNodes)) return false;
    for (const a of Object.values(item.animNodes)) {
      if (!isObj(a) || !isStr(a.node) || !isStr(a.animator)) return false;
    }
  }
  return true;
}

export function isIsoTheme(item: unknown): item is IsoTheme {
  if (!isObj(item) || !isStr(item.id) || typeof item.label !== 'string' || !isObj(item.style)) return false;
  const s = item.style;
  return isObj(s.colors) && isObj(s.edges) && isObj(s.finishes);
}

export function isIsoAnimator(item: unknown): item is IsoAnimator {
  return (
    isObj(item) &&
    isStr(item.id) &&
    typeof item.label === 'string' &&
    isStr(item.param) &&
    typeof item.apply === 'function' &&
    (item.settings === undefined || isParamSpecMap(item.settings))
  );
}

export function isIsoInspectorPanel(item: unknown): item is IsoInspectorPanel {
  return isObj(item) && isStr(item.id) && typeof item.label === 'string' && isComponent(item.component);
}

export const ISO_PART_KIND: ContributionKind<IsoPartDefinition> = {
  kind: HOLODECK_KINDS.isoPart,
  validate: isIsoPartDefinition,
};
export const ISO_THEME_KIND: ContributionKind<IsoTheme> = { kind: HOLODECK_KINDS.isoTheme, validate: isIsoTheme };
export const ISO_ANIMATOR_KIND: ContributionKind<IsoAnimator> = {
  kind: HOLODECK_KINDS.isoAnimator,
  validate: isIsoAnimator,
};
export const ISO_INSPECTOR_KIND: ContributionKind<IsoInspectorPanel> = {
  kind: HOLODECK_KINDS.isoInspector,
  validate: isIsoInspectorPanel,
};

/** All four kind definitions, for the conformance kit and for `registerIsoKinds`. */
export const ISO_KINDS = [ISO_PART_KIND, ISO_THEME_KIND, ISO_ANIMATOR_KIND, ISO_INSPECTOR_KIND] as const;

/**
 * Register the four `holodeck.iso.*` kinds on `registry`. Returns one
 * function that unregisters all of them. Throws (and registers nothing) if a
 * kind is already registered.
 */
export function registerIsoKinds(registry: ContributionRegistry): () => void {
  const undo: Array<() => void> = [];
  try {
    for (const kind of ISO_KINDS) {
      undo.push(registry.registerKind(kind as unknown as ContributionKind));
    }
  } catch (err) {
    for (const u of undo.reverse()) u();
    throw err;
  }
  return () => {
    for (const u of undo.reverse()) u();
  };
}

/** A `ContributionRegistry` with the iso kinds registered (no extensions installed). */
export function createIsoRegistry(): ContributionRegistry {
  const registry = new ContributionRegistry();
  registerIsoKinds(registry);
  return registry;
}
