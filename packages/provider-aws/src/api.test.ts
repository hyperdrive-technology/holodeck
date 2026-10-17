import { describe, expect, it } from 'vitest';
import { ceilPeriod, historyPeriod, lookbackSeconds, MAX_HISTORY_SAMPLES, MAX_QUERIES_PER_REQUEST, packBatches, stateFromHistory } from './api';
import { isValidPeriod } from './config';
import { parseSource, type MetricSource } from './source';

const D = { region: 'eu-west-1', periodS: 60, stat: 'Average' };
const metrics = (n: number, period = 60) =>
  Array.from({ length: n }, (_, i) => parseSource(`cloudwatch:eu-west-1/AWS/EC2/CPUUtilization?InstanceId=i-${i}&period=${period}`, D) as MetricSource);

describe('packBatches', () => {
  it('keeps ≤ 500 queries per request', () => {
    const batches = packBatches(metrics(1201), undefined);
    expect(batches.map((b) => b.metrics.length)).toEqual([500, 500, 201]);
    expect(batches.every((b) => b.windowS === 900)).toBe(true);
  });

  it('keeps the datapoint count under the GetMetricData quota for high-resolution metrics', () => {
    // 1 s period × 900 s window = 900 points each → at most 111 per request.
    const batches = packBatches(metrics(300, 1), undefined);
    for (const b of batches) expect(b.metrics.length * Math.ceil(b.windowS / 1)).toBeLessThanOrEqual(100_000);
    expect(batches.reduce((n, b) => n + b.metrics.length, 0)).toBe(300);
    expect(batches.length).toBe(3);
  });

  it('shortens a single window that alone exceeds the budget', () => {
    const [batch] = packBatches(metrics(1, 1), 15 * 86_400);
    expect(batch?.windowS).toBe(100_000);
  });

  it('uses the configured look-back, never shorter than one period', () => {
    const [m] = metrics(1, 3600);
    expect(lookbackSeconds(m as MetricSource, undefined)).toBe(18_000);
    expect(lookbackSeconds(m as MetricSource, 600)).toBe(3600);
    expect(packBatches([], undefined)).toEqual([]);
    expect(MAX_QUERIES_PER_REQUEST).toBe(500);
  });
});

describe('periods', () => {
  it('ceilPeriod returns the next valid CloudWatch period', () => {
    expect([0, 1, 2, 5, 6, 11, 20, 29, 31, 60, 61, 119.5, 3601].map(ceilPeriod)).toEqual([1, 1, 5, 5, 10, 20, 20, 30, 60, 60, 120, 120, 3660]);
    for (let s = 0; s < 5000; s += 7) expect(isValidPeriod(ceilPeriod(s))).toBe(true);
  });

  it('historyPeriod respects the step, the source period, retention and the sample cap', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const h = 3600_000;
    // Recent hour, 1 s source period, no step: 1 s.
    expect(historyPeriod({ from: now - h, to: now }, 1, now)).toBe(1);
    // Never finer than the source period.
    expect(historyPeriod({ from: now - h, to: now, stepMs: 1000 }, 300, now)).toBe(300);
    // A coarser step wins.
    expect(historyPeriod({ from: now - h, to: now, stepMs: 600_000 }, 60, now)).toBe(600);
    // Retention: > 3 h old → ≥ 60 s; > 15 d → ≥ 300 s; > 63 d → ≥ 3600 s.
    expect(historyPeriod({ from: now - 4 * h, to: now - 3.9 * h }, 1, now)).toBe(60);
    expect(historyPeriod({ from: now - 16 * 24 * h, to: now - 15.9 * 24 * h }, 60, now)).toBe(300);
    expect(historyPeriod({ from: now - 64 * 24 * h, to: now - 63.9 * 24 * h }, 60, now)).toBe(3600);
    // The sample cap: one year at 1 h is 8760 samples (fits); 2 h of 1 s data is 7200 (fits); 3 h at 1 s = 10800 fits too.
    const span = (MAX_HISTORY_SAMPLES + 1) * 1000;
    expect(historyPeriod({ from: now - span, to: now }, 1, now)).toBeGreaterThan(1);
    expect(historyPeriod({ from: now - span, to: now }, 1, now) * MAX_HISTORY_SAMPLES).toBeGreaterThanOrEqual(span / 1000);
  });
});

describe('stateFromHistory', () => {
  it('reads newState from HistoryData JSON, falling back to the summary', () => {
    expect(stateFromHistory(JSON.stringify({ oldState: { stateValue: 'OK' }, newState: { stateValue: 'ALARM' } }), undefined)).toBe('ALARM');
    expect(stateFromHistory('not json', 'Alarm updated from ALARM to OK')).toBe('OK');
    expect(stateFromHistory(undefined, 'Alarm updated from OK to INSUFFICIENT_DATA')).toBe('INSUFFICIENT_DATA');
    expect(stateFromHistory('{}', 'Alarm "x" updated')).toBeUndefined();
  });
});
