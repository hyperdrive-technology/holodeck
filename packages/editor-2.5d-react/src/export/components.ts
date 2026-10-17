/**
 * "Components" table of an iso scene: one row per placement, for CSV export
 * (Arcentry's component list; holodeck#42). Pure: no React, no three.
 *
 * Fixed columns first, then one `meta:<key>` column per metadata key used
 * anywhere in the scene (sorted), so a spreadsheet can filter on them.
 * Nested values (params, bindings) are compact JSON in one cell.
 */

import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoSceneFile } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { sceneLayers, layerIdOf } from '../editor/layers';
import { toCsv, CSV_UTF8_BOM, type CsvCell } from './csv';

export const COMPONENT_COLUMNS = [
  'id',
  'part',
  'label',
  'category',
  'package',
  'layer',
  'group',
  'x',
  'y',
  'rotation',
  'toX',
  'toY',
  'onPipe',
  'opacity',
  'params',
  'bindings',
] as const;

export interface ComponentTable {
  header: string[];
  rows: CsvCell[][];
}

const json = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return undefined;
  return JSON.stringify(v);
};

/**
 * The scene's placements as a table. `registry` resolves part labels,
 * categories and owning packages; without it (or for an unknown part) those
 * cells are empty and the row is still written.
 */
export function isoComponentTable(scene: Pick<IsoSceneFile, 'objects' | 'layers'>, registry?: ContributionRegistry): ComponentTable {
  const layerNames = new Map(sceneLayers(scene).map((l) => [l.id, l.name]));
  const metaKeys = [...new Set(scene.objects.flatMap((o) => Object.keys(o.meta ?? {})))].sort();
  const header = [...COMPONENT_COLUMNS, ...metaKeys.map((k) => `meta:${k}`)];
  const rows = scene.objects.map((o): CsvCell[] => {
    const def = registry?.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object);
    return [
      o.id,
      o.object,
      def?.label,
      def?.category,
      registry?.ownerOf(HOLODECK_KINDS.isoPart, o.object),
      layerNames.get(layerIdOf(scene, o)),
      o.group,
      o.x,
      o.y,
      o.rotation,
      o.toX,
      o.toY,
      o.onPipe,
      o.opacity,
      json(o.params),
      json(o.bindings),
      ...metaKeys.map((k) => o.meta?.[k]),
    ];
  });
  return { header, rows };
}

/** The components table as a CSV file body (UTF-8 BOM for Excel, CRLF rows, formula-safe cells). */
export function isoComponentsCsv(scene: Pick<IsoSceneFile, 'objects' | 'layers'>, registry?: ContributionRegistry): string {
  const { header, rows } = isoComponentTable(scene, registry);
  return CSV_UTF8_BOM + toCsv(header, rows);
}
