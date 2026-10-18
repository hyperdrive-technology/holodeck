import type { IsoMetrics } from '@holodeck/editor-2.5d-react';

/** Text equivalents for canvas readings, also available when WebGPU is unavailable.
 * Do not make this an aria-live region: providers may update several times a second.
 */
export function LiveValues({ metrics }: { metrics: IsoMetrics }) {
  return (
    <dl className="sr-only" aria-label="Live values">
      {Object.entries(metrics).flatMap(([object, params]) => Object.entries(params).map(([param, value]) => (
        <div key={`${object}.${param}`}>
          <dt>{object}.{param}</dt>
          <dd><output aria-label={`${object}.${param}`} aria-live="off">{value == null ? 'No reading' : String(value)}</output></dd>
        </div>
      )))}
    </dl>
  );
}
