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
type Glb = { json: GltfJson; bin: Uint8Array };
type Seg = { a: number[]; b: number[] };

const sameAzimuth = (a: number[], b: number[]) => {
  const ra = Math.hypot(a[0], a[2]);
  const rb = Math.hypot(b[0], b[2]);
  if (ra < 1e-4 || rb < 1e-4) return true; // on the axis: any azimuth
  let d = Math.abs(Math.atan2(a[0], a[2]) - Math.atan2(b[0], b[2]));
  d = Math.min(d, Math.PI * 2 - d);
  return d < 1e-3;
};

/** The segments the runtime would draw for one mesh node, in its local frame (zero-length ones dropped). */
function drawnSegments(glb: Glb, node: GltfJson['nodes'][number], threshold: number): Seg[] {
  const out: Seg[] = [];
  if (node.mesh === undefined) return out;
  for (const prim of glb.json.meshes[node.mesh].primitives) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(readAccessor(glb, prim.attributes.POSITION) as Float32Array, 3));
    if (prim.indices !== undefined) {
      const idx = readAccessor(glb, prim.indices);
      geometry.setIndex(new BufferAttribute(idx instanceof Uint16Array || idx instanceof Uint32Array ? idx : new Uint32Array(idx), 1));
    }
    const p = new EdgesGeometry(geometry, threshold).getAttribute('position').array as Float32Array;
    for (let i = 0; i < p.length; i += 6) {
      const a = [p[i], p[i + 1], p[i + 2]];
      const b = [p[i + 3], p[i + 4], p[i + 5]];
      if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) >= 1e-6) out.push({ a, b });
    }
  }
  return out;
}

