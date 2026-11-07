/**
 * Documents on disk: read, validate and write `holodeck.document.v1` files
 * through the studio's own import path (`parseDocumentText`: envelope shape,
 * metadata, engine + `requires`, body against the host registry, credential
 * rules). A file that does not pass is never edited, and an edit that would
 * not pass is never written.
 */

import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import { ISO_ENGINE_ID, type IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { ToolError } from './errors';
import { checkHostDocument, metadataProblems, parseDocumentText, serializeDocument, stampDocument, withRequires } from './studio';
import { etagOf, type Workspace } from './workspace';

export type IsoDoc = HolodeckDocument<IsoSceneFile>;

export interface LoadedDocument {
  path: string;
  etag: string;
  /** The validated, normalised document (what the studio would store). */
  document: IsoDoc;
  /** The file held a bare legacy scene, wrapped on load; the next save writes an envelope. */
  wrapped: boolean;
}

export class DocumentStore {
  constructor(
    readonly workspace: Workspace,
    readonly host: HolodeckHost,
    /** Clock for `metadata.updated` (tests pin it). */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Read and validate `path`. Throws a ToolError listing every problem. */
  async load(path: string): Promise<LoadedDocument> {
    const file = await this.workspace.read(path);
    const parsed = parseDocumentText(file.text, this.host);
    if (!parsed.ok) throw new ToolError(`${file.path} is not a valid Holodeck document`, parsed.problems, 'invalid_document');
    if (parsed.document.engine !== ISO_ENGINE_ID) {
      throw new ToolError(`${file.path} uses engine "${parsed.document.engine}"; these tools edit "${ISO_ENGINE_ID}" documents`, [], 'unsupported_engine');
    }
    return { path: file.path, etag: file.etag, document: parsed.document as IsoDoc, wrapped: parsed.wrapped };
  }

  /** Problems with a document value (as `scene_validate` reports them); empty when it would load. */
  validateText(text: string): string[] {
    const parsed = parseDocumentText(text, this.host);
    return parsed.ok ? [] : parsed.problems;
  }

  /**
   * Validate `doc` as the studio does on save (`requires` recomputed,
   * `metadata.updated` stamped, host checks), then write it. `expect`: the
   * etag the edit was based on, or `null` for a new file.
   */
  async save(path: string, doc: IsoDoc, expect: string | null | undefined): Promise<LoadedDocument> {
    const draft = stampDocument(structuredClone(doc), this.now());
    withRequires(draft, this.host);
    const checked = checkHostDocument(this.host, draft);
    const problems = [...metadataProblems(draft), ...checked.problems];
    if (problems.length || !checked.document) throw new ToolError('the edit would make the document invalid; nothing was written', problems, 'invalid_edit');
    const normalised = checked.document as IsoDoc;
    const file = await this.workspace.write(path, serializeDocument(normalised), expect);
    return { path: file.path, etag: file.etag, document: normalised, wrapped: false };
  }
}

export { etagOf };
