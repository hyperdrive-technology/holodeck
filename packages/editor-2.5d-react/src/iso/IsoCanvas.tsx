/**
 * Orthographic 2.5D canvas: white floor, #EEE cell lines, #CCC section
 * lines, camera height fixed, 90° yaw snaps, and a 2D toggle.
 */

import { OrthographicCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
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
import { IsoRegistryProvider, useIsoRegistry } from '../registry/react';
import { FloorGrid } from './FloorGrid';
import { useWebGPUSupport, WebGPUMissing } from './use-webgpu';
import { createWebGPURenderer } from './webgpu-renderer';
import {
  initialIsoPose,
  lerpPose,
  posePosition,
  rotatePose,
  toggleTopDown,
  type IsoPose,
} from './pose';

const VIEW_DISTANCE = 18;
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
  const from = useRef(pose);
  const to = useRef(pose);
  const started = useRef(0);
  const animating = useRef(false);
  const snapped = useRef(false);

  useEffect(() => {
    const dx = camera.position.x - target[0];
    const dz = camera.position.z - target[2];
    from.current = {
      yaw: dx === 0 && dz === 0 ? pose.yaw : Math.atan2(dz, dx),
      radius: Math.hypot(dx, dz),
      height: pose.height,
    };
    if (!snapped.current) {
      const [x, y, z] = posePosition(pose);
      camera.position.set(x + target[0], y + target[1], z + target[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      from.current = pose;
      snapped.current = true;
      return;
    }
    to.current = pose;
    started.current = performance.now();
    animating.current = true;
  }, [pose, camera, zoom, target]);

  useFrame(() => {
    camera.zoom = zoom;
    if (!animating.current) {
      const [x, y, z] = posePosition(pose);
      camera.position.set(x + target[0], y + target[1], z + target[2]);
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateProjectionMatrix();
      return;
    }
    const t = (performance.now() - started.current) / (ANIM_SECONDS * 1000);
    const next = lerpPose(from.current, to.current, t);
    const [x, y, z] = posePosition(next);
    camera.position.set(x + target[0], y + target[1], z + target[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
    if (t >= 1) {
      animating.current = false;
      from.current = to.current;
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
  pose?: IsoPose;
  onPoseChange?: (pose: IsoPose) => void;
  /** Hide rotate / 2D buttons. Snapshot renders turn this off. */
  showControls?: boolean;
  cursor?: string;
  showGrid?: boolean;
  /** Style tokens for code-built parts inside the canvas. Default: `HOLODECK_STYLE`. */
  holodeckStyle?: HolodeckStyle;
  /** Registry for hooks inside the canvas. Default: the one from context, else the built-ins. */
  registry?: ContributionRegistry;
}

export function IsoCanvas({
  children,
  className,
  zoom = 42,
  onZoomChange,
  target = [0, 0, 0],
  pose: poseProp,
  onPoseChange,
  showControls = true,
  cursor,
  showGrid = true,
  holodeckStyle,
  registry: registryProp,
}: IsoCanvasProps) {
  const contextRegistry = useIsoRegistry();
  const registry = registryProp ?? contextRegistry;
  const home = useMemo(() => initialIsoPose(VIEW_DISTANCE), []);
  const [poseInternal, setPoseInternal] = useState<IsoPose>(home);
  const pose = poseProp ?? poseInternal;
  const setPose = onPoseChange ?? setPoseInternal;
  const topDown = pose.radius < 1e-3;
  const [ox, oy, oz] = posePosition(home);
  const webgpu = useWebGPUSupport();

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#fff', cursor }}
      onWheel={(event) => {
        if (!onZoomChange) {
          return;
        }
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1 / 1.2 : 1.2;
        onZoomChange(Math.min(80, Math.max(8, zoom * factor)));
      }}
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
