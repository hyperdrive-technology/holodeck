import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { createElement, useMemo } from 'react';
import type { IsoMetrics, IsoPartDefinition, IsoPartTuning } from '../registry/types';
import { useIsoRegistry } from '../registry/react';
import { SceneObjectView } from './SceneObjectView';
import type { ObjectPointer } from './InstancedLibrary';
import { partitionByPart } from './partition-scene';
import { resolveAutoElbows } from '../routing/elbows';
import { mergeFittingParams } from '../../assets/process/fitting-params';
import { bendKeysOf, resolvePipeRuns } from './pipe-runs';
import type { IsoPlacement } from './scene';

/**
 * Unique meshes for most parts; `instanced` parts (pipes, elbows, valves,
 * caps) go to their definition's pool renderer (1024 per draw, then another
 * pool) unless `instanced` is false (tuner: unique meshes so fitting sliders
 * apply). `metrics` carries live param values by placement id.
 *
 * Elbows with `params.bend: "auto"` get their rotation from the pipes that
 * touch them here, once, before anything renders (routing/elbows.ts), so the
 * pools, unique meshes and pipe trimming all see the same numeric rotation.
 *
 * Pipe runs are resolved here too, once (pipe-runs.ts): bend trimming plus
 * the vessel-window clip (a pipe running into a cut-away window stops at the
 * wall with a cut-section end). Both the pooled `InstancedPipes` and the
 * unique-mesh pipe read the same `PipeRunSpec`, and fittings that would sit
 * inside a cut-away vessel are not drawn.
 */
export function SceneGraph({
  objects: authored,
  metrics,
  onObjectPointerDown,
  tankParams,
  fittings,
  instanced = true,
  selectedId,
  registry: registryProp,
}: {
  objects: readonly IsoPlacement[];
  metrics?: IsoMetrics;
  onObjectPointerDown?: ObjectPointer;
  tankParams?: IsoPartTuning['tankParams'];
  fittings?: IsoPartTuning['fittings'];
  instanced?: boolean;
  selectedId?: string | null;
  registry?: ContributionRegistry;
}) {
  const objects = useMemo(() => resolveAutoElbows(authored), [authored]);
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const bendKeys = useMemo(() => bendKeysOf(objects), [objects]);
  const pipeRadius = mergeFittingParams(fittings).pipeRadius;
  const { runs: pipeRuns, hiddenFittings } = useMemo(
    () => resolvePipeRuns(objects, registry, { pipeRadius }),
    [objects, registry, pipeRadius],
  );
  const drawn = hiddenFittings.size > 0 ? objects.filter((o) => !hiddenFittings.has(o.id)) : objects;
  const view = (object: IsoPlacement) => (
    <group
      key={object.id}
      onPointerDown={(event) => onObjectPointerDown?.(object.id, event)}
    >
      <SceneObjectView
        object={object}
        metrics={metrics}
        tankParams={tankParams}
        fittings={fittings}
        bendKeys={bendKeys}
        pipeRuns={pipeRuns}
        selected={object.id === selectedId}
        registry={registry}
      />
    </group>
  );
  if (!instanced) {
    return <group>{drawn.map(view)}</group>;
  }
  const { pools, unique } = partitionByPart(drawn, registry);
  return (
    <group>
      {Array.from(pools, ([partId, items]) => {
        const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
        return def?.instancedRenderer
          ? createElement(def.instancedRenderer, { key: partId, items, all: objects, pipeRuns, onObjectPointerDown })
          : null;
      })}
      {unique.map(view)}
    </group>
  );
}
