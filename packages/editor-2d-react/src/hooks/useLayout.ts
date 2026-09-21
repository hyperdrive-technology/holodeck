/**
 * Hook for layout management
 */

import { useCallback } from 'react';
import type { LayoutConfig } from '../types';
import { autoLayoutScene } from '../utils';
import { useHolodeck } from './useHolodeck';

/**
 * Hook for managing layout operations
 */
export function useLayout() {
  const store = useHolodeck();

  const applyLayout = useCallback(
    (layoutType: string, config?: LayoutConfig) => {
      const layoutConfig = config || store.layoutConfig;

      switch (layoutType) {
        case 'dagre': {
          const layoutedNodes = autoLayoutScene(
            store.nodes,
            store.edges,
            layoutConfig
          );
          store.setNodes(layoutedNodes);
          break;
        }
        case 'force': {
          // TODO: Implement force layout
          console.warn('Force layout not yet implemented');
          break;
        }
        case 'manual': {
          // Manual layout - no automatic positioning
          break;
        }
        default: {
          console.warn(`Unknown layout type: ${layoutType}`);
        }
      }

      store.setLayout(layoutType);
      if (config) {
        store.setLayoutConfig(config);
      }
    },
    [store]
  );

  const fitToView = useCallback(() => {
    store.fitView();
  }, [store]);

  const resetLayout = useCallback(() => {
    applyLayout('dagre');
    fitToView();
  }, [applyLayout, fitToView]);

  return {
    applyLayout,
    fitToView,
    resetLayout,
    currentLayout: store.layout,
    layoutConfig: store.layoutConfig,
  };
}
