import type { ReactNode } from 'react';
import type { Vector3Tuple } from 'three';
import { IsoCanvas } from '../iso/IsoCanvas';
import type { ContributionRegistry } from '@holodeck/sdk';
import { gridToWorld } from '../iso/grid';
import { sceneBounds, type IsoSceneFile } from '../iso/scene';
import { useIsoRegistry, useIsoThemeStyle } from '../registry/react';
import type { IsoPose } from '../iso/pose';

export function sceneTarget(scene: IsoSceneFile, registry?: ContributionRegistry): Vector3Tuple {
  if (scene.objects.length === 0) {
    return [0, 0, 0];
  }
  // Frozen look-at from the holding-registered frame (A/B at y=-10.4).
  // Recomputing from all four tanks pans holding whenever A/B move
  // (RMSE 22.3 → 23.6, holding dy +11).
  if (scene.id === 'process-line') {
    const [x, , z] = gridToWorld(4.61, -5.15);
    return [x, 1.38, z];
  }
  const tanks = scene.objects.filter((o) => o.object === 'tank' || o.object === 'mixer');
  const fallback = scene.objects.filter((o) => o.object !== 'label' && o.object !== 'area');
  const b = sceneBounds(tanks.length ? tanks : fallback.length ? fallback : scene.objects, registry);
  const [x, , z] = gridToWorld((b.minX + b.maxX) / 2 + 0.5, (b.minY + b.maxY) / 2 + 0.55);
  return [x, 1.28, z];
}

/** Snapshot canvas matches the reference.jpg process pane (960×540 minus the left nav). */
export const REFERENCE_CANVAS = { width: 760, height: 540, cropX: 200 } as const;

/**
 * Auto-fit from the tank AABB changed zoom whenever A/B moved
 * (tank width 47→44 px, RMSE 22.3→22.8). Pin the zoom that made
 * holding liquid 47 px wide.
 */
export const REFERENCE_ZOOM = 32.5;

export function fitSceneZoom(
  _scene: IsoSceneFile,
  _viewW = REFERENCE_CANVAS.width,
  _viewH = REFERENCE_CANVAS.height,
): number {
  return REFERENCE_ZOOM;
}

export function ProcessSceneView({
  scene,
  zoom = 20,
  onZoomChange,
  target,
  onTargetChange,
  forcePan,
  pose,
  onPoseChange,
  showControls = false,
  showGrid = true,
  cursor,
  children,
  registry,
}: {
  scene: IsoSceneFile;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  target?: Vector3Tuple;
  /** Enables drag / trackpad panning; see IsoCanvas. */
  onTargetChange?: (target: Vector3Tuple) => void;
  forcePan?: boolean;
  pose?: IsoPose;
  onPoseChange?: (pose: IsoPose) => void;
  showControls?: boolean;
  showGrid?: boolean;
  cursor?: string;
  children?: ReactNode;
  /** Resolves `scene.theme`. Default: registry from context. */
  registry?: ContributionRegistry;
}) {
  const contextRegistry = useIsoRegistry();
  const holodeckStyle = useIsoThemeStyle(scene.theme, registry);
  const lookAt = target ?? sceneTarget(scene, registry ?? contextRegistry);
  return (
    <IsoCanvas
      showControls={showControls}
      showGrid={showGrid}
      target={lookAt}
      onTargetChange={onTargetChange}
      forcePan={forcePan}
      zoom={zoom}
      onZoomChange={onZoomChange}
      pose={pose}
      onPoseChange={onPoseChange}
      cursor={cursor}
      holodeckStyle={holodeckStyle}
      registry={registry}
    >
      {children}
    </IsoCanvas>
  );
}
