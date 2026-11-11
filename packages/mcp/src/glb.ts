/**
 * `part_validate`: does a GLB meet the Blender part contract
 * (`blender/README.md`, "Contract")? Every violation is one line in
 * `problems`, so an agent can fix them all in one pass.
 *
 * Reads the GLB container and its JSON chunk only (no BIN decoding): bounds
 * come from the POSITION accessors' `min` / `max`, which glTF 2.0 makes
 * mandatory, transformed by each node's world matrix; triangle counts come
 * from accessor counts. Same approach as
 * `packages/editor-2.5d-react/src/models/glb-json.ts` (the asset tests), which
 * is not exported from that package. The 4x4 maths is hand-written here
 * (column-major, as glTF stores it) rather than pulling in three.js as a
 * direct dependency of this Node server for a dozen lines of matrix code.
 *
 * Node names: the glTF JSON keeps `port.in` as written. GLTFLoader later
 * strips the `.` (`portin`) and keeps the original in `userData.name`;
 * `findPorts` / `findAnimNodes` read that. This reader sees the JSON names,
 * which are what the contract is written in.
 */

import { FINISH_NAMES, finishForMaterialName } from '@holodeck/editor-2.5d-react';
import { DEFAULT_PART_TRIANGLES, MAX_PART_GLB_BYTES } from './limits';

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'
const TRIANGLES = 4;

/** Contract bounds (mirrors `src/models/models-contract.test.ts` in editor-2.5d-react). */
export const PART_MAX_SIZE = 5;
export const PART_MIN_SIZE = 0.05;
export const PART_MIN_Y = -1;
/** How far the origin (the placement anchor) may sit outside the part's box, as a fraction of its largest side. */
export const ANCHOR_SLACK = 0.1;

export interface GltfNode {
  name?: string;
  mesh?: number;
  camera?: number;
  skin?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  extensions?: Record<string, unknown>;
}

interface GltfJson {
  asset?: { version?: string; generator?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives?: { attributes?: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; doubleSided?: boolean }[];
  accessors?: { count?: number; min?: number[]; max?: number[] }[];
  cameras?: unknown[];
  animations?: unknown[];
  skins?: unknown[];
  images?: unknown[];
  textures?: unknown[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PartStats {
  bytes: number;
  generator: string | null;
  triangles: number;
  nodes: number;
  meshes: number;
  materials: string[];
  ports: string[];
  anims: string[];
  /** World-space box of every mesh (null when there is no geometry). */
  bounds: (Box & { size: [number, number, number] }) | null;
}

export interface PartValidation {
  ok: boolean;
  /** Contract violations: the part must not be installed while any remain. */
  problems: string[];
  /** Worth a look, not a violation (double-sided materials, unused extensions). */
  warnings: string[];
  stats: PartStats | null;
}

export interface ValidateOptions {
  /** Triangle budget (default DEFAULT_PART_TRIANGLES). */
  maxTriangles?: number;
}

/** Split a GLB into its JSON chunk. Throws with a one-line reason on any container error. */
export function parseGlb(bytes: Uint8Array): GltfJson {
  if (bytes.byteLength > MAX_PART_GLB_BYTES) throw new Error(`the GLB is ${bytes.byteLength} bytes, over the ${MAX_PART_GLB_BYTES}-byte limit`);
  if (bytes.byteLength < 20) throw new Error('not a GLB: shorter than its 12-byte header plus one chunk header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB: bad magic (expected "glTF")');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported GLB container version ${version} (expected 2)`);
  const total = view.getUint32(8, true);
  if (total !== bytes.byteLength) throw new Error(`GLB header says ${total} bytes but the file has ${bytes.byteLength}`);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('the first GLB chunk is not JSON');
  if (20 + jsonLength > bytes.byteLength) throw new Error('the JSON chunk runs past the end of the file');
  // A second chunk, when present, must be BIN.
  const next = 20 + jsonLength;
  if (next + 8 <= bytes.byteLength && view.getUint32(next + 4, true) !== CHUNK_BIN) throw new Error('the second GLB chunk is not BIN');
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength)));
  } catch (error) {
    throw new Error(`the JSON chunk does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('the JSON chunk is not an object');
  return json as GltfJson;
}

// --- 4x4 matrices (column-major, like glTF `matrix`) -------------------------

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Translation x rotation (unit quaternion x,y,z,w) x scale, as glTF defines a node's TRS. */
function compose(t: readonly number[], q: readonly number[], s: readonly number[]): Mat4 {
  const [x, y, z, w] = q as [number, number, number, number];
  const [sx, sy, sz] = s as [number, number, number];
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const [xx, xy, xz] = [x * x2, x * y2, x * z2];
  const [yy, yz, zz] = [y * y2, y * z2, z * z2];
  const [wx, wy, wz] = [w * x2, w * y2, w * z2];
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

const isNumbers = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));

function localMatrix(node: GltfNode): Mat4 {
  if (isNumbers(node.matrix, 16)) return node.matrix;
  return compose(
    isNumbers(node.translation, 3) ? node.translation : [0, 0, 0],
    isNumbers(node.rotation, 4) ? node.rotation : [0, 0, 0, 1],
    isNumbers(node.scale, 3) ? node.scale : [1, 1, 1],
  );
}

function transform(m: Mat4, p: readonly number[]): [number, number, number] {
  const [x, y, z] = p as [number, number, number];
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const fmt = (v: readonly number[]) => `(${v.map((n) => round(n)).join(', ')})`;

/**
 * Check a GLB against the part contract. Never throws: a GLB that cannot be
 * read is `ok: false` with the reason as its one problem.
 */
export function validatePartGlb(bytes: Uint8Array, options: ValidateOptions = {}): PartValidation {
  let gltf: GltfJson;
  try {
    gltf = parseGlb(bytes);
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)], warnings: [], stats: null };
  }
  const problems: string[] = [];
  const warnings: string[] = [];
  const budget = options.maxTriangles ?? DEFAULT_PART_TRIANGLES;

