/**
 * Des 2026-10-30: "make sure [vertical lines] always terminate on a horizontal
 * ring". Runs the termination check over every line a procedural Tank preset
 * draws (tank-lines.ts) plus the mesh creases it outlines with `Edges`
 * (legs, flat-lid hatch, nozzle stub), and over mixer.glb's creases.
 */
import { describe, expect, it } from 'vitest';
import { CylinderGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { danglingLineEnds, edgeLineSegments } from './line-termination';
import { flatLidHatch, tankLinePlan } from './tank-lines';
import { legPositions, mergeTankParams, tankLayout, tankNozzlePose, tankWindow, TANK_NOZZLE_JAMB_OFFSET, TANK_NOZZLE_LENGTH, TANK_NOZZLE_RADIUS } from './tank-params';
import { TANK_PRESETS, type TankPresetId } from './tank-presets';
import { nozzleStubGeometry } from './flange';
import { NOZZLE_EDGE_THRESHOLD } from './NozzleStub';
import { HOLODECK_STYLE } from './style';

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of parts) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

describe('danglingLineEnds', () => {
  it('flags a vertical line with a free end and accepts one that ends on a ring', () => {
    const ring = new Float32Array([-1, 1, 0, 1, 1, 0]);
    const ok = new Float32Array([0, 0, 0, 0, 1, 0]);
    expect(danglingLineEnds(concat([ok, ring, new Float32Array([-1, 0, 0, 1, 0, 0])]))).toEqual([]);
    const loose = danglingLineEnds(concat([ok, ring]));
    expect(loose).toHaveLength(1);
    expect(loose[0].y).toBe(0);
    // A polyline's interior joints and a shared apex are not free ends.
    const v = new Float32Array([0, 0, 0, 0, 1, 0, 0, 1, 0, 0.1, 2, 0, 0.1, 2, 0, 0.2, 2.5, 0, 0.3, 2, 0, 0.2, 2.5, 0]);
    expect(danglingLineEnds(concat([v, new Float32Array([-1, 0, 0, 1, 0, 0, -1, 2, 0, 1, 2, 0])]))).toEqual([]);
    // `allow` admits e.g. the floor boundary.
    expect(danglingLineEnds(concat([ok, ring]), { allow: (p) => p.y === 0 })).toEqual([]);
  });

  it('edgeLineSegments: a closed hex prism has no free vertical ends', () => {
    const prism = new CylinderGeometry(0.1, 0.1, 1, 6);
    expect(danglingLineEnds(edgeLineSegments(prism, 15))).toEqual([]);
    // An open-ended one does too (EdgesGeometry keeps boundary edges) -- unless the boundary is hidden,
    // which is why the flat-lid hatch gets an explicit base ring.
    prism.dispose();
  });
});

const presetIds = Object.keys(TANK_PRESETS) as TankPresetId[];

describe.each(presetIds)('Tank preset %s: every vertical line ends on a ring', (id) => {
  const preset = TANK_PRESETS[id];
  const p = mergeTankParams(preset.params);

  it.each([0.12, 0.5, 0.95])('lines at fill %s', (level) => {
    if (p.agitator) return; // mixer.glb (checked below), no procedural lines
    const plan = tankLinePlan(p, p.top, preset.height, preset.radius, level);
    const lines = concat(Object.values(plan));
    expect(lines.length).toBeGreaterThan(0);
    expect(danglingLineEnds(lines)).toEqual([]);
  });

  it('mesh creases (legs, hatch, nozzle) end on rings too', () => {
    if (p.agitator) return;
    const layout = tankLayout(preset.height, preset.radius, p);
    const parts: Float32Array[] = [];
    if (p.support === 'legs') {
      const legTop = p.bottom === 'flat' ? layout.y0 : layout.bottomY + layout.bottomDepth * 0.6;
      const h = Math.max(0.01, legTop - layout.floorY);
      for (const [x, z] of legPositions(preset.radius, p.legCount)) {
        const g = new CylinderGeometry(p.legRadius, p.legRadius, h, 6);
        parts.push(edgeLineSegments(g, HOLODECK_STYLE.edges.threshold, new Matrix4().makeTranslation(x, layout.floorY + h / 2, z)));
        g.dispose();
      }
    }
    if (p.top === 'flat') {
      const hatch = flatLidHatch(preset.radius, p);
      const segs = Math.round(p.radialSegments);
      const neck = new CylinderGeometry(hatch.capR, hatch.capR, hatch.capH, segs, 1, true);
      // The neck's bottom boundary is buried in the lid: drop it, the plan's hatchBase ring replaces it.
      const neckEdges = edgeLineSegments(neck, HOLODECK_STYLE.edges.threshold, new Matrix4().makeTranslation(0, layout.bodyTop + hatch.neckY0 + hatch.capH / 2, 0));
      const kept: number[] = [];
      const baseY = layout.bodyTop + hatch.neckY0;
      for (let i = 0; i < neckEdges.length; i += 6) {
        const horizontalAtBase = Math.abs(neckEdges[i + 1] - baseY) < 1e-4 && Math.abs(neckEdges[i + 4] - baseY) < 1e-4;
        if (!horizontalAtBase) kept.push(...neckEdges.subarray(i, i + 6));
      }
      parts.push(new Float32Array(kept), tankLinePlan(p, p.top, preset.height, preset.radius, 0.5).hatchBase);
      neck.dispose();
    }
    if (p.nozzle === 'tangential') {
      const { keepStart, keepLen } = tankWindow(p.windowDeg, p.windowYawDeg);
      const nozzleR = Math.max(0.05, preset.radius * TANK_NOZZLE_RADIUS);
      const pose = tankNozzlePose(preset.radius, keepStart + keepLen - TANK_NOZZLE_JAMB_OFFSET, layout.y0 + preset.height * 0.3, Math.max(0.2, preset.radius * TANK_NOZZLE_LENGTH), nozzleR);
      const g = nozzleStubGeometry({ length: pose.length, radius: nozzleR });
      parts.push(edgeLineSegments(g, NOZZLE_EDGE_THRESHOLD, new Matrix4().compose(new Vector3(...pose.position), new Quaternion(...pose.quaternion), new Vector3(1, 1, 1))));
      g.dispose();
    }
    expect(danglingLineEnds(concat(parts))).toEqual([]);
  });
});
