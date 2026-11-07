/**
 * Document checks and `requires` bookkeeping for a `HolodeckHost`: everything
 * the studio runs on a document before it is stored, imported or embedded.
 *
 * Pure (no browser APIs, no bundler-only imports), so the Node MCP server
 * (`packages/mcp`, which bundles this file) validates documents exactly as the
 * studio does. Keep it that way: no React, no `?url` imports, no `window` /
 * IndexedDB. `studio-host.ts` re-exports everything here.
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
import { ISO_ENGINE_ID, IsoDocumentError, loadIsoDocument, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { usedIsoContributions } from '../documents/iso-scene';
import { connectionConfigProblems, credentialInText } from '../connections/credentials';

export interface StudioPackage {
  manifest: unknown;
  module: HolodeckPackageModule;
}

/** A host with `engines` registered and `packages` installed through their manifests, in order. */
export async function createHost(name: string, engines: readonly HolodeckEngine[], packages: readonly StudioPackage[]): Promise<HolodeckHost> {
  const host = new HolodeckHost({ name });
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
    let found: string[];
    try {
      found = connectionConfigProblems(connection, provider);
    } catch (error) {
      // Belt and braces for the never-throws contract (parseDocumentText):
      // anything the checks cannot handle is refused, not thrown.
      found = [`could not be checked (${messageOf(error)})`];
    }
    problems.push(...found.map((p) => `connections.${connection.id}.config: ${p}`));
    // A label is free text too (holodeck#170).
    const inLabel = typeof connection.label === 'string' ? credentialInText(connection.label) : null;
    if (inLabel) problems.push(`connections.${connection.id}.label: looks like ${inLabel}; credentials go in the connection's secrets`);
  }
  // Binding sources are provider addresses, which can carry an endpoint
  // query such as `/api?api_key=…` (holodeck#167).
  problems.push(...bindingSourceProblems(doc.body));
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

/**
 * `requires` for a whole document: the parts its body places AND the
 * providers its connections use (holodeck#172), so another host can
 * install / version-check e.g. `holodeck.provider-aws` for an AWS connection.
 */
export function documentRequires(
  host: HolodeckHost,
  scene: IsoSceneFile,
  connections: readonly { provider: string }[] = [],
): Record<string, string> {
  const used = [
    ...usedIsoContributions(scene),
    ...[...new Set(connections.map((c) => c.provider))].map((id) => [HOLODECK_KINDS.provider, id] as const),
  ];
  return requiresFor(host, used);
}

/**
 * The `requires` to store after an edit: `computed` (what the body uses, from
 * packages this host has) plus every `previous` entry whose package is NOT
 * installed here. An imported document may need packages this host lacks;
 * the host cannot tell whether the body still uses them, so dropping the
 * entry on first edit would silently lose the install hint (holodeck#187).
 * Installed packages are fully recomputed, so a no-longer-used one is dropped.
 */
export function mergeRequires(host: HolodeckHost, previous: Readonly<Record<string, string>> | undefined, computed: Record<string, string>): Record<string, string> {
  const merged = { ...computed };
  for (const [id, range] of Object.entries(previous ?? {})) {
    if (!host.package(id) && !(id in merged)) merged[id] = range;
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
}

/** Credential-looking binding sources in an iso body (`objects[].bindings[param].source`). */
export function bindingSourceProblems(body: unknown): string[] {
  const objects = body && typeof body === 'object' && Array.isArray((body as { objects?: unknown }).objects) ? (body as { objects: unknown[] }).objects : [];
  const problems: string[] = [];
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    const { id, bindings } = o as { id?: unknown; bindings?: unknown };
    if (!bindings || typeof bindings !== 'object') continue;
    for (const [param, b] of Object.entries(bindings as Record<string, unknown>)) {
      const source = b && typeof b === 'object' ? (b as { source?: unknown }).source : undefined;
      const found = typeof source === 'string' ? credentialInText(source) : null;
      if (found) problems.push(`${String(id)}.${param}: the binding source looks like ${found}; credentials go in the connection's secrets`);
    }
  }
  return problems;
}

/** Recompute `requires` (parts + connection providers, holodeck#172) on a draft iso document, in place. */
export function withRequires(doc: HolodeckDocument<IsoSceneFile>, host: HolodeckHost): void {
  const requires = mergeRequires(host, doc.requires, documentRequires(host, doc.body, doc.connections));
  if (Object.keys(requires).length) doc.requires = requires;
  else delete doc.requires;
}