  if (gltf.asset?.version !== '2.0') problems.push(`asset.version is ${JSON.stringify(gltf.asset?.version ?? null)}; expected "2.0"`);

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : [];
  const materials = Array.isArray(gltf.materials) ? gltf.materials : [];

  // Materials: by name only, hd.* finishes.
  const allowed = FINISH_NAMES.map((f) => `hd.${f}`).join(', ');
  if (materials.length === 0) problems.push(`no materials: every mesh needs an hd.* material (${allowed})`);
  materials.forEach((m, i) => {
    if (finishForMaterialName(m.name) === null) problems.push(`material ${i} ${JSON.stringify(m.name ?? '')} is not an hd.* finish (${allowed}); the style layer matches materials by name only`);
    if (m.doubleSided) warnings.push(`material ${JSON.stringify(m.name ?? i)} is double-sided: set use_backface_culling=True in Blender (hd.material() does)`);
  });

  // What the contract forbids outright.
  if ((gltf.cameras?.length ?? 0) > 0) problems.push(`${gltf.cameras!.length} camera(s): cameras must not be exported (export_cameras=False)`);
  if ((gltf.animations?.length ?? 0) > 0) problems.push(`${gltf.animations!.length} animation(s): parts are animated at runtime through anim.* pivots, not glTF animations`);
  if ((gltf.skins?.length ?? 0) > 0) problems.push(`${gltf.skins!.length} skin(s): parts are rigid; no skinning`);
  if ((gltf.images?.length ?? 0) > 0 || (gltf.textures?.length ?? 0) > 0) problems.push('textures / images: parts are untextured (the style layer colours them by material name)');
  for (const ext of gltf.extensionsRequired ?? []) problems.push(`extension ${ext} is required: parts must load with no glTF extensions (lights, Draco, ...)`);
  for (const ext of gltf.extensionsUsed ?? []) if (!(gltf.extensionsRequired ?? []).includes(ext)) warnings.push(`extension ${ext} is used: parts normally need none`);

