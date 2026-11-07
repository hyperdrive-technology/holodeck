/**
 * Input of the `/render` route: one document handed in by an automation host
 * (the MCP server's `scene_render`, packages/mcp/src/render.ts) as a window
 * global set before the app loads (Playwright `addInitScript`).
 *
 * Not a URL or message API: the route never receives anything from another
 * page, and never reads or writes the document store.
 */

import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import { parseDocumentValue } from '../documents/io';

export const RENDER_INPUT_GLOBAL = '__HOLODECK_RENDER__';

export type RenderInput =
  | { kind: 'missing' }
  | { kind: 'invalid'; problems: string[] }
  | { kind: 'ok'; document: HolodeckDocument };

/** Validate whatever the host put in `RENDER_INPUT_GLOBAL`, as a file import would. Never throws. */
export function readRenderInput(host: HolodeckHost, win: Record<string, unknown> = window as unknown as Record<string, unknown>): RenderInput {
  const raw = win[RENDER_INPUT_GLOBAL];
  if (raw === undefined || raw === null) return { kind: 'missing' };
  const parsed = parseDocumentValue(raw, host);
  return parsed.ok ? { kind: 'ok', document: parsed.document } : { kind: 'invalid', problems: parsed.problems };
}
