/**
 * Pure helpers over `holodeck.document.v1` envelopes. The envelope is engine
 * neutral, but an iso body repeats the document's `id` and `name`
 * (`IsoSceneFile.id` / `.name`), and the iso editor keys undo history on
 * `body.id` (holodeck#20). These helpers keep the two in step for any body
 * that carries them, without importing an engine.
 */

import { HOLODECK_DOCUMENT_FORMAT, type HolodeckDocument } from '@holodeck/sdk';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function withBodyField(body: unknown, field: 'id' | 'name', value: string): unknown {
  if (!isRecord(body) || typeof body[field] !== 'string' || body[field] === value) return body;
  return { ...body, [field]: value };
}

/** A copy with a new id; a body that carries an `id` string gets it too. */
export function withDocumentId<D extends HolodeckDocument>(doc: D, id: string): D {
  return { ...doc, id, body: withBodyField(doc.body, 'id', id) };
}

/** A copy with a new name; a body that carries a `name` string gets it too. */
export function withDocumentName<D extends HolodeckDocument>(doc: D, name: string): D {
  return { ...doc, name, body: withBodyField(doc.body, 'name', name) };
}

/** Sets `metadata.created` (if absent) and `metadata.updated` to `at`. */
export function stampDocument<D extends HolodeckDocument>(doc: D, at: Date): D {
  const iso = at.toISOString();
  return { ...doc, metadata: { ...doc.metadata, created: doc.metadata?.created ?? iso, updated: iso } };
}

/** Is this an envelope at all (as opposed to a bare engine body)? */
export function isEnvelope(raw: unknown): raw is HolodeckDocument {
  return isRecord(raw) && raw.format === HOLODECK_DOCUMENT_FORMAT;
}

/** A metadata timestamp must be a string `Date` can parse; anything else would break date formatting. */
export function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value));
}

/** Problems the SDK envelope check does not catch: unparsable `metadata.created` / `updated`. */
export function metadataProblems(doc: Pick<HolodeckDocument, 'metadata'>): string[] {
  const problems: string[] = [];
  for (const key of ['created', 'updated'] as const) {
    const value = doc.metadata?.[key];
    if (value !== undefined && !isValidTimestamp(value)) problems.push(`metadata.${key}: must be an ISO date, got ${JSON.stringify(value)}`);
  }
  return problems;
}
