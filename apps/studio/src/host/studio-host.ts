/**
 * The studio's `HolodeckHost` (contract: @holodeck/sdk docs/PACKAGING.md §4).
 *
 * Engines are registered, then packages are installed through their
 * manifests, exactly as a third-party host would: the studio has no private
 * path into the iso engine. Adding a library later is one more entry in
 * `STUDIO_PACKAGES`.
 */

import {
  HolodeckHost,
  parseVersion,
  satisfiesRange,
  type HolodeckDocument,
  type HolodeckEngine,
  type HolodeckPackageModule,
} from '@holodeck/sdk';
import {
  ISO_ENGINE_ID,
  ISO_PACKAGE_MANIFEST,
  IsoDocumentError,
  isoEngine,
  isoPackage,
  loadIsoDocument,
} from '@holodeck/editor-2.5d-react';

export const STUDIO_HOST_NAME = 'holodeck-studio';

export interface StudioPackage {
  manifest: unknown;
  module: HolodeckPackageModule;
}

export const STUDIO_ENGINES: readonly HolodeckEngine[] = [isoEngine as HolodeckEngine];
export const STUDIO_PACKAGES: readonly StudioPackage[] = [{ manifest: ISO_PACKAGE_MANIFEST, module: isoPackage }];

/** The engine new documents use. */
export const DEFAULT_ENGINE_ID = ISO_ENGINE_ID;

export async function createStudioHost(
  engines: readonly HolodeckEngine[] = STUDIO_ENGINES,
  packages: readonly StudioPackage[] = STUDIO_PACKAGES,
): Promise<HolodeckHost> {
  const host = new HolodeckHost({ name: STUDIO_HOST_NAME });
  for (const engine of engines) host.registerEngine(engine);
  for (const pkg of packages) await host.installPackage(pkg.manifest, pkg.module);
  return host;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Everything that stops this host from opening `doc`, beyond the envelope
 * shape: the engine must be registered, every `requires` entry installed in a
 * matching version, and the body valid for the engine. Iso bodies are checked
 * against the host registry, so a placement of an uninstalled part is a
 * problem. Never throws.
 */
export function hostDocumentProblems(host: HolodeckHost, doc: HolodeckDocument): string[] {
  const problems: string[] = [];
  const engine = host.engine(doc.engine);
  if (!engine) return [`engine: "${doc.engine}" is not installed in this studio`];
  for (const [id, range] of Object.entries(doc.requires ?? {})) {
    const installed = host.package(id);
    if (!installed) problems.push(`requires: package "${id}" is not installed`);
    else if (!satisfiesRange(installed.manifest.version, range)) {
      problems.push(`requires: "${id}" ${range} is needed, ${installed.manifest.version} is installed`);
    }
  }
  try {
    if (doc.engine === ISO_ENGINE_ID) loadIsoDocument(doc, host.registry);
    else problems.push(...(engine.validateBody?.(doc.body) ?? []));
  } catch (error) {
    problems.push(...(error instanceof IsoDocumentError ? error.problems : [messageOf(error)]));
  }
  return problems;
}

/**
 * `requires` for a document: package id -> `^MAJOR.MINOR` of the installed
 * version, for every package that contributed something the body uses
 * (`usedContributions` lists `[kind, id]` pairs). The engine's own package is
 * included when anything from it is used.
 */
export function requiresFor(host: HolodeckHost, usedContributions: Iterable<readonly [string, string]>): Record<string, string> {
  const requires: Record<string, string> = {};
  for (const [kind, id] of usedContributions) {
    const owner = host.registry.ownerOf(kind, id);
    const pkg = owner === undefined ? undefined : host.package(owner);
    if (!pkg) continue;
    const version = parseVersion(pkg.manifest.version);
    if (version) requires[pkg.manifest.id] = `^${version.major}.${version.minor}`;
  }
  return Object.fromEntries(Object.entries(requires).sort(([a], [b]) => a.localeCompare(b)));
}
