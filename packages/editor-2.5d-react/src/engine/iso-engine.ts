/**
 * The `holodeck.iso` engine descriptor (contract: @holodeck/sdk docs/PACKAGING.md §2).
 *
 *   const host = new HolodeckHost({ name: 'studio' });
 *   host.registerEngine(isoEngine);                          // the four holodeck.iso.* kinds
 *   await host.installPackage(ISO_PACKAGE_MANIFEST, isoPackage);   // built-in parts/themes/animators
 *
 * Plain data and pure functions: registering it mounts no React.
 */

import { ContributionRegistry, HOLODECK_KINDS, type HolodeckEngine } from '@holodeck/sdk';
import { parseSceneFile, type IsoSceneFile } from '../iso/scene';
import { ISO_KINDS } from '../registry/kinds';
import type { IsoPartDefinition } from '../registry/types';
import { collectIsoBindings, placementBindingProblems, placementsOf } from './bindings';

export const ISO_ENGINE_ID = 'holodeck.iso';
/**
 * Contribution API version. Packages target it with `engines: { "holodeck.iso": "^1.0" }`.
 * Adding an optional field to a contribution type is a minor bump; removing or
 * reinterpreting one is a major bump (PACKAGING.md §2).
 */
export const ISO_ENGINE_API_VERSION = '1.0.0';
/** Format id of `HolodeckDocument.body` for this engine: an `IsoSceneFile`. */
export const ISO_DOCUMENT_FORMAT = 'holodeck.iso.scene.v1';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface IsoEngineOptions {
  /**
   * Also check that every placement names a part installed in this registry
   * (pass `host.registry`). Default: structure and bindings only, because the
   * descriptor is registered before packages are installed and a check against
   * the built-ins alone would reject every document that uses a library part.
   */
  registry?: ContributionRegistry;
}

/** An iso engine descriptor. Most hosts want the shared `isoEngine`. */
export function createIsoEngine(options: IsoEngineOptions = {}): HolodeckEngine<IsoSceneFile> {
  const { registry } = options;
  return Object.freeze({
    id: ISO_ENGINE_ID,
    label: 'Holodeck 2.5D',
    apiVersion: ISO_ENGINE_API_VERSION,
    documentFormat: ISO_DOCUMENT_FORMAT,
    kinds: ISO_KINDS,
    collectBindings: (body: IsoSceneFile) => collectIsoBindings(body),
    validateBody: (body: unknown) => validateIsoBody(body, registry),
  });
}

/** The `holodeck.iso` engine; validates structure and bindings, not part availability. */
export const isoEngine: HolodeckEngine<IsoSceneFile> = createIsoEngine();

/**
 * Every problem with an iso body; empty = valid. Never throws (hosts call it
 * from `checkDocument` on untrusted input).
 *
 * Structure is checked by `parseSceneFile`, which stops at the first problem,
 * so at most one structural problem is listed. Binding problems are listed in
 * full. With `registry`, unknown parts are problems too; without it every
 * part id counts as installed.
 */
export function validateIsoBody(body: unknown, registry?: ContributionRegistry): string[] {
  try {
    return checkIsoBody(body, registry ?? structuralRegistry(body)).problems;
  } catch (error) {
    // Only reachable with hostile input such as a throwing getter or Proxy.
    return [`body could not be validated: ${messageOf(error)}`];
  }
}

/**
 * Parse a body against `registry` and list its problems, each exactly once.
 * `scene` is set only when there are none. May throw on hostile input (see
 * `validateIsoBody`).
 */
export function checkIsoBody(
  body: unknown,
  registry: ContributionRegistry,
): { problems: string[]; scene?: IsoSceneFile } {
  const bindingProblems = placementsOf(body).flatMap((p) => (isRecord(p) ? placementBindingProblems(p.id, p.bindings) : []));
  try {
    // parseSceneFile also rejects bad bindings, but only the first one. When
    // there are any, parse a copy without them: the structural check then
    // reports only what the full binding list does not already say.
    const scene = parseSceneFile(bindingProblems.length ? withoutBindings(body) : body, registry);
    return bindingProblems.length ? { problems: bindingProblems } : { problems: [], scene };
  } catch (error) {
    return { problems: [messageOf(error), ...bindingProblems] };
  }
}

function withoutBindings(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.objects)) return body;
  const objects = body.objects.map((placement: unknown) => {
    if (!isRecord(placement) || !('bindings' in placement)) return placement;
    const copy = { ...placement };
    delete copy.bindings;
    return copy;
  });
  return { ...body, objects };
}

/**
 * A registry in which every part id the body mentions is installed (as a 1x1
 * stub with no params), so `parseSceneFile` checks structure only. Reusing the
 * parser keeps one definition of "well-formed scene" instead of a second copy
 * that would drift from it.
 */
function structuralRegistry(body: unknown): ContributionRegistry {
  const registry = new ContributionRegistry();
  registry.registerKind({ kind: HOLODECK_KINDS.isoPart });
  const ids = new Set<string>();
  for (const placement of placementsOf(body)) {
    // Empty ids are left out so the parser reports `unknown library object ""`.
    if (isRecord(placement) && typeof placement.object === 'string' && placement.object !== '') ids.add(placement.object);
  }
  if (ids.size) {
    const stubs = [...ids].map(
      (id): Pick<IsoPartDefinition, 'id' | 'label' | 'footprint' | 'params'> => ({ id, label: id, footprint: { w: 1, h: 1 }, params: {} }),
    );
    registry.install({ id: 'holodeck.iso.structural-check', version: '1.0.0', contributions: { [HOLODECK_KINDS.isoPart]: stubs } });
  }
  return registry;
}
