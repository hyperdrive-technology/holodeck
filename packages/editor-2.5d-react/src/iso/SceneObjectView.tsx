import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { useHolodeckStyle } from '../../assets/process/style-context';
import type { IsoMetrics, IsoPartDefinition, IsoPartTuning } from '../registry/types';
import { resolveParams } from '../registry/params';
import { useIsoRegistry } from '../registry/react';
import type { IsoPlacement } from './scene';
import { DataPart } from '../registry/DataPart';
import { Appearance } from '../objects/AppearanceGroup';
import { needsAppearance } from '../objects/appearance';
import { MetaPlane } from '../objects/Marks';
import { rotatedFootprint } from '../routing/occupancy';
import { gridToWorld } from './grid';

/**
 * One placement as a React subtree: look the part up in the registry,
 * resolve its params (metrics > placement.params > spec defaults) and hand
 * both to the part's component. Unknown parts render nothing (a pack may be
 * uninstalled while a scene still names it); `parseSceneFile` is where they
 * are rejected.
 *
 * Around the part: definitions without a `component` are data-only and render
 * through `DataPart`; `opacity < 1` / non-zero `z` wrap the part in
 * `Appearance`; a non-empty `meta` (unless `metaHidden`) adds the metadata
 * plane in front of the footprint.
 */
export function SceneObjectView({
  object,
  metrics,
  tankParams,
  fittings,
  bendKeys,
  pipeRuns,
  connectorPaths,
  selected = false,
  registry: registryProp,
}: {
  object: IsoPlacement;
  /** Live values for the whole scene; this view reads `metrics[object.id]`. */
  metrics?: IsoMetrics;
  tankParams?: IsoPartTuning['tankParams'];
  fittings?: IsoPartTuning['fittings'];
  /** Grid cells that have a 90° elbow, so unique-mesh pipes trim like InstancedPipes. */
  bendKeys?: ReadonlySet<string>;
  /** Resolved pipe runs (SceneGraph, pipe-runs.ts): bend + vessel-window clipping. */
  pipeRuns?: IsoPartTuning['pipeRuns'];
  /** Resolved connector paths (SceneGraph, objects/connector.ts). */
  connectorPaths?: IsoPartTuning['connectorPaths'];
  selected?: boolean;
  registry?: ContributionRegistry;
}) {
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const style = useHolodeckStyle();
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, object.object);
  if (!def) return null;
  const Part = def.component ?? DataPart;
  const part = (
    <Part
      placement={object}
      params={resolveParams(def, object, metrics)}
      style={style}
      selected={selected}
      def={def}
      tuning={{ tankParams, fittings, bendKeys, pipeRuns, connectorPaths }}
    />
  );
  const meta = object.meta && !object.metaHidden && Object.keys(object.meta).length > 0 ? object.meta : null;
  let metaPlane = null;
  if (meta) {
    const [wx, , wz] = gridToWorld(object.x, object.y);
    const { h } = rotatedFootprint(def, object.rotation, object);
    metaPlane = <MetaPlane x={wx} z={wz} depth={h} meta={meta} style={style} />;
  }
  if (!needsAppearance(object)) {
    return metaPlane ? <>{part}{metaPlane}</> : part;
  }
  return (
    <Appearance opacity={object.opacity ?? 1} z={object.z ?? 0}>
      {part}
      {metaPlane}
    </Appearance>
  );
}
