import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Group } from 'three';
import { applyAppearance, AppearanceState } from './appearance';

/**
 * Wraps one placement's subtree and keeps its opacity / z-order applied
 * (appearance.ts). Runs per frame because parts mount meshes late (GLBs,
 * textures); `applyAppearance` is a no-op when nothing changed. Only mounted
 * for placements that set `opacity < 1` or a non-zero `z`, so ordinary
 * scenes pay nothing.
 */
export function Appearance({ opacity, z, children }: { opacity: number; z: number; children: ReactNode }) {
  const group = useRef<Group>(null);
  const [state] = useState(() => new AppearanceState());
  useEffect(() => () => state.dispose(), [state]);
  useFrame(() => {
    if (group.current) applyAppearance(group.current, opacity, z, state);
  });
  return (
    <group ref={group} userData={{ hdOpacity: opacity, hdZ: z }}>
      {children}
    </group>
  );
}
