/**
 * The studio's `HolodeckHost` (contract: @holodeck/sdk docs/PACKAGING.md §4).
 *
 * Engines are registered, then packages are installed through their
 * manifests, exactly as a third-party host would: the studio has no private
 * path into the iso engine. Adding a library later is one more entry in
 * `STUDIO_PACKAGES`.
 */

import {
  HOLODECK_KINDS,
  HolodeckHost,
  type HolodeckProvider,
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
import { connectionConfigProblems } from '../connections/credentials';
import { PROVIDER_PACKAGES } from './provider-packages';

export const STUDIO_HOST_NAME = 'holodeck-studio';

export interface StudioPackage {
  manifest: unknown;
  module: HolodeckPackageModule;
}

export const STUDIO_ENGINES: readonly HolodeckEngine[] = [isoEngine as HolodeckEngine];
export const STUDIO_PACKAGES: readonly StudioPackage[] = [{ manifest: ISO_PACKAGE_MANIFEST, module: isoPackage }, ...PROVIDER_PACKAGES];

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
 *
 * `document` is the engine loader's normalised form when there are no
 * problems: for iso, `loadIsoDocument` copies an envelope-only `theme` into
 * the body and makes `body.id` the envelope id (holodeck#109). Store that,
 * not the raw input, or the canvas renders something other than what was
 * validated.
 */
export function checkHostDocument(host: HolodeckHost, doc: HolodeckDocument): { problems: string[]; document?: HolodeckDocument } {
  const problems: string[] = [];
  const engine = host.engine(doc.engine);
  if (!engine) return { problems: [`engine: "${doc.engine}" is not installed in this studio`] };
  for (const [id, range] of Object.entries(doc.requires ?? {})) {
    const installed = host.package(id);
    if (!installed) problems.push(`requires: package "${id}" is not installed`);
    else if (!satisfiesRange(installed.manifest.version, range)) {
      problems.push(`requires: "${id}" ${range} is needed, ${installed.manifest.version} is installed`);
    }
  }
  // Credentials never travel in a document (secrets stay in this tab's
  // sessionStorage, connections/secrets.ts): refuse any config that carries
  // one, by the provider's own rules and a generic scan (connections/credentials.ts).
  // This runs on every save (the store's validator), import and embed load.
  for (const connection of doc.connections ?? []) {
    const provider = host.registry.get<HolodeckProvider>(HOLODECK_KINDS.provider, connection.provider);
    problems.push(...connectionConfigProblems(connection, provider).map((p) => `connections.${connection.id}.config: ${p}`));
  }
  let document: HolodeckDocument = doc;
  try {
    if (doc.engine === ISO_ENGINE_ID) document = loadIsoDocument(doc, host.registry).document as HolodeckDocument;
    else problems.push(...(engine.validateBody?.(doc.body) ?? []));
  } catch (error) {
    problems.push(...(error instanceof IsoDocumentError ? error.problems : [messageOf(error)]));
  }
  return problems.length ? { problems } : { problems, document };
}

export function hostDocumentProblems(host: HolodeckHost, doc: HolodeckDocument): string[] {
  return checkHostDocument(host, doc).problems;
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
