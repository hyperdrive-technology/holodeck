/**
 * Compare a freshly rebuilt GLB with the committed one (holodeck#136).
 *
 *   const r = compareGlb(rebuilt, committed);
 *   r.identical  // byte-for-byte equal
 *   r.problems   // [] = equal up to float noise; otherwise what differs
 *
 * Why not bytes only: the GLBs are authored on macOS (arm64) and the CI drift
 * job runs Blender on Linux (x86-64). Both produce identical vertex buffers,
 * but Blender's matrix -> quaternion decomposition of node rotations rounds
 * differently on the two platforms: a 45 deg turn exports w = 0.9238795042 on
 * one and 0.9238795638 on the other (1 float32 ULP); seen on cdn, valve and
 * fermenter (2026-10-21, Blender 5.2.2, reproduced in a linux/amd64 container).
 * Snapping or computing the rotation in Python does not help, the exporter
 * decomposes the object matrix itself. So the check is:
 *
 *   - the BIN chunk (all geometry) must be byte-identical, and
 *   - the JSON chunk must be structurally identical, with every number within
 *     `eps` (default 1e-6 absolute; a float32 ULP near 1 is 1.2e-7).
 *
 * Real drift (an edited script whose GLB was not rebuilt) moves geometry or
 * names far more than that.
 */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** `{ json, bin }` of a GLB 2.0 buffer; throws on anything else. */
export function splitGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== GLB_MAGIC || buf.readUInt32LE(4) !== 2) throw new Error('not a GLB 2.0 file');
  let json;
  let bin = Buffer.alloc(0);
  for (let at = 12; at + 8 <= buf.length; ) {
    const length = buf.readUInt32LE(at);
    const type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + length);
    if (type === CHUNK_JSON) json = JSON.parse(body.toString('utf8'));
    else if (type === CHUNK_BIN) bin = body;
    at += 8 + length;
  }
  if (json === undefined) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

function diffJson(a, b, path, eps, out) {
  if (out.length >= 20) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(Math.abs(a - b) <= eps)) out.push(`${path}: ${a} != ${b}`);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} != ${JSON.stringify(b)?.slice(0, 80)}`);
      return;
    }
    a.forEach((v, i) => diffJson(v, b[i], `${path}[${i}]`, eps, out));
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const k of keys) {
      if (!(k in a) || !(k in b)) out.push(`${path}.${k}: only in ${k in a ? 'rebuilt' : 'committed'}`);
      else diffJson(a[k], b[k], `${path}.${k}`, eps, out);
    }
    return;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

export function compareGlb(rebuilt, committed, { eps = 1e-6 } = {}) {
  if (rebuilt.equals(committed)) return { identical: true, problems: [] };
  const a = splitGlb(rebuilt);
  const b = splitGlb(committed);
  const problems = [];
  if (!a.bin.equals(b.bin)) problems.push(`BIN chunk differs (${a.bin.length} vs ${b.bin.length} bytes): geometry changed`);
  diffJson(a.json, b.json, '$', eps, problems);
  return { identical: false, problems };
}
