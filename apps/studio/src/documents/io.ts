/**
 * File import / export of `holodeck.document.v1` envelopes.
 *
 * Import accepts an envelope for any engine the host has, or a bare legacy
 * `IsoSceneFile` (PACKAGING.md §10: loaders accept both during M2), which is
 * wrapped. Everything is validated before it reaches the store, and every
 * problem is listed at once so a user can fix a file in one pass.
 */

import { validateHolodeckDocument, type HolodeckDocument, type HolodeckHost } from '@holodeck/sdk';
import { IsoDocumentError, loadIsoDocument } from '@holodeck/editor-2.5d-react';
import { hostDocumentProblems } from '../host/studio-host';
import { isEnvelope } from './document-ops';

/** Larger files are refused before parsing; a document this size is almost certainly not one. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export type ImportResult =
  | { ok: true; document: HolodeckDocument; /** A bare scene file was wrapped in an envelope. */ wrapped: boolean }
  | { ok: false; problems: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Parse and validate file text against `host`. Never throws. */
export function parseDocumentText(text: string, host: HolodeckHost): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, problems: [`file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB`] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: [`not valid JSON: ${messageOf(error)}`] };
  }
  return parseDocumentValue(raw, host);
}

/** Validate an already-parsed value against `host`. Never throws. */
export function parseDocumentValue(raw: unknown, host: HolodeckHost): ImportResult {
  if (!isRecord(raw)) return { ok: false, problems: ['document: must be a JSON object'] };
  // Any envelope field means the file is (meant to be) an envelope: report
  // envelope problems instead of "objects must be an array".
  const envelopeLike = isEnvelope(raw) || hasOwn(raw, 'format') || hasOwn(raw, 'engine') || hasOwn(raw, 'body');
  if (!envelopeLike) return wrapBareScene(raw, host);
  const shape = validateHolodeckDocument(raw);
  if (shape.length) return { ok: false, problems: shape };
  const document = raw as unknown as HolodeckDocument;
  const problems = hostDocumentProblems(host, document);
  return problems.length ? { ok: false, problems } : { ok: true, document, wrapped: false };
}

function wrapBareScene(raw: Record<string, unknown>, host: HolodeckHost): ImportResult {
  try {
    const { document } = loadIsoDocument(raw, host.registry);
    return { ok: true, document: document as HolodeckDocument, wrapped: true };
  } catch (error) {
    return { ok: false, problems: error instanceof IsoDocumentError ? [...error.problems] : [messageOf(error)] };
  }
}

/** Pretty JSON with a trailing newline: diff-friendly, and what `parseDocumentText` reads back. */
export function serializeDocument(doc: HolodeckDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export const DOCUMENT_FILE_SUFFIX = '.holodeck.json';

/** `My Plant #2` -> `my-plant-2.holodeck.json`; falls back to the id, then `document`. */
export function exportFileName(doc: Pick<HolodeckDocument, 'name' | 'id'>): string {
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
  return `${slug(doc.name) || slug(doc.id) || 'document'}${DOCUMENT_FILE_SUFFIX}`;
}
