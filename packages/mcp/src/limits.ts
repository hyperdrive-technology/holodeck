/**
 * Size bounds. Every tool input is capped by its zod schema and every output
 * by `MAX_RESULT_CHARS` (images: `MAX_IMAGE_BYTES`), so one call can never pull a huge file into the
 * model's context or make the server hold one in memory.
 */

import { MAX_IMPORT_BYTES } from './studio';

/** Largest document file read or written: the studio's own import limit (20 MB). */
export const MAX_DOCUMENT_BYTES = MAX_IMPORT_BYTES;
/** Longest text a tool returns (about 64k tokens). Bigger results ask the caller to narrow the request. */
export const MAX_RESULT_CHARS = 256 * 1024;
/**
 * Largest PNG returned inline by `scene_render`: 3 MiB, which is 4 MiB once
 * base64-encoded in the tool result. A busy 2048 x 2048 render can be several
 * MB; past this the caller gets `too_large` (or, with `out`, the file only).
 */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
/** Longest workspace-relative path accepted. */
export const MAX_PATH_LENGTH = 512;
/** Most objects one call may name (remove, get). */
export const MAX_IDS_PER_CALL = 500;
/** Most params one `scene_update_params` / `scene_add_object` call may set. */
export const MAX_PARAMS_PER_CALL = 64;
/** Longest id / part id / port / param name. */
export const MAX_NAME_LENGTH = 200;
/** Longest free-text string (document name, search query, binding source). */
export const MAX_TEXT_LENGTH = 4096;
/** Most parts `parts_list` returns in one page. */
export const MAX_PARTS_PAGE = 500;
/** Largest grid coordinate a tool accepts (the editor's own limit is larger; this keeps scenes sane). */
export const MAX_COORD = 10_000;