function danglingMeridianEnds(glb: Glb, threshold = HOLODECK_STYLE.edges.threshold) {
  const key = (x: number, y: number, z: number) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
  const report: Record<string, string[]> = {};
  for (const node of glb.json.nodes) {
    if (node.mesh === undefined || node.name === undefined) continue;
    const axial: [string, string, number[]][] = [];
    const terminators = new Set<string>();
    for (const { a, b } of drawnSegments(glb, node, threshold)) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
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
  return report;
}

/**
 * Ring audit (Des, round 5: "the inner floor rim reads as a stray C-shaped
 * ring"). The co-axial shell solids (`names`, all unrotated on the part axis)
 * are merged and every drawn HORIZONTAL RING (both ends at the same radius and
 * height, different azimuths) is chained through shared vertices. A ring must
 * close, or be an arc whose two ends each sit on a window cut edge that
 * continues straight DOWN a wall: a drawn constant-azimuth segment from the
 * end to a lower vertex whose radius differs by at most WALL_DR (a wall, or
 * the flank of an interior ridge ring). That is what a window cut through a
 * wall looks like. A sill that slices through a floor dish instead leaves the
 * dish's rings as open arcs whose cut edges wander inward across the dish
 * (the C), and a top that slices mid-band through a head does the same upside
 * down; both are reported. Arcs the band shares with a full ring of the
 * upper/lower solid (its own cap rings) merge into closed loops here.
 */
function openRingArcs(glb: Glb, names: string[], threshold = HOLODECK_STYLE.edges.threshold) {
  const WALL_DR = 0.01; // > interior_rings' ridge depth (0.006), far below a dish band's radial run (0.03+)
  const r = (p: number[]) => Math.hypot(p[0], p[2]);
  const az = (p: number[]) => (Math.atan2(p[0], p[2]) * 180) / Math.PI;
  const vkey = (p: number[]) => `${p[1].toFixed(3)}|${r(p).toFixed(3)}|${az(p).toFixed(1)}`;
  const rings = new Map<string, [string, string]>();
  const pos = new Map<string, number[]>();
  const down = new Map<string, number[][]>(); // vertex -> lower ends of its constant-azimuth drawn edges
  for (const name of names) {
    const node = nodeByName(glb.json, name);
    if (!node) throw new Error(`no node ${name}`);
    for (const { a, b } of drawnSegments(glb, node.node, threshold)) {
      const ka = vkey(a);
      const kb = vkey(b);
      pos.set(ka, a);
      pos.set(kb, b);
      const horizontal = Math.abs(a[1] - b[1]) < 1e-4;
      if (horizontal && Math.abs(r(a) - r(b)) < 1e-4 && r(a) > 1e-4 && !sameAzimuth(a, b)) {
        rings.set([ka, kb].sort().join('>'), [ka, kb]);
      } else if (sameAzimuth(a, b) && !horizontal) {
        const [hi, lo] = a[1] > b[1] ? [ka, b] : [kb, a];
        down.set(hi, [...(down.get(hi) ?? []), lo]);
      }
    }
  }
  const adj = new Map<string, Set<string>>();
  for (const [ka, kb] of rings.values()) {
    adj.set(ka, (adj.get(ka) ?? new Set()).add(kb));
    adj.set(kb, (adj.get(kb) ?? new Set()).add(ka));
  }
  const seen = new Set<string>();
  const report: string[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    while (stack.length) {
      const k = stack.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      comp.push(k);
      adj.get(k)!.forEach((n) => stack.push(n));
    }
    const ends = comp.filter((k) => adj.get(k)!.size === 1);
    if (ends.length === 0) continue; // closed ring
    const p0 = pos.get(comp[0])!;
    const bad = ends.filter((k) => {
      const p = pos.get(k)!;
      return !(down.get(k) ?? []).some((q) => Math.abs(r(q) - r(p)) <= WALL_DR);
    });
    if (bad.length) {
      const angles = ends.map((k) => az(pos.get(k)!).toFixed(0)).join('..');
      report.push(`ring r=${r(p0).toFixed(3)} y=${p0[1].toFixed(3)} (arc ${angles} deg) ends without a wall cut edge below at ${bad.map((k) => az(pos.get(k)!).toFixed(0) + ' deg').join(', ')}`);
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

  it('spins a shaft and a 3-blade impeller low in the vessel; nothing else rises above the liquid', () => {
    const ag = nodeByName(gltf, 'anim.agitator')!;
    expect(ag.node.mesh).toBeUndefined();
    const kids = (ag.node.children ?? []).map((i) => gltf.nodes[i].name ?? '').sort();
    // Round 5 (Des): the reference's flat cross bar at y 1.30 read as a stray diagonal above
    // the liquid (at fill 0.5 the surface is at ~0.76), so only the impeller is in the vessel.
    expect(kids).toEqual(['impeller.blade.0', 'impeller.blade.1', 'impeller.blade.2', 'impeller.hub', 'shaft']);
    for (const name of kids) {
      const b = bounds(name);
      if (name === 'shaft') {
        expect(b.max.x - b.min.x).toBeLessThan(0.06); // a needle, not a bar
        expect(b.max.z - b.min.z).toBeLessThan(0.06);
      } else {
        expect(b.max.y, name).toBeLessThan(0.5); // everything but the shaft stays low in the liquid
      }
    }
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
    expect(band.min.y).toBeCloseTo(0.1, 3); // outer sill = the heel's top ring
    expect(band.max.y).toBeCloseTo(1.622, 2); // arched top = the outer head's first ring
    const upper = bounds('shell.upper');
    expect(upper.min.y).toBeCloseTo(1.588, 2); // its cap reaches down to the INNER head's first ring (a cone)
    expect(upper.max.y).toBeCloseTo(1.75, 1);
    expect(Math.max(upper.max.x, upper.max.z)).toBeLessThan(0.38); // only the head cap is left above the window
    const lower = bounds('shell.lower');
    expect(lower.min.y).toBeCloseTo(0, 4);
    expect(lower.max.y).toBeCloseTo(0.22, 3); // up to the dish rim: the whole floor dish is in the lower solid
    // The shell is the mixer iso shade, not plain white; agitator and nozzles are white.
    for (const name of ['shell.upper', 'shell.band', 'shell.lower', 'housing', 'housing.lid', 'housing.collar']) {
      expect(materialOf(name), name).toBe('hd.flask');
    }
    for (const name of ['shaft', 'impeller.hub', 'inlet', 'outlet']) expect(materialOf(name), name).toBe('hd.white');
  });

  it('cuts the window on rings of both profiles: a bevel sill from the heel ring to the dish rim, floor whole', () => {
    // Round 5 (Des): with a flat sill at 0.10 the window sliced through the inner dish
    // (rim 0.22), leaving the rim ring and the dish's first band ring as 260 deg C-shaped
    // arcs whose cut edges hooked inward across the dish. Now the outer cut is the heel ring
    // (0.45, 0.10) and the inner cut the dish rim (0.39, 0.22), joined by a conical bevel.
    // Unique vertex positions (flat shading makes the exporter split every vertex per face).
    const verts = (name: string) => {
      const node = nodeByName(gltf, name)!.node;
      const p = readAccessor(glb, gltf.meshes[node.mesh!].primitives[0].attributes.POSITION) as Float32Array;
      const seen = new Map<string, { r: number; y: number }>();
      for (let i = 0; i < p.length; i += 3) {
        seen.set([p[i], p[i + 1], p[i + 2]].map((v) => v.toFixed(4)).join(','), { r: Math.hypot(p[i], p[i + 2]), y: p[i + 1] });
      }
      return [...seen.values()];
    };
    const band = verts('shell.band');
    // The band's inner surface never goes below the dish rim; its outer bottom is the heel ring.
    for (const v of band.filter((v) => v.r < 0.42)) expect(v.y).toBeGreaterThan(0.22 - 1e-3);
    expect(band.filter((v) => Math.abs(v.y - 0.1) < 1e-3).every((v) => Math.abs(v.r - 0.45) < 1e-3)).toBe(true);
    // ... and at the top it stops on the inner head's first ring (no interpolated inner ring at 1.622).
    expect(band.filter((v) => v.y > 1.59 && v.y < 1.62)).toEqual([]);
    expect(band.some((v) => Math.abs(v.y - 1.5877) < 1e-3 && Math.abs(v.r - 0.3195) < 1e-3)).toBe(true);
    // The lower solid owns the whole dish: a full 18-vertex rim ring at (0.39, 0.22) and the
    // bevel's outer ring at (0.45, 0.10); nothing of it reaches above the rim.
    const lower = verts('shell.lower');
    expect(lower.filter((v) => Math.abs(v.y - 0.22) < 1e-3 && Math.abs(v.r - 0.39) < 1e-3)).toHaveLength(18);
    expect(lower.filter((v) => Math.abs(v.y - 0.1) < 1e-3 && Math.abs(v.r - 0.45) < 1e-3)).toHaveLength(18);
    expect(Math.max(...lower.map((v) => v.y))).toBeCloseTo(0.22, 3);
    // The runtime draws that rim as one CLOSED ring: 18 horizontal segments at (0.39, 0.22).
    const rim = drawnSegments(glb, nodeByName(gltf, 'shell.lower')!.node, HOLODECK_STYLE.edges.threshold).filter(
      ({ a, b }) => Math.abs(a[1] - 0.22) < 1e-3 && Math.abs(b[1] - 0.22) < 1e-3 && Math.abs(Math.hypot(a[0], a[2]) - 0.39) < 1e-3,
    );
    expect(rim).toHaveLength(18);
  });

  it('every drawn ring of the shell closes or ends on a wall cut edge (no open C rings)', () => {
    expect(openRingArcs(glb, ['shell.upper', 'shell.band', 'shell.lower'])).toEqual([]);
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
    // Revolves of `profile` (TOP -> BOTTOM, r > 0 at both ends) with `seg` facets, packed like
    // the exporter writes them (POSITION accessor + uint32 indices), several nodes per GLB. A
    // full revolution is capped; `arc: [a0, a1]` (degrees) builds an OPEN partial band whose
    // boundary (the profile at both cut azimuths, the top and bottom rings) EdgesGeometry draws
    // unconditionally, like a cut face's edges.
    type Probe = { name: string; profile: [number, number][]; seg: number; arc?: [number, number] };
    function probeGlb(parts: Probe[]) {
      const verts: number[] = [];
      const idx: number[] = [];
      const nodes: unknown[] = [];
      const meshes: unknown[] = [];
      const accessors: unknown[] = [];
      const bufferViews: unknown[] = [];
      for (const { name, profile, seg, arc } of parts) {
        const v0 = verts.length / 3;
        const i0 = idx.length;
        const steps = arc ? Math.round(((arc[1] - arc[0]) / 360) * seg) : seg;
        const cols = arc ? steps + 1 : seg;
        const rings: number[][] = [];
        for (const [r, y] of profile) {
          const ring: number[] = [];
          for (let c = 0; c < cols; c++) {
            const th = arc ? ((arc[0] + ((arc[1] - arc[0]) * c) / steps) * Math.PI) / 180 : (c / seg) * Math.PI * 2;
            ring.push(verts.length / 3 - v0);
            verts.push(r * Math.sin(th), y, r * Math.cos(th));
          }
          rings.push(ring);
        }
        for (let i = 0; i + 1 < rings.length; i++) {
          for (let c = 0; c < steps; c++) {
            const c2 = arc ? c + 1 : (c + 1) % seg;
            idx.push(rings[i][c], rings[i + 1][c], rings[i + 1][c2], rings[i][c], rings[i + 1][c2], rings[i][c2]);
          }
        }
        if (!arc) {
          const fan = (ring: number[], flip: boolean) => {
            for (let c = 1; c + 1 < ring.length; c++) idx.push(ring[0], ...(flip ? [ring[c + 1], ring[c]] : [ring[c], ring[c + 1]]));
          };
          fan(rings[0], false); // top cap
          fan(rings[rings.length - 1], true); // bottom cap
        }
        nodes.push({ name, mesh: meshes.length });
        meshes.push({ primitives: [{ attributes: { POSITION: accessors.length }, indices: accessors.length + 1 }] });
        accessors.push({ count: verts.length / 3 - v0, type: 'VEC3', componentType: 5126, bufferView: bufferViews.length });
        accessors.push({ count: idx.length - i0, type: 'SCALAR', componentType: 5125, bufferView: bufferViews.length + 1 });
        bufferViews.push({ buffer: 0, byteOffset: v0 * 12, byteLength: (verts.length / 3 - v0) * 12 });
        bufferViews.push({ buffer: 0, byteOffset: -1, byteLength: (idx.length - i0) * 4, _i0: i0 }); // offset fixed below
      }
      const vbytes = verts.length * 4;
      for (const bv of bufferViews as { byteOffset: number; _i0?: number }[]) {
        if (bv._i0 !== undefined) {
          bv.byteOffset = vbytes + bv._i0 * 4;
          delete bv._i0;
        }
      }
      const bin = new Uint8Array(vbytes + idx.length * 4);
      bin.set(new Uint8Array(new Float32Array(verts).buffer), 0);
      bin.set(new Uint8Array(new Uint32Array(idx).buffer), vbytes);
      const json = {
        asset: { version: '2.0' },
        scenes: [{ nodes: nodes.map((_, i) => i) }],
        nodes,
        meshes,
        accessors,
        bufferViews,
      } as unknown as GltfJson;
      return { json, bin };
    }
    const probeLathe = (profile: [number, number][], seg: number) => probeGlb([{ name: 'probe', profile, seg }]);

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

    it('flags a ring arc whose cut edge runs inward across a curved band below it (a sill through a dish)', () => {
      // A 240 deg wall band (the keep arc of an 18-gon window, on the lathe's facet boundaries)
      // whose profile turns 27 deg inward at y 0.3 and continues down a dish-like band to the
      // sill at (0.40, 0.2); a full floor lathe below closes the band's bottom boundary ring.
      // The crease ring at 0.3 is drawn but open, and from each end the cut edge drops to
      // r 0.40 (dr 0.05 > WALL_DR).
      const bad = probeGlb([
        { name: 'band', profile: [[0.45, 1.0], [0.45, 0.3], [0.4, 0.2]], seg: 18, arc: [100, 340] },
        { name: 'floor', profile: [[0.4, 0.2], [0.4, 0.0]], seg: 18 },
      ]);
      const report = openRingArcs(bad, ['band', 'floor']);
      expect(report).toHaveLength(1);
      expect(report[0]).toContain('y=0.300');
      expect(report[0]).toContain('100 deg');
      expect(report[0]).toContain('-20 deg'); // 340 deg
    });

    it('accepts ring arcs that end on a wall cut edge (ridge rings) and arcs closed by another solid', () => {
      // Same keep arc with an interior ridge ring (apex crease 22.6 deg, drawn; flanks dr 0.006
      // <= WALL_DR) and a straight wall down to (0.45, 0.3), where a full lathe's top cap ring
      // closes the band's bottom arc. The band's top boundary ring ends on the wall cut edge.
      const good = probeGlb([
        { name: 'band', profile: [[0.45, 1.0], [0.45, 0.6], [0.444, 0.57], [0.45, 0.54], [0.45, 0.3]], seg: 18, arc: [100, 340] },
        { name: 'floor', profile: [[0.45, 0.3], [0.45, 0.0]], seg: 18 },
      ]);
      expect(openRingArcs(good, ['band', 'floor'])).toEqual([]);
      // Without the floor the band's bottom arc has nothing below it: reported.
      expect(openRingArcs(good, ['band'])).toHaveLength(1);
      expect(openRingArcs(good, ['band'])[0]).toContain('y=0.300');
    });
  });
});
