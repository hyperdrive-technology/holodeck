import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { createElement } from 'react';
import type { IsoMetrics, IsoPartDefinition, IsoPartTuning } from '../registry/types';
import { useIsoRegistry } from '../registry/react';
import { SceneObjectView } from './SceneObjectView';
import type { ObjectPointer } from './InstancedLibrary';
import { partitionByPart } from './partition-scene';
import type { IsoPlacement } from './scene';

/**
 * Unique meshes for most parts; `instanced` parts (pipes, elbows, valves,
 * caps) go to their definition's pool renderer (1024 per draw, then another
 * pool) unless `instanced` is false (tuner: unique meshes so fitting sliders
 * apply). `metrics` carries live param values by placement id.
 */
export function SceneGraph({
  objects,
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
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const bendKeys = new Set(
    objects.filter((o) => o.object === 'elbow' && o.rotation != null).map((o) => `${o.x},${o.y}`),
  );
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
        selected={object.id === selectedId}
        registry={registry}
      />
    </group>
  );
  if (!instanced) {
    return <group>{objects.map(view)}</group>;
  }
  const { pools, unique } = partitionByPart(objects, registry);
  return (
    <group>
      {Array.from(pools, ([partId, items]) => {
        const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, partId);
        return def?.instancedRenderer
          ? createElement(def.instancedRenderer, { key: partId, items, all: objects, onObjectPointerDown })
          : null;
      })}
      {unique.map(view)}
    </group>
  );
}
