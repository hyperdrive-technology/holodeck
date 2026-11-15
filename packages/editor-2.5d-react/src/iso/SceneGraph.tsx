import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { createElement, useMemo, useRef } from 'react';
import type { IsoMetrics, IsoPartDefinition, IsoPartTuning } from '../registry/types';
import { useIsoRegistry } from '../registry/react';
import { SceneObjectView } from './SceneObjectView';
import type { ObjectPointer } from './InstancedLibrary';
import { partitionByPart } from './partition-scene';
import { resolveAutoElbows } from '../routing/elbows';
import { mergeFittingParams } from '../../assets/process/fitting-params';
import { Riser } from '../../assets/process/Riser';
import { bendKeysOf, resolvePipeRuns } from './pipe-runs';
import { riserAppearance } from '../routing/vessel-risers';
import { Appearance } from '../objects/AppearanceGroup';
import { needsAppearance } from '../objects/appearance';
import type { IsoPlacement } from './scene';
import { connectorRouteKey, liveConnectorObjects, resolveConnectorPaths } from '../objects/connector';

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
 * inside a cut-away vessel are not drawn. Runs that end at a raised vessel
 * (on legs / a skirt) are trimmed to a riser that climbs to a side nozzle or
 * the bottom outlet (routing/vessel-risers.ts); the risers are drawn here,
 * after the parts, and a click on one selects the first pipe that feeds it.
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
  const { runs: pipeRuns, hiddenFittings, risers } = useMemo(
    () => resolvePipeRuns(objects, registry, { pipeRadius }),
    [objects, registry, pipeRadius],
  );
  // Live `route` values (metrics) change connector paths (holodeck#107). The key
  // keeps the memo from re-routing on every metrics tick that leaves routes alone.
  const routeKey = connectorRouteKey(objects, metrics, registry);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const connectorPaths = useMemo(
    () => resolveConnectorPaths(
      liveConnectorObjects(objects, metricsRef.current, registry),
      registry,
      (o) => registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object)?.connector === true,
    ),
    // routeKey stands in for metrics (read through the ref) on purpose.
    [objects, registry, routeKey],
  );
  const byId = new Map(objects.map((o) => [o.id, o]));
  // A riser fades / orders with the pipes that feed it (riserAppearance); fully invisible runs draw no riser.
  const riserViews = risers.flatMap((riser) => {
    const look = riserAppearance(riser, byId);
    if (look.opacity <= 0) return [];
    const body = <Riser riser={riser} radius={pipeRadius} params={fittings} />;
    return [
      <group key={`riser:${riser.id}`} onPointerDown={(event) => onObjectPointerDown?.(riser.pipes[0]!.pipeId, event)}>
        {needsAppearance(look) ? <Appearance opacity={look.opacity} z={look.z}>{body}</Appearance> : body}
      </group>,
    ];
  });
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
        connectorPaths={connectorPaths}
        selected={object.id === selectedId}
        registry={registry}
      />
    </group>
  );
  if (!instanced) {
    return (
      <group>
        {drawn.map(view)}
        {riserViews}
      </group>
    );
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
      {riserViews}
    </group>
  );
}
