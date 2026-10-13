import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { useHolodeckStyle } from '../../assets/process/style-context';
import type { IsoMetrics, IsoPartDefinition, IsoPartTuning } from '../registry/types';
import { resolveParams } from '../registry/params';
import { useIsoRegistry } from '../registry/react';
import type { IsoPlacement } from './scene';

/**
 * One placement as a React subtree: look the part up in the registry,
 * resolve its params (metrics > placement.params > spec defaults) and hand
 * both to the part's component. Unknown parts render nothing (a pack may be
 * uninstalled while a scene still names it); `parseSceneFile` is where they
 * are rejected.
 */
export function SceneObjectView({
  object,
  metrics,
  tankParams,
  fittings,
  bendKeys,
  pipeRuns,
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
  selected?: boolean;
  registry?: ContributionRegistry;
}) {
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const style = useHolodeckStyle();
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, object.object);
  if (!def) return null;
  const Part = def.component;
  return (
    <Part
      placement={object}
      params={resolveParams(def, object, metrics)}
      style={style}
      selected={selected}
      def={def}
      tuning={{ tankParams, fittings, bendKeys, pipeRuns }}
    />
  );
}
