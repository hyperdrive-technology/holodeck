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

// --- Blender part builds (blender_* / part_*) --------------------------------

/** Longest part name (`blender/parts/<name>.py`, `assets/models/<name>.glb`). */
export const MAX_PART_NAME_LENGTH = 48;
/** Largest part script `blender_build_part` writes: 256 KiB (the biggest shipped part is ~12 KiB). */
export const MAX_PART_SOURCE_BYTES = 256 * 1024;
/** Largest GLB read or installed: 16 MiB (shipped parts are ~50 KB). */
export const MAX_PART_GLB_BYTES = 16 * 1024 * 1024;
/** Default triangle budget of `part_validate` (shipped parts: 520-840). */
export const DEFAULT_PART_TRIANGLES = 5_000;
/** Highest triangle budget a caller may ask for. */
export const MAX_PART_TRIANGLES = 100_000;
/** Default wall-clock limit of one Blender run (a part builds in a few seconds). */
export const DEFAULT_BLENDER_TIMEOUT_MS = 120_000;
/** Bounds a caller may set on that limit. */
export const MIN_BLENDER_TIMEOUT_MS = 5_000;
export const MAX_BLENDER_TIMEOUT_MS = 600_000;
/** Blender output kept in memory per run (the tail; older output is dropped). */
export const MAX_BLENDER_LOG_BYTES = 64 * 1024;
/** Lines of that tail a tool result carries. */
export const MAX_BLENDER_LOG_LINES = 60;
