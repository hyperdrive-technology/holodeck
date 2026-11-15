/**
 * The process-parts sample (`samples/process-line.holodeck.json`): the
 * `@holodeck/library-process` pilot parts in a small line, all driven by the
 * secret-free `holodeck.sim` connection.
 *
 *   feed tank -> ball valve XV-101 -> control valve TV-101 -> elbow ->
 *   shell-and-tube exchanger E-101 (tube-in), with motor M-101, transmitter
 *   TT-101 and control cabinet MCC-1 standing on the floor.
 *
 * Geometry notes (pinned by process-line.test.ts):
 * - The two valves sit ON `feed-pipe` (`onPipe`), unrotated, so their local
 *   X (the authored pipe axis) runs along the pipe; `origin: 'pipe-axis'`
 *   lifts them to the pipe height.
 * - E-101's `tube-in` nozzle is at local (-1.10, 0.32, +0.50), off the grid,
 *   so the package declares no grid port for it yet. The exchanger is placed
 *   at x = 9.1 so that nozzle lands on grid x = 8, and `exchanger-pipe` ends
 *   exactly on the flange face (y = -3 + 0.5). Once the asset lane moves the
 *   nozzle onto the grid (docs/assets/process-catalog.md, Package), place
 *   E-101 on a whole cell and attach the pipe to the port instead.
 */
import type { HolodeckDocument } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import sample from '../../samples/process-line.holodeck.json';
import { withDocumentId, withDocumentName } from '../documents/document-ops';
import { newDocumentId } from '../documents/new-document';

export const PROCESS_LINE_SAMPLE_NAME = 'Process line';

/** Independent copy: edits and repeated creation must never mutate the bundled sample. */
export function createProcessLineDocument(id = newDocumentId()): HolodeckDocument<IsoSceneFile> {
  return withDocumentId(structuredClone(sample) as HolodeckDocument<IsoSceneFile>, id);
}

/** The sample as the playground's one document (its fixed id and name). */
export function createProcessLinePlayground(id: string, name: string): HolodeckDocument<IsoSceneFile> {
  return withDocumentName(createProcessLineDocument(id), name);
}
