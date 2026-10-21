/**
 * Iso documents in the shared envelope (contract: @holodeck/sdk docs/PACKAGING.md §5).
 *
 *   { "format": "holodeck.document.v1", "id": "plant", "name": "Plant", "engine": "holodeck.iso",
 *     "engineVersion": "1.0.0", "theme": "...", "connections": [...], "body": <IsoSceneFile> }
 *
 * During M2 loaders accept both the envelope and a bare `IsoSceneFile` (the
 * format before envelopes, PACKAGING.md §10); a bare file is wrapped.
 */

import {
  HOLODECK_DOCUMENT_FORMAT,
  parseVersion,
  validateBindings,
  validateHolodeckDocument,
  type ContributionRegistry,
  type HolodeckDocument,
  type HolodeckDocumentMetadata,
  type ProviderConnection,
} from '@holodeck/sdk';
import type { IsoSceneFile } from '../iso/scene';
import { getDefaultIsoRegistry } from '../registry/default';
import { collectIsoBindings, isoBindingProblems } from './bindings';
import { ISO_ENGINE_API_VERSION, ISO_ENGINE_ID, checkIsoBody } from './iso-engine';

export type IsoDocument = HolodeckDocument<IsoSceneFile>;

export interface IsoDocumentOptions {
  /** Envelope id; default `scene.id`. */
  id?: string;
  /** Envelope name; default `scene.name`. */
  name?: string;
  connections?: ProviderConnection[];
  /** Packages whose parts the scene uses: package id -> version range. */
  requires?: Record<string, string>;
  metadata?: HolodeckDocumentMetadata;
  /** Envelope-level host bags. `scene.extensions` stays in the body. */
  extensions?: Record<string, unknown>;
}

export interface LoadedIsoDocument {
  /** The envelope, with `body === scene` and `theme === scene.theme`. */
  document: IsoDocument;
  /** The parsed body, ready for `ProcessEditor` / `connectIsoDocument`. */
  scene: IsoSceneFile;
}

/** Thrown by `loadIsoDocument`; `problems` lists every problem found. */
export class IsoDocumentError extends Error {
  constructor(public readonly problems: readonly string[]) {
    super(`invalid iso document:\n- ${problems.join('\n- ')}`);
    this.name = 'IsoDocumentError';
  }
}

/**
 * Wrap a scene in a `holodeck.document.v1` envelope for saving. Nothing is
 * copied: `body` is `scene`, and the options' objects are used as given.
 * `theme` mirrors `scene.theme` so hosts can read it without the body.
 */
