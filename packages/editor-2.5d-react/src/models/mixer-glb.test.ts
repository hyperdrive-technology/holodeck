import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BufferAttribute, BufferGeometry, EdgesGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { HOLODECK_STYLE } from '../../assets/process/style';
import { nodeBounds, nodeByName, parseGlb, readAccessor, type GltfJson } from './glb-json';
import { expectBreweryBasics, expectNames, loadModel, worldPosOf } from './brewery-glb';

const PKG = resolve(__dirname, '../..');

/**
 * Line-termination audit (Des, round 4): every vertical / meridian line the
 * runtime draws must end on a drawn horizontal ring or on a window cut edge,
 * never fade out part-way across a curved band. Runs the SAME edge extraction
 * as applyHolodeckStyle (three EdgesGeometry at style.edges.threshold) on each
 * mesh in its local frame (every mesh is built with its own axis along local
 * Y: lathes, sweeps, drums, nozzle stubs). A drawn segment is a MERIDIAN when
 * both ends share an azimuth about local Y and it is not horizontal, so a
 * tilted shoulder/dome band line counts as much as a wall line; everything
 * else (rings, radial sill/cap edges, cut-face edges, box edges) can terminate
 * one. Meridians are chained through shared vertices and every chain end that
 * is not also a vertex of a drawn non-meridian segment is reported.
 */
function danglingMeridianEnds(glb: { json: GltfJson; bin: Uint8Array }, threshold = HOLODECK_STYLE.edges.threshold) {
  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const sameAzimuth = (a: number[], b: number[]) => {
    const ra = Math.hypot(a[0], a[2]);
    const rb = Math.hypot(b[0], b[2]);
    if (ra < 1e-4 || rb < 1e-4) return true; // on the axis: any azimuth
    let d = Math.abs(Math.atan2(a[0], a[2]) - Math.atan2(b[0], b[2]));
    d = Math.min(d, Math.PI * 2 - d);
    return d < 1e-3;
  };
  const report: Record<string, string[]> = {};
  for (const node of glb.json.nodes) {
    if (node.mesh === undefined || node.name === undefined) continue;
    for (const prim of glb.json.meshes[node.mesh].primitives) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(readAccessor(glb, prim.attributes.POSITION) as Float32Array, 3));
      if (prim.indices !== undefined) {
        const idx = readAccessor(glb, prim.indices);
        geometry.setIndex(new BufferAttribute(idx instanceof Uint16Array || idx instanceof Uint32Array ? idx : new Uint32Array(idx), 1));
      }
      const p = new EdgesGeometry(geometry, threshold).getAttribute('position').array as Float32Array;
      const axial: [string, string, number[]][] = [];
      const terminators = new Set<string>();
      for (let i = 0; i < p.length; i += 6) {
        const a = [p[i], p[i + 1], p[i + 2]];
        const b = [p[i + 3], p[i + 4], p[i + 5]];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (len < 1e-6) continue;
        const meridian = Math.abs(b[1] - a[1]) / len > 0.1 && sameAzimuth(a, b);
        if (meridian) axial.push([key(a[0], a[1], a[2]), key(b[0], b[1], b[2]), [...a, ...b]]);
        else terminators.add(key(a[0], a[1], a[2])).add(key(b[0], b[1], b[2]));
      }
      const degree = new Map<string, number>();
      for (const [ka, kb] of axial) {
        degree.set(ka, (degree.get(ka) ?? 0) + 1);
        degree.set(kb, (degree.get(kb) ?? 0) + 1);
      }
      const bad: string[] = [];
      for (const [ka, kb, pts] of axial) {
        if (degree.get(ka) === 1 && !terminators.has(ka)) bad.push(`(${pts.slice(0, 3).map((v) => v.toFixed(3)).join(', ')})`);
        if (degree.get(kb) === 1 && !terminators.has(kb)) bad.push(`(${pts.slice(3).map((v) => v.toFixed(3)).join(', ')})`);
      }
      if (bad.length) report[node.name] = bad;
    }
  }
  return report;
}

