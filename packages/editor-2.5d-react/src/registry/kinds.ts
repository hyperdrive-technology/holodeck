import {
  ContributionRegistry,
  HOLODECK_KINDS,
  type ContributionKind,
} from '@holodeck/sdk';
import type { IsoAnimator, IsoInspectorPanel, IsoPartDefinition, IsoPartParamSpec, IsoTheme } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A React component is a function, or an object (`memo`, `forwardRef`, `lazy`). */
const isComponent = (v: unknown): boolean => typeof v === 'function' || (isObj(v) && '$$typeof' in v);

const PARAM_TYPES = ['number', 'boolean', 'string', 'enum'];

export function isParamSpec(v: unknown): v is IsoPartParamSpec {
  if (!isObj(v) || !PARAM_TYPES.includes(v.type as string) || typeof v.label !== 'string' || !('default' in v)) {
    return false;
  }
  if (v.type === 'enum') return Array.isArray(v.options) && v.options.length > 0;
  return true;
}

const isParamSpecMap = (v: unknown): boolean => isObj(v) && Object.values(v).every(isParamSpec);

export function isIsoPartDefinition(item: unknown): item is IsoPartDefinition {
  if (!isObj(item) || !isStr(item.id) || typeof item.label !== 'string') return false;
  const fp = item.footprint;
  if (!isObj(fp) || !isNum(fp.w) || !isNum(fp.h) || fp.w <= 0 || fp.h <= 0) return false;
  if (!isParamSpecMap(item.params)) return false;
  if (!isComponent(item.component)) return false;
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
