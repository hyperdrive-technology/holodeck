/**
 * Process line from tests/scene.json.
 * Live metrics overlay params (mixer level, label text); they do not move objects.
 */

import { useEffect, useMemo, useState } from 'react';
import { SnapshotLabelLock } from '../../assets/process/Label';
import { ProcessSceneView, fitSceneZoom } from '../editor/ProcessSceneView';
import type { IsoMetrics } from '../registry/types';
import { PROCESS_SCENE } from './load-process-scene';
import { SceneGraph } from './SceneGraph';

export const PROCESS_SNAPSHOT = {
  temp: 14,
  rpm: 0,
  alarm: false,
  mixerFill: 0.52,
  // Same cyan as scene.json mixer.fillColor. Live only forwards mixerFill;
  // #4aa3d9 (tank default) read dull vs r-mixer.
  fillColor: '#18BAE6',
} as const;

/** The sketch's simulated readings, as generic per-placement metrics. */
export function processMetrics(sim: { temp: number; rpm: number; alarm: boolean; mixerFill: number }): IsoMetrics {
  return {
    mixer: { level: sim.mixerFill, rpm: sim.rpm, alarm: sim.alarm },
    'label-temp-val': { text: `${sim.temp} deg`, alarm: sim.alarm },
    'label-rpm-val': { text: `${sim.rpm}` },
  };
}

/** Frozen readings of the reference snapshot (also what the tank tuner shows). */
export const PROCESS_SNAPSHOT_METRICS: IsoMetrics = processMetrics(PROCESS_SNAPSHOT);

export function ProcessLineSketch({ live = true }: { live?: boolean }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setT((n) => n + 1), 400);
    return () => window.clearInterval(id);
  }, [live]);

  const metrics = useMemo(() => {
    if (!live) return PROCESS_SNAPSHOT_METRICS;
    const temp = 14 + (t % 24) * 3;
    return processMetrics({
      temp,
      rpm: t % 12 === 0 ? 0 : 40 + (t % 8) * 10,
      alarm: temp >= 60,
      mixerFill: 0.25 + (Math.sin(t / 4) + 1) * 0.25,
    });
  }, [live, t]);

  return (
    <div
      data-testid="scene-root"
      data-scene-id={PROCESS_SCENE.id}
      data-object-count={String(PROCESS_SCENE.objects.length)}
      data-object-ids={PROCESS_SCENE.objects.map((o) => o.id).join(',')}
      style={{ width: '100%', height: '100%' }}
    >
      <ProcessSceneView
        scene={PROCESS_SCENE}
        showControls={live}
        zoom={fitSceneZoom(PROCESS_SCENE)}
      >
        <SnapshotLabelLock.Provider value={!live}>
          <SceneGraph objects={PROCESS_SCENE.objects} metrics={metrics} />
        </SnapshotLabelLock.Provider>
      </ProcessSceneView>
    </div>
  );
}
