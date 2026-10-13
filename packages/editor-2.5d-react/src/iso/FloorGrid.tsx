import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { FrontSide, type Mesh } from 'three';
import {
  abs,
  cameraPosition,
  color,
  float,
  fract,
  fwidth,
  min,
  mix,
  positionWorld,
  pow,
  uniform,
  vec2,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

/**
 * Floor grid in TSL. drei's `Grid` is a GLSL ShaderMaterial, which
 * WebGPURenderer does not compile. The line math matches that shader:
 * world-space XZ, fwidth-antialiased cells, section lines on top, fade
 * from the camera's ground projection.
 *
 * The quad follows the camera so a finite plane still covers the view.
 * The pattern reads `positionWorld`, so the lines stay locked to the floor.
 */
export function FloorGrid({
  cellSize = 1,
  cellThickness = 0.55,
  cellColor = '#e8e8e8',
  sectionSize = 2,
  sectionThickness = 0.7,
  sectionColor = '#d4d4d4',
  fadeDistance = 80,
  fadeStrength = 0.85,
  y = -0.06,
}: {
  cellSize?: number;
  cellThickness?: number;
  cellColor?: string;
  sectionSize?: number;
  sectionThickness?: number;
  sectionColor?: string;
  fadeDistance?: number;
  fadeStrength?: number;
  y?: number;
}) {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => {
    const uCell = uniform(cellSize);
    const uSection = uniform(sectionSize);
    const uCellThick = uniform(cellThickness);
    const uSectionThick = uniform(sectionThickness);
    const uFadeDistance = uniform(fadeDistance);
    const uFadeStrength = uniform(fadeStrength);

    const gridLine = (size: typeof uCell, thickness: typeof uCellThick) => {
      const r = vec2(positionWorld.x, positionWorld.z).div(size);
      const grid = abs(fract(r.sub(0.5)).sub(0.5)).div(fwidth(r));
      const line = min(grid.x, grid.y).add(1).sub(thickness);
      return float(1).sub(min(line, float(1)));
    };

    const cells = gridLine(uCell, uCellThick);
    const sections = gridLine(uSection, uSectionThick);
    const dist = vec2(positionWorld.x, positionWorld.z)
      .sub(vec2(cameraPosition.x, cameraPosition.z))
      .length();
    const fade = float(1).sub(min(dist.div(uFadeDistance), float(1)));
    const alpha = cells.add(sections).mul(pow(fade, uFadeStrength));

    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = mix(color(cellColor), color(sectionColor), min(float(1), uSectionThick.mul(sections)));
    mat.opacityNode = mix(alpha.mul(0.75), alpha, sections);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = FrontSide;
    mat.toneMapped = false;
    return mat;
  }, [cellSize, cellThickness, cellColor, sectionSize, sectionThickness, sectionColor, fadeDistance, fadeStrength]);

  useFrame(({ camera }) => {
    const current = mesh.current;
    if (!current) {
      return;
    }
    current.position.x = camera.position.x;
    current.position.z = camera.position.z;
  });

  return (
    <mesh
      ref={mesh}
      position={[0, y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      scale={[400, 400, 1]}
      frustumCulled={false}
      renderOrder={-1}
      raycast={() => {}}
    >
      <planeGeometry />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
