/**
 * Orthographic 2.5D canvas: white floor, #EEE cell lines, #CCC section
 * lines, camera height fixed, 90° yaw snaps, and a 2D toggle.
 */

import { OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { OrthographicCamera as OrthoCam, Vector3Tuple } from 'three';
import type { WebGPURendererParameters } from 'three/webgpu';
import type { ContributionRegistry } from '@holodeck/sdk';
import { HolodeckStyleProvider } from '../../assets/process/style-context';
import type { HolodeckStyle } from '../../assets/process/style';
import { IsoRegistryProvider, useIsoRegistry, useIsoRegistryVersion } from '../registry/react';
import { FloorGrid } from './FloorGrid';
import { useWebGPUSupport, WebGPUMissing } from './use-webgpu';
import { createWebGPURenderer } from './webgpu-renderer';
import { cameraOffset } from './pan';
import {
  createRenderTracker,
  RenderSignal,
  RenderTrackerContext,
  renderState,
  useRevision,
} from './render-signal';
import { useViewPan } from './use-view-pan';
import {
  initialIsoPose,
  lerpPose,
  posePosition,
  rotatePose,
  toggleTopDown,
  type IsoPose,
} from './pose';

const VIEW_DISTANCE = 18;
/** Module-level so the default does not change identity every render (IsoRig effects depend on it). */
const DEFAULT_TARGET: Vector3Tuple = [0, 0, 0];
const ANIM_SECONDS = 0.45;

function IsoRig({
  pose,
  zoom,
  target,
}: {
  pose: IsoPose;
  zoom: number;
  target: Vector3Tuple;
}) {
  const camera = useThree((state) => state.camera) as OrthoCam;
  // A pose animation holds the rendered signal until it lands (render-signal.tsx).
  const tracker = useContext(RenderTrackerContext);
  const releaseHold = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseHold.current?.(), []);
  const from = useRef(pose);
  const to = useRef(pose);
  const started = useRef(0);
  const animating = useRef(false);
  const snapped = useRef(false);
  // Target the camera was last placed around. The animation start pose is
  // measured against this, not the new prop: a pan changes `target` before
  // the camera has moved, and measuring against it read as a yaw/radius jump.
  const placedAt = useRef<Vector3Tuple>(target);
  const lastPose = useRef(pose);

  useEffect(() => {
    if (!snapped.current) {
      const [x, y, z] = cameraOffset(pose);
      camera.position.set(x + target[0], y + target[1], z + target[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      placedAt.current = target;
      from.current = pose;
      lastPose.current = pose;
      snapped.current = true;
      return;
    }
    // Only a pose change (rotate / 2D toggle / fit) animates. Zoom and pan
    // apply directly in useFrame so dragging stays glued to the pointer.
    if (pose === lastPose.current) return;
    lastPose.current = pose;
    const dx = camera.position.x - placedAt.current[0];
    const dz = camera.position.z - placedAt.current[2];
    from.current = {
      yaw: dx === 0 && dz === 0 ? pose.yaw : Math.atan2(dz, dx),
      radius: Math.hypot(dx, dz),
      height: pose.height,
    };
    to.current = pose;
    started.current = performance.now();
    animating.current = true;
    releaseHold.current ??= tracker?.hold() ?? null;
  }, [pose, camera, zoom, target, tracker]);

  useFrame(() => {
    camera.zoom = zoom;
    placedAt.current = target;
    if (!animating.current) {
      const [x, y, z] = cameraOffset(pose);
      camera.position.set(x + target[0], y + target[1], z + target[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateProjectionMatrix();
      return;
    }
    const t = (performance.now() - started.current) / (ANIM_SECONDS * 1000);
    const next = lerpPose(from.current, to.current, t);
    const [x, y, z] = cameraOffset(next);
    camera.position.set(x + target[0], y + target[1], z + target[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
    if (t >= 1) {
      animating.current = false;
      from.current = to.current;
      releaseHold.current?.();
      releaseHold.current = null;
    }
  });

  return null;
}

export interface IsoCanvasProps {
  children?: ReactNode;
  className?: string;
  /** Orthographic zoom. Distance is fixed; zoom changes the frustum. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** World-space look-at. Camera sits on the isometric offset from this point. */
  target?: Vector3Tuple;
  /**
   * Enables panning: left drag on unclaimed canvas (see `claimPointer`),
   * right / middle drag, two-finger trackpad scroll, Shift + wheel. Wheel and
   * pinch zoom also keep the point under the cursor fixed when this is set.
   * Mapping and math: use-view-pan.ts / pan.ts.
   */
  onTargetChange?: (target: Vector3Tuple) => void;
  /** Pan with any button even when a scene handler claimed the press (Space held). */
  forcePan?: boolean;
  pose?: IsoPose;
  onPoseChange?: (pose: IsoPose) => void;
  /** Hide rotate / 2D buttons. Snapshot renders turn this off. */
  showControls?: boolean;
  /** Idle cursor. While a pan is in progress the canvas shows `grabbing`. */
  cursor?: string;
  showGrid?: boolean;
  /** Style tokens for code-built parts inside the canvas. Default: `HOLODECK_STYLE`. */
  holodeckStyle?: HolodeckStyle;
  /** Registry for hooks inside the canvas. Default: the one from context, else the built-ins. */
  registry?: ContributionRegistry;
  /**
   * Content revision for the rendered signal (render-signal.tsx). Bump it whenever
   * anything that changes the picture changes; `ProcessEditor` does. When omitted,
   * IsoCanvas derives one from its own inputs (zoom, target, pose, style, grid,
   * registry contents, canvas dimensions and `children` identity), so a re-render with new children counts
   * as a new revision.
   * A supplied revision covers content; readiness also waits for the current
   * canvas dimensions and registry version, even if that revision stays fixed.
   */
  revision?: number;
  /** Holds the rendered signal (e.g. while the host has not fitted the view yet). */
  holdRender?: boolean;
  /**
   * Called after a presented frame shows `revision` with every GLB loaded and no
   * camera animation running. Also mirrored as `data-holodeck-rendered` and
   * `data-render-state` on the canvas container.
   */
  onRendered?: (revision: number) => void;
}

export function IsoCanvas({
  children,
  className,
  zoom = 42,
  onZoomChange,
  target = DEFAULT_TARGET,
  onTargetChange,
  forcePan = false,
  pose: poseProp,
  onPoseChange,
  showControls = true,
  cursor,
  showGrid = true,
  holodeckStyle,
  registry: registryProp,
  revision: revisionProp,
  holdRender = false,
  onRendered,
}: IsoCanvasProps) {
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const registryVersion = useIsoRegistryVersion(registry);
  const home = useMemo(() => initialIsoPose(VIEW_DISTANCE), []);
  const [poseInternal, setPoseInternal] = useState<IsoPose>(home);
  const pose = poseProp ?? poseInternal;
  const setPose = onPoseChange ?? setPoseInternal;
  const topDown = pose.radius < 1e-3;
  const [ox, oy, oz] = posePosition(home);
  const webgpu = useWebGPUSupport();
  const container = useRef<HTMLDivElement>(null);
  const [tracker] = useState(createRenderTracker);
  const targetKey = target.join(',');
  const [dimensions, setDimensions] = useState('');
  // Even a host-supplied content revision needs a local identity for canvas
  // size and live registry changes. With a controlled revision, children are
  // covered by that revision (their JSX identity changes on host reports too).
  const identity = useRevision([revisionProp ?? children, zoom, targetKey, pose, holodeckStyle, showGrid, registry, registryVersion, dimensions, holdRender]);
  const revision = revisionProp ?? identity;
  const [renderedRevision, setRenderedRevision] = useState<number | null>(null);
  const [renderedIdentity, setRenderedIdentity] = useState<number | null>(null);
  const onRenderedRef = useRef(onRendered);
  onRenderedRef.current = onRendered;
  const reportRendered = useCallback((done: number) => {
    setRenderedIdentity(done);
    setRenderedRevision(revision);
    onRenderedRef.current?.(revision);
  }, [revision]);
  const { onPointerDown, panning } = useViewPan(container, {
    zoom,
    target,
    pose,
    onTargetChange,
    onZoomChange,
    forcePan,
  });

  return (
    <div
      ref={container}
      className={className}
      data-iso-target={target.map((v) => v.toFixed(3)).join(',')}
      data-panning={panning ? 'true' : 'false'}
      data-holodeck-revision={revision}
      data-holodeck-rendered={renderedRevision ?? ''}
      data-render-state={webgpu === 'pending' ? 'pending' : renderState(identity, renderedIdentity, webgpu === 'ready')}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#fff',
        cursor: panning ? 'grabbing' : cursor,
        // Trackpad gestures belong to the canvas, not to page scroll / overscroll navigation.
        touchAction: 'none',
        overscrollBehavior: 'contain',
      }}
      onPointerDown={onPointerDown}
    >
      {webgpu === 'missing' ? <WebGPUMissing /> : null}
      {webgpu === 'ready' ? (
      <Canvas
        orthographic
        flat
        dpr={[1, 2]}
        gl={(props) => createWebGPURenderer(props as WebGPURendererParameters)}
        style={{ width: '100%', height: '100%', background: '#fff' }}
      >
        <color attach="background" args={['#ffffff']} />
        <OrthographicCamera makeDefault near={0.5} far={4000} position={[ox + target[0], oy + target[1], oz + target[2]]} zoom={zoom} />
        <RenderTrackerContext.Provider value={tracker}>
        <RenderSignal revision={identity} hold={holdRender} dimensions={dimensions} onDimensions={setDimensions} onRendered={reportRendered} />
        <IsoRig pose={pose} zoom={zoom} target={target} />
        {/* Key from the camera-right so the leftmost tank segment is
            darkest, the right is a bit lighter, and the interior back
            wall (facing the key) stays near-white. Ambient 0.5 is the
            Arcentry default — 1.0 flattened the gradient. */}
        <ambientLight color="#ffffff" intensity={0.5} />
        <directionalLight color="#ffffff" intensity={1} position={[50, 50, 30]} />
        <directionalLight color="#ffffff" intensity={0.2} position={[-50, 50, -30]} />
        {/* Sit the floor slightly below y=0 so pipe undersides don't
            z-fight the plane (that read as a thin shade band only
            where the tube kissed the ground). */}
        {showGrid ? <FloorGrid /> : null}
        {/* Providers go INSIDE the Canvas: R3F renders a separate React root,
            so context set outside does not reach these children. */}
        <IsoRegistryProvider registry={registry}>
          {holodeckStyle ? <HolodeckStyleProvider style={holodeckStyle}>{children}</HolodeckStyleProvider> : children}
        </IsoRegistryProvider>
        </RenderTrackerContext.Provider>
      </Canvas>
      ) : null}
      {showControls ? <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          display: 'flex',
          gap: 6,
          font: '12px/1 system-ui, sans-serif',
        }}
      >
        <button type="button" onClick={() => setPose(rotatePose(pose, 1))}>
          rotate left
        </button>
        <button type="button" onClick={() => setPose(rotatePose(pose, -1))}>
          rotate right
        </button>
        <button type="button" onClick={() => setPose(toggleTopDown(pose, home.radius))}>
          {topDown ? '2.5D' : '2D'}
        </button>
      </div> : null}
    </div>
  );
}