/** Asset contract for the agitated mixer (holodeck/blender/parts/mixer.py). */
describe('assets/models/mixer.glb', () => {
  const gltf = loadModel('mixer');
  const glb = parseGlb(new Uint8Array(readFileSync(join(PKG, 'assets/models/mixer.glb'))));
  const materialOf = (name: string) => {
    const node = nodeByName(gltf, name)!.node;
    return gltf.materials![gltf.meshes[node.mesh!].primitives[0].material!].name;
  };
  const bounds = (name: string) => nodeBounds(gltf, nodeByName(gltf, name)!.index);
  const radiusOf = (name: string, axis: 'x' | 'z' = 'x') => {
    const b = bounds(name);
    return (b.max[axis] - b.min[axis]) / 2;
  };

  it('uses only hd.* materials, stays under the triangle bound and sits on the floor', () => {
    expectBreweryBasics(gltf, { height: 2.02 });
  });

  it('declares exactly the contract port.* and anim.* empties', () => {
    expectNames(gltf, 'port.', ['port.in', 'port.out']);
    expectNames(gltf, 'anim.', ['anim.agitator', 'anim.liquid']);
  });

  it('places ports and pivots where the script header documents', () => {
    // Nozzles sit on facet centres (theta 185 / 265 deg) at 0.60 from the axis.
    const inPos = worldPosOf(gltf, 'port.in');
    const outPos = worldPosOf(gltf, 'port.out');
    expect(Math.hypot(inPos.x, inPos.z)).toBeCloseTo(0.6, 3);
    expect(Math.hypot(outPos.x, outPos.z)).toBeCloseTo(0.6, 3);
    expect(Math.atan2(inPos.x, inPos.z) * (180 / Math.PI)).toBeCloseTo(-175, 1); // 185 deg
    expect(Math.atan2(outPos.x, outPos.z) * (180 / Math.PI)).toBeCloseTo(-95, 1); // 265 deg
    expect(inPos.y).toBeCloseTo(1.2, 3);
    expect(outPos.y).toBeCloseTo(0.25, 3);
    expect(worldPosOf(gltf, 'anim.agitator').toArray()).toEqual([expect.closeTo(0, 3), expect.closeTo(1.75, 3), expect.closeTo(0, 3)]);
  });

  it('nozzles are slim stubs with flange rings at the port end and seated on the wall', () => {
    for (const stub of ['inlet', 'outlet']) {
      const body = bounds(stub);
      const flange = bounds(`${stub}.flange`);
      const base = bounds(`${stub}.base`);
      // Horizontal stubs are yawed 5 deg off an axis, which inflates their x/z extents;
      // the vertical extent is the true diameter (a 12-gon vertex points straight down).
      const radius = (b: typeof body) => (b.max.y - b.min.y) / 2;
      const along = stub === 'inlet' ? 'z' : 'x'; // the stub's (approximate) axis
      expect(radius(body)).toBeLessThan(0.06); // slim, not the 0.07 / 0.1 hex look
      expect(radius(flange) / radius(body)).toBeCloseTo(1.32, 2); // scene pipe PIPE_FLANGE_SCALE
      expect(radius(base) / radius(body)).toBeCloseTo(1.32, 2);
      expect(flange.max[along] - flange.min[along]).toBeLessThan(0.04); // thin rings, perpendicular to the stub
      expect(base.max[along] - base.min[along]).toBeLessThan(0.04);
      // Base ring sits on the wall face (R cos(10 deg) = 0.443 from the axis), the flange at the port (0.60).
      const centreR = (b: typeof base) => Math.hypot((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
      expect(centreR(base)).toBeCloseTo(0.443 + 0.01, 2);
      expect(centreR(flange)).toBeCloseTo(0.6 - 0.01, 2);
    }
  });

  it('spins a shaft, a cross paddle and a 3-blade impeller low in the vessel', () => {
    const ag = nodeByName(gltf, 'anim.agitator')!;
    expect(ag.node.mesh).toBeUndefined();
    const kids = (ag.node.children ?? []).map((i) => gltf.nodes[i].name).sort();
    expect(kids).toEqual(['impeller.blade.0', 'impeller.blade.1', 'impeller.blade.2', 'impeller.hub', 'paddle', 'shaft']);
    // The shaft is on the axis and runs from inside the housing down ONTO the hub (its
    // bottom ring on the hub top), so the impeller never floats and the shaft's lines
    // end on a ring.
    const shaft = bounds('shaft');
    const hub = bounds('impeller.hub');
    expect((shaft.min.x + shaft.max.x) / 2).toBeCloseTo(0, 3);
    expect((shaft.min.z + shaft.max.z) / 2).toBeCloseTo(0, 3);
    expect(shaft.max.y).toBeGreaterThan(1.75); // above the head apex, inside the housing
    expect(shaft.min.y).toBeCloseTo(hub.max.y, 4);
    // Hub low in the liquid but above the dish rim (0.22); blades span the hub on both sides.
    expect(hub.min.y).toBeGreaterThan(0.22);
    expect(hub.max.y).toBeLessThan(0.5);
    for (let i = 0; i < 3; i++) {
      const blade = bounds(`impeller.blade.${i}`);
      const reach = Math.max(blade.max.x, -blade.min.x, blade.max.z, -blade.min.z);
      expect(reach).toBeGreaterThan(0.18);
      expect(reach).toBeLessThan(0.3);
      expect(Math.abs((blade.min.y + blade.max.y) / 2 - (hub.min.y + hub.max.y) / 2)).toBeLessThan(0.02);
    }
    const paddle = bounds('paddle');
    expect(paddle.max.x - paddle.min.x).toBeGreaterThan(0.6); // nearly the inner diameter
    expect((paddle.min.y + paddle.max.y) / 2).toBeCloseTo(1.3, 2);
  });

  it('follows the liquid scaling convention with the translucent hd.liquid finish', () => {
    // Same pivot/scale contract as expectLiquid (brewery-glb.ts), but the liquid is a
    // FULL revolution in hd.liquid (translucent at runtime) with its edges drawn,
    // not the opaque vessels' outset, edge-less sight-window slice.
    const pivot = nodeByName(gltf, 'anim.liquid')!;
    expect(pivot.node.mesh).toBeUndefined();
    const p = worldPosOf(gltf, 'anim.liquid');
    expect(p.toArray()).toEqual([expect.closeTo(0, 4), expect.closeTo(0.06, 3), expect.closeTo(0, 4)]);
    expect((pivot.node.children ?? []).map((i) => gltf.nodes[i].name)).toEqual(['liquid']);
    const idx = nodeByName(gltf, 'liquid')!.index;
    const b = nodeBounds(gltf, idx);
    expect(b.min.y - p.y).toBeCloseTo(0, 3);
    expect(b.max.y - p.y).toBeCloseTo(1.39, 3);
    expect(materialOf('liquid')).toBe('hd.liquid');
    expect(gltf.nodes[idx].extras?.hd_edges ?? true).toBe(true);
    // Inside the inner wall (r 0.39) all round: no sight-window outset.
    expect(Math.max(b.max.x, -b.min.x, b.max.z, -b.min.z)).toBeLessThan(0.39);
    // The GLB ships unscaled (full): a preview built with HD_MIXER_PREVIEW_FILL must never be committed.
    expect(pivot.node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
  });

  it('cuts the window through the wall band and shoulder, leaving the head cap and heel whole', () => {
    const band = bounds('shell.band');
    // 270 deg keep-arc (95..355 deg): reaches -R on -X and -Z, the cut planes near +X / +Z.
    // Facets sit at -5 + 20k deg, so no column lies exactly on an axis: extents are R*sin(85 deg).
    expect(band.min.x).toBeCloseTo(-0.45, 2);
    expect(band.min.z).toBeCloseTo(-0.45, 2);
    expect(band.max.x).toBeCloseTo(0.45, 2);
    expect(band.max.z).toBeCloseTo(0.45, 2);
    expect(band.min.y).toBeCloseTo(0.1, 3); // sill = the heel's top ring
    expect(band.max.y).toBeCloseTo(1.622, 2); // arched top = the head's first ring
    const upper = bounds('shell.upper');
    expect(upper.min.y).toBeCloseTo(band.max.y, 3);
    expect(upper.max.y).toBeCloseTo(1.75, 1);
    expect(Math.max(upper.max.x, upper.max.z)).toBeLessThan(0.38); // only the head cap is left above the window
    const lower = bounds('shell.lower');
    expect(lower.min.y).toBeCloseTo(0, 4);
    expect(lower.max.y).toBeCloseTo(0.1, 3);
    // The shell is the mixer iso shade, not plain white; agitator and nozzles are white.
    for (const name of ['shell.upper', 'shell.band', 'shell.lower', 'housing', 'housing.lid', 'housing.collar']) {
      expect(materialOf(name), name).toBe('hd.flask');
    }
    for (const name of ['shaft', 'paddle', 'impeller.hub', 'inlet', 'outlet']) expect(materialOf(name), name).toBe('hd.white');
  });

  it('motor housing is a collar seated on the head, a drum and a lid rim with touching caps', () => {
    const drum = bounds('housing');
    const lid = bounds('housing.lid');
    const collar = bounds('housing.collar');
    expect(radiusOf('housing.collar')).toBeGreaterThan(radiusOf('housing') * 1.05);
    expect(radiusOf('housing.collar')).toBeLessThan(radiusOf('housing') * 1.15);
    expect(radiusOf('housing.lid')).toBeGreaterThan(radiusOf('housing'));
    // Stacked, never sunk: each cylinder's bottom ring lies on the one below, so its
    // meridian lines end on a drawn ring (the collar's base ring is the line on the head).
    expect(drum.min.y).toBeCloseTo(collar.max.y, 4);
    expect(lid.min.y).toBeCloseTo(drum.max.y, 4);
    expect(collar.max.y - collar.min.y).toBeLessThan(0.1); // a band, not a second drum
    // Collar base on the head surface at its inscribed radius: between the head's
    // height at the collar's flats (r 0.251 -> y 1.694) and at its vertices (r 0.26).
    expect(collar.min.y).toBeGreaterThan(1.685);
    expect(collar.min.y).toBeLessThan(1.70);
  });

  it('every drawn meridian line ends on a drawn ring or cut edge (runtime EdgesGeometry audit)', () => {
    expect(danglingMeridianEnds(glb)).toEqual({});
  });

  describe('the audit itself (self-test on hand-built lathes)', () => {
    // A capped lathe of `profile` (TOP -> BOTTOM, r > 0 at both ends) with `seg` facets,
    // packed like the exporter writes it: POSITION accessor + uint32 indices.
    function probeLathe(profile: [number, number][], seg: number) {
      const verts: number[] = [];
      const idx: number[] = [];
      const rings: number[][] = [];
      for (const [r, y] of profile) {
        const ring: number[] = [];
        for (let c = 0; c < seg; c++) {
          const th = (c / seg) * Math.PI * 2;
          ring.push(verts.length / 3);
          verts.push(r * Math.sin(th), y, r * Math.cos(th));
        }
        rings.push(ring);
      }
      for (let i = 0; i + 1 < rings.length; i++) {
        for (let c = 0; c < seg; c++) {
          const c2 = (c + 1) % seg;
          idx.push(rings[i][c], rings[i + 1][c], rings[i + 1][c2], rings[i][c], rings[i + 1][c2], rings[i][c2]);
        }
      }
      const fan = (ring: number[], flip: boolean) => {
        for (let c = 1; c + 1 < ring.length; c++) idx.push(ring[0], ...(flip ? [ring[c + 1], ring[c]] : [ring[c], ring[c + 1]]));
      };
      fan(rings[0], false); // top cap
      fan(rings[rings.length - 1], true); // bottom cap
      const bin = new Uint8Array(verts.length * 4 + idx.length * 4);
      bin.set(new Uint8Array(new Float32Array(verts).buffer), 0);
      bin.set(new Uint8Array(new Uint32Array(idx).buffer), verts.length * 4);
      const json = {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ name: 'probe', mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
          { count: verts.length / 3, type: 'VEC3', componentType: 5126, bufferView: 0 },
          { count: idx.length, type: 'SCALAR', componentType: 5125, bufferView: 1 },
        ],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: verts.length * 4 },
          { buffer: 0, byteOffset: verts.length * 4, byteLength: idx.length * 4 },
        ],
      } as unknown as GltfJson;
      return { json, bin };
    }

    it('flags meridians that stop on a ring the runtime would not draw', () => {
      // 12 facets. Band A tilted 55 deg from vertical: adjacent facets meet at ~17 deg
      // (drawn). Band B tilted 65 deg: ~12.6 deg (not drawn). The ring between them
      // turns only 10 deg, so it is not drawn either: band A's 12 meridians dangle there.
      const bad = probeLathe([[0.1, 0.6], [0.3, 0.46], [0.45, 0.39], [0.45, 0.0]], 12);
      const report = danglingMeridianEnds(bad);
      expect(Object.keys(report)).toEqual(['probe']);
      expect(report.probe).toHaveLength(12);
      expect(report.probe.every((pt) => pt.includes('0.460'))).toBe(true);
    });

    it('accepts meridians that stop on a drawn ring', () => {
      // Same band A; band B at 75 deg (facets ~7.7 deg, not drawn) but the ring between
      // them now turns 20 deg, so it is drawn and terminates the band A lines.
      const good = probeLathe([[0.1, 0.6], [0.3, 0.46], [0.45, 0.42], [0.45, 0.0]], 12);
      expect(danglingMeridianEnds(good)).toEqual({});
    });
  });
});