  // Nodes: cameras / lights / skins on nodes, ports and anim pivots.
  const ports: string[] = [];
  const anims: string[] = [];
  nodes.forEach((node, i) => {
    const label = node.name ? JSON.stringify(node.name) : `node ${i}`;
    if (node.camera !== undefined) problems.push(`${label} is a camera`);
    if (node.extensions && 'KHR_lights_punctual' in node.extensions) problems.push(`${label} is a light (KHR_lights_punctual)`);
    else if (node.extensions && Object.keys(node.extensions).length) problems.push(`${label} carries node extensions (${Object.keys(node.extensions).join(', ')})`);
    if (node.skin !== undefined) problems.push(`${label} is skinned`);
    const name = node.name ?? '';
    for (const [prefix, list] of [['port.', ports], ['anim.', anims]] as const) {
      if (!name.startsWith(prefix)) continue;
      const short = name.slice(prefix.length);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(short)) problems.push(`${label}: the name after "${prefix}" must be letters, digits, "-" or "_" (got ${JSON.stringify(short)})`);
      if (list.includes(short)) problems.push(`${label} is declared twice`);
      list.push(short);
      if (node.mesh !== undefined) problems.push(`${label} must be an empty, not a mesh (${prefix === 'port.' ? 'hd.add_port' : 'hd.add_anim'})`);
    }
    if (name.startsWith('port.') && (node.children?.length ?? 0) > 0) problems.push(`${label} must have no children (a port is a point)`);
  });
  if (ports.length === 0) problems.push('no port.* empty: a part needs at least one pipe connection point (hd.add_port)');

  // Geometry: triangles and bounds, from the default scene.
  let triangles = 0;
  meshes.forEach((mesh, mi) => {
    (mesh.primitives ?? []).forEach((prim, pi) => {
      const where = `mesh ${JSON.stringify(mesh.name ?? mi)} primitive ${pi}`;
      if (prim.mode !== undefined && prim.mode !== TRIANGLES) problems.push(`${where}: mode ${prim.mode} (only triangles, mode 4)`);
      if (prim.material === undefined) problems.push(`${where} has no material: it would render with the default material, outside the style layer`);
      const count = prim.indices !== undefined ? accessors[prim.indices]?.count : accessors[prim.attributes?.POSITION ?? -1]?.count;
      if (typeof count !== 'number') problems.push(`${where}: no index or POSITION accessor`);
      else triangles += Math.floor(count / 3);
    });
  });
  if (triangles > budget) problems.push(`${triangles} triangles, over the budget of ${budget}: lower the segment counts`);

  const sceneIndex = gltf.scene ?? 0;
  const roots = gltf.scenes?.[sceneIndex]?.nodes;
  if (!Array.isArray(roots)) problems.push(`no scene ${sceneIndex} with root nodes`);
  let box: Box | null = null;
  const visit = (index: number, parent: Mat4, seen: Set<number>): void => {
    const node = nodes[index];
    if (!node || seen.has(index)) {
      problems.push(node ? `node ${index} is reachable twice (a cycle or a shared child)` : `node ${index} does not exist`);
      return;
    }
    seen.add(index);
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of meshes[node.mesh]?.primitives ?? []) {
        const acc = accessors[prim.attributes?.POSITION ?? -1];
        if (!acc || !isNumbers(acc.min, 3) || !isNumbers(acc.max, 3)) {
          problems.push(`mesh of ${JSON.stringify(node.name ?? index)}: its POSITION accessor lacks min / max (required by glTF)`);
          continue;
        }
        const [lo, hi] = [acc.min, acc.max];
        for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const p = transform(world, [corner & 1 ? hi[0]! : lo[0]!, corner & 2 ? hi[1]! : lo[1]!, corner & 4 ? hi[2]! : lo[2]!]);
          if (!box) box = { min: [...p], max: [...p] };
          else for (let k = 0; k < 3; k++) [box.min[k], box.max[k]] = [Math.min(box.min[k]!, p[k]!), Math.max(box.max[k]!, p[k]!)];
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, seen);
  };
  const seen = new Set<number>();
  for (const root of Array.isArray(roots) ? roots : []) visit(root, IDENTITY, seen);

  let bounds: PartStats['bounds'] = null;
  const found = box as Box | null;
  if (!found) problems.push('no geometry: the scene has no mesh with a readable bounding box');
  else {
    const size = [0, 1, 2].map((k) => found.max[k]! - found.min[k]!) as [number, number, number];
    bounds = { min: found.min.map(round) as Box['min'], max: found.max.map(round) as Box['max'], size: size.map(round) as Box['min'] };
    const largest = Math.max(...size);
    if (largest >= PART_MAX_SIZE) problems.push(`the part is ${round(largest)} units across (max ${PART_MAX_SIZE}): 1 unit = 1 three.js unit; a scale or unit mistake?`);
    if (largest <= PART_MIN_SIZE) problems.push(`the part is only ${round(largest)} units across (min ${PART_MIN_SIZE}): a scale or unit mistake?`);
    if (found.min[1] <= PART_MIN_Y) problems.push(`the part reaches y = ${round(found.min[1])}, below ${PART_MIN_Y}: it should sit on or near the floor (y = 0)`);
    if (found.max[1] <= 0) problems.push(`nothing is above the floor (max y = ${round(found.max[1])}): exported Z-up (export_yup) or upside down?`);
    // Anchor: the origin is the placement point, so it must be on (or right next to) the part.
    const slack = Math.max(ANCHOR_SLACK * largest, 0.01);
    const outside = [0, 1, 2].map((k) => Math.max(found.min[k]! - 0, 0 - found.max[k]!, 0));
    const distance = Math.hypot(...outside);
    if (distance > slack) {
      problems.push(`the origin (the placement anchor) is ${round(distance)} units outside the part's box ${fmt(found.min)}..${fmt(found.max)}: model the part around (0, 0, 0)`);
    }
  }

  const stats: PartStats = {
    bytes: bytes.byteLength,
    generator: gltf.asset?.generator ?? null,
    triangles,
    nodes: nodes.length,
    meshes: meshes.length,
    materials: materials.map((m) => m.name ?? ''),
    ports,
    anims,
    bounds,
  };
  return { ok: problems.length === 0, problems, warnings, stats };
}

/**
 * The footprint (grid units, centred on the origin) and height that just
 * contain `bounds`, for framing a one-part preview (`blender_preview`). Not
 * rounded up to whole cells: the editor fits the view to the footprint, so a
 * tight box frames a small part as large as a big one.
 */
export function footprintOf(bounds: Box): { w: number; h: number; height: number } {
  const half = (k: number) => Math.max(Math.abs(bounds.min[k]!), Math.abs(bounds.max[k]!));
  const side = (n: number) => Math.max(0.1, Math.ceil(2 * n * 100) / 100);
  return { w: side(half(0)), h: side(half(2)), height: Math.max(0.1, Math.ceil(bounds.max[1] * 100) / 100) };
}
