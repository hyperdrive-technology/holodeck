/**
 * The part library as an agent sees it: the studio's library model
 * (`libraryItems` / `matchesQuery`, same search as the sidebar) plus the full
 * contract of one part (params with their ranges, ports, anim nodes,
 * footprint), which is what an agent needs to place, configure and connect it.
 */

import { HOLODECK_KINDS, type HolodeckHost } from '@holodeck/sdk';
import type { IsoPartDefinition, IsoPartParamSpec } from '@holodeck/editor-2.5d-react';
import { ToolError } from './errors';
import { libraryItems, matchesQuery, type LibraryItem } from './studio';

export interface PartSummary {
  id: string;
  label: string;
  category: string;
  package: string;
  hint?: string;
}

export interface PartDetail extends PartSummary {
  packageName: string;
  /** Grid cells at rotation 0. */
  footprint: { w: number; h: number };
  /** `run`: drawn click-click as a pipe run (`scene_connect`, or `scene_add_object` with `to`). */
  draw?: 'run';
  /** Floor annotation (area, label, connector...): never an obstacle for routing. */
  floor: boolean;
  /** Placeable from a scene file but hidden from the palette. */
  hidden: boolean;
  /** Pipe connection points: offset from the part centre (rotation 0) and the outward direction. */
  ports: Record<string, { x: number; y: number; dir: string }>;
  params: Record<string, ParamSummary>;
  /** param -> animated node in the model and the animator driving it. */
  animNodes: Record<string, { node: string; animator: string }>;
  /** What a new placement starts with (beyond params' own defaults). */
  defaults?: Record<string, unknown>;
  hasModel: boolean;
}

export type ParamSummary = Pick<IsoPartParamSpec, 'type' | 'label' | 'default'> &
  Partial<Pick<IsoPartParamSpec, 'min' | 'max' | 'step' | 'unit' | 'options' | 'hidden' | 'maxLength' | 'reading'>>;

const PARAM_KEYS = ['min', 'max', 'step', 'unit', 'options', 'hidden', 'maxLength', 'reading'] as const;

function summary(item: LibraryItem): PartSummary {
  const out: PartSummary = { id: item.id, label: item.label, category: item.category, package: item.packageId };
  if (item.hint !== undefined) out.hint = item.hint;
  return out;
}

export interface PartQuery {
  query?: string;
  category?: string;
  package?: string;
  limit: number;
  offset: number;
}

export function listParts(host: HolodeckHost, q: PartQuery): { total: number; parts: PartSummary[]; categories: string[] } {
  const all = libraryItems(host);
  const matching = all.filter(
    (item) =>
      matchesQuery(item, q.query ?? '') &&
      (q.category === undefined || item.category.toLowerCase() === q.category.toLowerCase()) &&
      (q.package === undefined || item.packageId === q.package),
  );
  return {
    total: matching.length,
    parts: matching.slice(q.offset, q.offset + q.limit).map(summary),
    categories: [...new Set(all.map((i) => i.category))],
  };
}

/** JSON-safe copy (part defaults may hold functions or class instances in theory; drop them). */
function plain(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'function' ? undefined : v)));
}

/** Up to 8 part ids that share a word with `id` (`tanks` -> tank, `cloud server` -> cloud:server). */
export function similarParts(host: HolodeckHost, id: string): string[] {
  const words = id.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const stems = words.map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
  return libraryItems(host)
    .filter((item) => {
      const hay = `${item.id} ${item.label}`.toLowerCase();
      return stems.some((s) => hay.includes(s)) || hay.split(/[^a-z0-9]+/).some((w) => w.length >= 3 && words.some((x) => x.includes(w)));
    })
    .slice(0, 8)
    .map((item) => item.id);
}

export function partDetail(host: HolodeckHost, id: string): PartDetail {
  const def = host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, id);
  if (!def) {
    const near = similarParts(host, id);
    throw new ToolError(`no part "${id}" is installed`, near.length ? [`similar: ${near.join(', ')}`] : ['parts_list shows the installed parts'], 'not_found');
  }
  const packageId = host.registry.ownerOf(HOLODECK_KINDS.isoPart, id) ?? 'unknown';
  const params: Record<string, ParamSummary> = {};
  for (const [name, spec] of Object.entries(def.params ?? {})) {
    const p: ParamSummary = { type: spec.type, label: spec.label, default: plain(spec.default) };
    for (const key of PARAM_KEYS) if (spec[key] !== undefined) (p as Record<string, unknown>)[key] = plain(spec[key]);
    params[name] = p;
  }
  const detail: PartDetail = {
    id: def.id,
    label: def.label,
    category: def.category ?? 'Other',
    package: packageId,
    packageName: host.package(packageId)?.manifest.name ?? packageId,
    footprint: { ...def.footprint },
    floor: def.floor === true,
    hidden: def.hideInPalette === true,
    ports: Object.fromEntries(Object.entries(def.ports ?? {}).map(([name, port]) => [name, { x: port.x, y: port.y, dir: port.dir }])),
    params,
    animNodes: Object.fromEntries(Object.entries(def.animNodes ?? {}).map(([param, n]) => [param, { node: n.node, animator: n.animator }])),
    hasModel: typeof def.model === 'string',
  };
  if (def.hint !== undefined) detail.hint = def.hint;
  if (def.draw) detail.draw = def.draw;
  if (def.defaults && Object.keys(def.defaults).length) detail.defaults = plain(def.defaults) as Record<string, unknown>;
  return detail;
}
