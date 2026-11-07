/**
 * The studio modules this server shares, bundled from `apps/studio/src` at
 * build time (tsup) and resolved through the path map in tsconfig.json /
 * vitest.config.ts.
 *
 * Why not a copy: a document this server writes must pass exactly the checks
 * the studio runs when it saves, imports or embeds one (host + engine
 * validation, credential rules, `requires` bookkeeping), and the starter
 * scene must be the playground's. Every module listed here is pure TypeScript
 * over published packages (no React, no `?url` assets, no browser globals);
 * `document-checks.ts` says so in its header, and the build fails if one of
 * them grows a bundler-only import. CI runs this package when any of these
 * folders change (scripts/ci-scope.mjs patterns in .github/workflows/ci.yml).
 */

export {
  bindingSourceProblems,
  checkHostDocument,
  createHost,
  documentRequires,
  mergeRequires,
  withRequires,
  type StudioPackage,
} from '../../../apps/studio/src/host/document-checks';
export { PROVIDER_PACKAGES } from '../../../apps/studio/src/host/provider-packages';
export { groupLibrary, libraryItems, matchesQuery, type LibraryItem } from '../../../apps/studio/src/host/library';
export { libraryDropPoint } from '../../../apps/studio/src/documents/iso-scene';
export { MAX_IMPORT_BYTES, parseDocumentText, parseDocumentValue, serializeDocument } from '../../../apps/studio/src/documents/io';
export { metadataProblems, stampDocument, withDocumentId, withDocumentName } from '../../../apps/studio/src/documents/document-ops';
export { createIsoDocument, DEFAULT_DOCUMENT_NAME } from '../../../apps/studio/src/documents/new-document';
export { createPlaygroundDocument, PLAYGROUND_CONNECTION_ID } from '../../../apps/studio/src/playground/starter';
export { connectionConfigProblems, credentialInText } from '../../../apps/studio/src/connections/credentials';
