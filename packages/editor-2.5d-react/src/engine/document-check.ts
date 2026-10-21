/**
 * `holodeck.document.check` contributions of the `holodeck.iso` package
 * (contract: @holodeck/sdk docs/PACKAGING.md §6.5).
 *
 * Why a check and not `isoEngine.validateBody`: the engine descriptor is
 * registered before any package is installed and `validateBody(body)` gets no
 * registry, so it can only check structure and bindings. A document check
 * receives the host's live registry (`ctx.registry`), so `host.checkDocument`
 * flags parts that no installed package provides, with the shared `isoEngine`
 * (holodeck#61). `createIsoEngine({ registry })` remains for hosts that want
 * the stricter `validateBody`; with both, an uninstalled part is reported
 * twice (once per mechanism).
 */

import { HOLODECK_KINDS, type Diagnostic, type DocumentCheck, type HolodeckDocument, type DocumentCheckContext } from '@holodeck/sdk';
import { placementsOf } from './bindings';
import { ISO_ENGINE_ID } from './iso-engine';

export const ISO_PARTS_INSTALLED_CHECK_ID = 'holodeck.iso.parts-installed';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * One `UNKNOWN_PART` error per placement whose `object` is not an installed
 * `holodeck.iso.part`. Malformed bodies and placements (no string id or
 * object) are skipped: `validateBody` reports those, so each problem is
 * reported once. Never throws on unvalidated input.
 */
function checkPartsInstalled(doc: HolodeckDocument, { registry }: DocumentCheckContext): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const placement of placementsOf(doc.body)) {
    if (!isRecord(placement) || !nonEmpty(placement.id) || !nonEmpty(placement.object)) continue;
    if (registry.get(HOLODECK_KINDS.isoPart, placement.object) !== undefined) continue;
    out.push({
      severity: 'error',
      code: 'UNKNOWN_PART',
      objectId: placement.id,
      message: `placement ${placement.id} uses part "${placement.object}", which no installed package provides`,
    });
  }
  return out;
}

/** Flags placements of parts that no installed package provides. */
export const ISO_PARTS_INSTALLED_CHECK: DocumentCheck = Object.freeze({
  id: ISO_PARTS_INSTALLED_CHECK_ID,
  label: 'Parts installed',
  description: 'Every placed part is provided by an installed package.',
  engines: [ISO_ENGINE_ID],
  check: checkPartsInstalled,
});
