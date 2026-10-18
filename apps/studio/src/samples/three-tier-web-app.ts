import type { HolodeckDocument } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import sample from '../../samples/three-tier-web-app.holodeck.json';
import { withDocumentId } from '../documents/document-ops';
import { newDocumentId } from '../documents/new-document';

/** Independent copy: edits and repeated creation must never mutate the bundled sample. */
export function createSampleDocument(id = newDocumentId()): HolodeckDocument<IsoSceneFile> {
  return withDocumentId(structuredClone(sample) as HolodeckDocument<IsoSceneFile>, id);
}
