/**
 * Input of the `/render` route: one document handed in by an automation host
 * (the MCP server's `scene_render`, packages/mcp/src/render.ts) as a window
 * global set before the app loads (Playwright `addInitScript`).
 *
 * Or, for `blender_preview`, one GLB model (`format: RENDER_MODEL_FORMAT`):
 * drawn as a data-only part at the origin of a one-object scene, so it gets
 * exactly the styling a library part gets (`applyHolodeckStyle`, default
 * theme). Its `url` must be a same-origin absolute path (the capture answers
 * it from memory); anything with a scheme or `//` host is refused.
 *
 * Not a URL or message API: the route never receives anything from another
 * page, and never reads or writes the document store.
 */

import type { HolodeckDocument, HolodeckHost } from '@holodeck/sdk';
import { parseDocumentValue } from '../documents/io';

export const RENDER_INPUT_GLOBAL = '__HOLODECK_RENDER__';
/** `format` of a model input (packages/mcp/src/render.ts RENDER_MODEL_FORMAT). */
export const RENDER_MODEL_FORMAT = 'holodeck.render-model.v1';
/** Largest footprint side (grid cells) and height (world units) a model input may claim. */
export const MAX_RENDER_MODEL_SIZE = 64;

export interface RenderModel {
  url: string;
  footprint: { w: number; h: number };
  height: number;
  label: string;
}

export type RenderInput =
  | { kind: 'missing' }
  | { kind: 'invalid'; problems: string[] }
  | { kind: 'ok'; document: HolodeckDocument }
  | { kind: 'model'; model: RenderModel };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_RENDER_MODEL_SIZE;

/** A model input, checked field by field; every problem listed. */
export function readRenderModel(raw: Record<string, unknown>): RenderInput {
  const problems: string[] = [];
  const url = raw.url;
  if (typeof url !== 'string' || !/^\/(?!\/)[A-Za-z0-9._~\/-]{1,512}$/.test(url) || url.split('/').includes('..')) {
    problems.push('url: must be a same-origin absolute path such as /__holodeck_mcp__/model.glb');
  }
  const fp = raw.footprint;
  if (!isRecord(fp) || !isSize(fp.w) || !isSize(fp.h)) problems.push(`footprint: {w, h} must be numbers in (0, ${MAX_RENDER_MODEL_SIZE}]`);
  if (!isSize(raw.height)) problems.push(`height: must be a number in (0, ${MAX_RENDER_MODEL_SIZE}]`);
  if (raw.label !== undefined && (typeof raw.label !== 'string' || raw.label.length > 200)) problems.push('label: at most 200 characters');
  if (problems.length) return { kind: 'invalid', problems };
  const footprint = fp as { w: number; h: number };
  return { kind: 'model', model: { url: url as string, footprint: { w: footprint.w, h: footprint.h }, height: raw.height as number, label: (raw.label as string | undefined) ?? 'Model' } };
}

/** Validate whatever the host put in `RENDER_INPUT_GLOBAL`, as a file import would. Never throws. */
export function readRenderInput(host: HolodeckHost, win: Record<string, unknown> = window as unknown as Record<string, unknown>): RenderInput {
  const raw = win[RENDER_INPUT_GLOBAL];
  if (raw === undefined || raw === null) return { kind: 'missing' };
  if (isRecord(raw) && raw.format === RENDER_MODEL_FORMAT) return readRenderModel(raw);
  const parsed = parseDocumentValue(raw, host);
  return parsed.ok ? { kind: 'ok', document: parsed.document } : { kind: 'invalid', problems: parsed.problems };
}
