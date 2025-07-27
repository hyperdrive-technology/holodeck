/**
 * Hook for layout management
 */

import { useCallback } from 'react';
import type { LayoutConfig } from '../types';
import { autoLayoutScene } from '../utils';
import { useStarfleet } from './useStarfleet';

/**
 * Hook for managing layout operations
 */
export function useLayout() {
  const { scene } = useStarfleet();

  const applyLayout = useCallback(
    (layoutType: string, config?: LayoutConfig) => {
      if (!scene) return null;

      try {
        const layoutedScene = autoLayoutScene(scene, layoutType, config || {});
        return layoutedScene;
      } catch (error) {
        console.error('Layout failed:', error);
        return scene;
      }
    },
    [scene]
  );

  return {
    applyLayout,
    scene,
    hasScene: !!scene
  };
}
