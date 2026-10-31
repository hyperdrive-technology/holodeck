import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * Minimal GLB reader for asset tests: header + JSON chunk only (no BIN
 * decoding, no new deps). Bounds come from POSITION accessor min/max,
 * which glTF 2.0 makes mandatory, transformed by each node's world matrix.
 *
 * GLB layout: 12-byte header (magic 'glTF', version 2, total length),
 * then chunks of [u32 length, u32 type, payload]; chunk 0 is JSON.
 */
export type GltfNode = {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  extras?: Record<string, unknown>;
};

export type GltfJson = {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes: { name?: string; nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: { name?: string; doubleSided?: boolean; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors: { count: number; min?: number[]; max?: number[]; type: string; componentType: number; bufferView?: number; byteOffset?: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  cameras?: unknown[];
  extensionsUsed?: string[];
};

const CHUNK_BIN = 0x004e4942; // 'BIN\0'

/** JSON plus the BIN chunk, for tests that need vertex data (edge extraction). */
export function parseGlb(buf: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const json = parseGlbJson(buf);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = view.getUint32(12, true);
  const binHeader = 20 + jsonLen;
  if (binHeader + 8 > buf.byteLength) return { json, bin: new Uint8Array(0) };
  const binLen = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== CHUNK_BIN) throw new Error('second GLB chunk is not BIN');
  return { json, bin: buf.subarray(binHeader + 8, binHeader + 8 + binLen) };
}

const COMPONENT_BYTES: Record<number, number> = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** Tightly packed copy of an accessor's data (the Blender exporter writes unstrided views). */
export function readAccessor(glb: { json: GltfJson; bin: Uint8Array }, index: number): Float32Array | Uint16Array | Uint32Array | Uint8Array {
  const acc = glb.json.accessors[index];
  if (acc.bufferView === undefined) throw new Error(`accessor ${index} has no bufferView`);
  const view = glb.json.bufferViews![acc.bufferView];
  if (view.byteStride) throw new Error(`accessor ${index}: strided buffer views are not supported here`);
  const size = COMPONENT_BYTES[acc.componentType];
  const n = COMPONENTS[acc.type];
  if (!size || !n) throw new Error(`accessor ${index}: unsupported ${acc.type} / ${acc.componentType}`);
  const start = glb.bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const bytes = glb.bin.buffer.slice(start, start + acc.count * n * size);
  switch (acc.componentType) {
    case 5126:
      return new Float32Array(bytes);
    case 5125:
      return new Uint32Array(bytes);
    case 5123:
      return new Uint16Array(bytes);
    default:
      return new Uint8Array(bytes);
  }
}

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

export function parseGlbJson(buf: Uint8Array): GltfJson {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.byteLength < 20) throw new Error('GLB too short');
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB (bad magic)');
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  const total = view.getUint32(8, true);
  if (total !== buf.byteLength) throw new Error(`GLB length ${total} != file ${buf.byteLength}`);
  const len = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) throw new Error('first GLB chunk is not JSON');
  const text = new TextDecoder().decode(buf.subarray(20, 20 + len));
  return JSON.parse(text) as GltfJson;
}

export function localMatrix(node: GltfNode): Matrix4 {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

/** World matrix of every node reachable from the default scene, by index. */
export function worldMatrices(gltf: GltfJson): Map<number, Matrix4> {
  const out = new Map<number, Matrix4>();
  const visit = (i: number, parent: Matrix4) => {
    const m = parent.clone().multiply(localMatrix(gltf.nodes[i]));
    out.set(i, m);
    gltf.nodes[i].children?.forEach((c) => visit(c, m));
  };
  gltf.scenes[gltf.scene ?? 0].nodes.forEach((i) => visit(i, new Matrix4()));
  return out;
}

export function nodeByName(gltf: GltfJson, name: string): { index: number; node: GltfNode } | undefined {
  const index = gltf.nodes.findIndex((n) => n.name === name);
  return index < 0 ? undefined : { index, node: gltf.nodes[index] };
}

/** World-space AABB of one mesh node (accessor box corners transformed). */
export function nodeBounds(gltf: GltfJson, index: number, world = worldMatrices(gltf)): Box3 {
  const node = gltf.nodes[index];
  const box = new Box3();
  if (node.mesh === undefined) return box;
  const m = world.get(index) ?? new Matrix4();
  for (const prim of gltf.meshes[node.mesh].primitives) {
    const acc = gltf.accessors[prim.attributes.POSITION];
    if (!acc.min || !acc.max) throw new Error(`POSITION accessor of ${node.name} lacks min/max`);
    const local = new Box3(new Vector3(...acc.min), new Vector3(...acc.max));
    box.union(local.applyMatrix4(m));
  }
  return box;
}

export function sceneBounds(gltf: GltfJson): Box3 {
  const world = worldMatrices(gltf);
  const box = new Box3();
  for (const i of world.keys()) box.union(nodeBounds(gltf, i, world));
  return box;
}
