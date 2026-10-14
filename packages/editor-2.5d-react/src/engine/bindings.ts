/**
 * Signal bindings on iso placements (contract: @holodeck/sdk docs/PACKAGING.md §6.2).
 *
 *   { "id": "t1", "object": "tank", "x": 0, "y": 0,
 *     "bindings": { "level": { "connection": "plant", "source": "sine:10",
 *                              "transform": { "kind": "scale", "inMin": 0, "inMax": 100, "outMin": 0, "outMax": 1 } } } }
 *
 * The engine only locates bindings and checks their shape. `source` belongs to
 * the provider and is never parsed here. Whether `connection` exists is a
 * document-level question (the body does not carry the document's
 * connections), answered by `validateBindings` in `loadIsoDocument`.
 *
 * Imports nothing from the editor so `iso/scene.ts` can use it without a cycle.
 */

import { validateTransform, type BindingRef, type SignalBinding } from '@holodeck/sdk';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Problems with one binding value; every message starts with `path`. Checks
 * exactly what `ProviderHub.setBindings` would reject, so a binding without
 * problems never makes the hub throw.
 */
export function isoBindingProblems(raw: unknown, path: string): string[] {
  if (!isRecord(raw)) return [`${path}: must be an object { connection, source, transform? }`];
  const errors: string[] = [];
  if (!isNonEmptyString(raw.connection)) errors.push(`${path}.connection: must be a non-empty string`);
  if (!isNonEmptyString(raw.source)) errors.push(`${path}.source: must be a non-empty string`);
  if (raw.transform !== undefined) errors.push(...validateTransform(raw.transform, `${path}.transform`));
  return errors;
}

/** Problems with a placement's `bindings` field; absent = no bindings = no problems. */
export function placementBindingProblems(placementId: unknown, bindings: unknown): string[] {
  if (bindings === undefined) return [];
  const at = `placement ${String(placementId)}`;
  if (!isRecord(bindings)) return [`${at}: bindings must be an object mapping param names to bindings`];
  const errors: string[] = [];
  // The hub keys values by objectId and param; empty ones cannot be addressed.
  if (!isNonEmptyString(placementId)) errors.push(`${at}: bindings need a non-empty placement id`);
  for (const [param, binding] of Object.entries(bindings)) {
    if (param === '') {
      errors.push(`${at}: bindings has an empty param name`);
      continue;
    }
    errors.push(...isoBindingProblems(binding, `${at}: bindings.${param}`));
  }
  return errors;
}

/** `body.objects` when it is an array, else `[]`. Tolerates any input. */
export function placementsOf(body: unknown): readonly unknown[] {
  return isRecord(body) && Array.isArray(body.objects) ? body.objects : [];
}

/**
 * Every binding in an iso body, in placement order then param order
 * (`objectId` = placement id). Tolerates unvalidated input: placements
 * without a string id and `bindings` that are not objects are skipped, but a
 * malformed binding *value* is passed through unchanged so `validateBindings`
 * can report it with its `objectId.param` path. Bodies from `loadIsoDocument`
 * or `parseSceneFile` only contain well-formed bindings.
 */
export function collectIsoBindings(body: unknown): BindingRef[] {
  const refs: BindingRef[] = [];
  for (const placement of placementsOf(body)) {
    if (!isRecord(placement) || typeof placement.id !== 'string' || !isRecord(placement.bindings)) continue;
    for (const [param, binding] of Object.entries(placement.bindings)) {
      refs.push({ objectId: placement.id, param, binding: binding as SignalBinding });
    }
  }
  return refs;
}