export function toIsoDocument(scene: IsoSceneFile, options: IsoDocumentOptions = {}): IsoDocument {
  const id = options.id ?? scene.id;
  const document: IsoDocument = {
    format: HOLODECK_DOCUMENT_FORMAT,
    id,
    name: options.name ?? scene.name,
    engine: ISO_ENGINE_ID,
    engineVersion: ISO_ENGINE_API_VERSION,
    // The body carries the document's identity: ProcessEditor resets undo
    // history on `scene.id` (holodeck#20), so two documents must never share it.
    body: id === scene.id ? scene : { ...scene, id },
  };
  if (scene.theme !== undefined) document.theme = scene.theme;
  if (options.requires !== undefined) document.requires = options.requires;
  if (options.connections !== undefined) document.connections = options.connections;
  if (options.metadata !== undefined) document.metadata = options.metadata;
  if (options.extensions !== undefined) document.extensions = options.extensions;
  return document;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * An `IsoSceneFile` has none of these fields, so any of them means the input
 * is (meant to be) an envelope, and its problems are reported as envelope
 * problems rather than as "scene.objects must be an array".
 */
function looksLikeEnvelope(raw: Record<string, unknown>): boolean {
  return hasOwn(raw, 'format') || hasOwn(raw, 'engine') || hasOwn(raw, 'body');
}

/**
 * Load an iso document: a `holodeck.document.v1` envelope for `holodeck.iso`,
 * or a bare legacy `IsoSceneFile`, which is wrapped with `toIsoDocument`.
 *
 * Checks the envelope (`validateHolodeckDocument`), the engine and its major
 * version, the body (`parseSceneFile` against `registry`, default: the
 * built-in parts), and every binding against `document.connections`
 * (`validateBindings`). Throws one `IsoDocumentError` listing every problem.
 * Does not mutate `raw`.
 *
 * Envelope `theme` wins over `body.theme` (a host's theme picker edits the
 * envelope). A body without `id` / `name` takes the envelope's.
 */
export function loadIsoDocument(raw: unknown, registry: ContributionRegistry = getDefaultIsoRegistry()): LoadedIsoDocument {
  if (!isRecord(raw)) throw new IsoDocumentError(['document: must be an object']);
  try {
    return looksLikeEnvelope(raw) ? loadEnvelope(raw, registry) : loadBareScene(raw, registry);
  } catch (error) {
    if (error instanceof IsoDocumentError) throw error;
    // Hostile input (a throwing getter or Proxy) still surfaces as a document error.
    throw new IsoDocumentError([`document could not be read: ${messageOf(error)}`]);
  }
}

function loadEnvelope(raw: Record<string, unknown>, registry: ContributionRegistry): LoadedIsoDocument {
  const problems = validateHolodeckDocument(raw);
  if (typeof raw.engine === 'string' && raw.engine !== '' && raw.engine !== ISO_ENGINE_ID) {
    problems.push(`engine: "${raw.engine}" is not "${ISO_ENGINE_ID}"`);
  }
  const written = typeof raw.engineVersion === 'string' ? parseVersion(raw.engineVersion) : undefined;
  const supported = parseVersion(ISO_ENGINE_API_VERSION);
  // A newer minor only adds optional fields, which this engine ignores; a
  // different major may mean something else entirely.
  if (written && supported && written.major !== supported.major) {
    problems.push(`engineVersion: ${raw.engineVersion} needs ${ISO_ENGINE_ID} ^${written.major}, this engine is ${ISO_ENGINE_API_VERSION}`);
  }
  // `body` missing is already reported by validateHolodeckDocument.
  const body = hasOwn(raw, 'body') && raw.body !== undefined ? checkBody(raw.body, raw.connections, registry, 'body: ') : undefined;
  if (body) problems.push(...body.problems);
  if (problems.length || !body?.scene) throw new IsoDocumentError(problems);

  const scene: IsoSceneFile = { ...body.scene };
  if (typeof raw.theme === 'string') scene.theme = raw.theme;
  // The envelope id is the document identity. ProcessEditor resets undo/redo
  // when `scene.id` changes (holodeck#20), so a body id that disagrees (two
  // documents saved from one scene) must not leak through: undo would cross
  // documents.
  scene.id = raw.id as string;
  if (scene.name === undefined) scene.name = raw.name as string;
  const document = { ...raw, body: scene } as unknown as IsoDocument;
  if (scene.theme !== undefined) document.theme = scene.theme;
  return { document, scene };
}

/**
 * Decision (holodeck#61): a bare scene that carries bindings is rejected, not
 * loaded with unresolved bindings. A bare file has no `connections`, so every
 * binding in it is dangling, the same case as an envelope whose bindings name
 * a missing connection (also rejected). Bindings postdate envelopes, so such a
 * file can only come from code that should have saved an envelope; the
 * problem list says how to fix it. Revisit if a real producer of bare files
 * with bindings appears.
 */
function loadBareScene(raw: Record<string, unknown>, registry: ContributionRegistry): LoadedIsoDocument {
  const body = checkBody(raw, undefined, registry, '');
  const problems = [...body.problems];
  if (body.unknownConnections) {
    problems.push('a bare scene file has no connections: save it with toIsoDocument(scene, { connections })');
  }
  if (!body.scene) throw new IsoDocumentError(problems);
  const document = toIsoDocument(body.scene);
  // A legacy file can lack what the envelope needs (a non-empty id, say).
  problems.push(...validateHolodeckDocument(document));
  if (problems.length) throw new IsoDocumentError(problems);
  return { document, scene: body.scene };
}

/**
 * Body problems plus bindings that name a connection the document lacks.
 * Bindings with shape problems are left to `checkIsoBody`, so each problem is
 * reported once; connections are checked even when the body is otherwise
 * broken, so one load lists everything.
 */
function checkBody(
  body: unknown,
  rawConnections: unknown,
  registry: ContributionRegistry,
  prefix: string,
): { problems: string[]; scene?: IsoSceneFile; unknownConnections: boolean } {
  const { problems, scene } = checkIsoBody(body, registry);
  const out = problems.map((p) => `${prefix}${p}`);
  // A malformed `connections` is an envelope problem (already reported); skip the cross-check then.
  const connections = rawConnections === undefined ? [] : Array.isArray(rawConnections) ? rawConnections.filter(isRecord) : undefined;
  let unknownConnections = false;
  if (connections) {
    const wellFormed = collectIsoBindings(body).filter((ref) => ref.objectId !== '' && ref.param !== '' && isoBindingProblems(ref.binding, '').length === 0);
    const missing = validateBindings({ connections: connections as unknown as ProviderConnection[] }, wellFormed);
    unknownConnections = missing.length > 0;
    out.push(...missing.map((p) => `${prefix}${p}`));
  }
  return { problems: out, scene: out.length ? undefined : scene, unknownConnections };
}
