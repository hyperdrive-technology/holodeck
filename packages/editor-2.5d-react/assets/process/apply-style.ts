import {
  Color,
  Matrix4,
  Vector3,
  type ColorRepresentation,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import type { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import type { Line2NodeMaterial } from 'three/webgpu';
import { createEdgeLines, createEdgeMaterial } from './edge-lines';
import { createFinishMaterial } from './materials';
import { FINISH_NAMES, HOLODECK_STYLE, type FinishName, type HolodeckStyle } from './style';

/**
 * Apply the Holodeck iso look to any three scene graph (typically a
 * `GLTFLoader` result exported from Blender).
 *
 * Contract shared with the Blender pipeline:
 *
 * | Blender / glTF                         | Here                                          |
 * |----------------------------------------|-----------------------------------------------|
 * | material `hd.white`                    | unlit body white                              |
 * | material `hd.shaded`                   | generic iso shade (ShadedFill defaults)       |
 * | material `hd.vessel`                   | tank iso shade                                |
 * | material `hd.flask`                    | mixer iso shade                               |
 * | material `hd.accent`                   | unlit, source base colour (or `overrides.accent`) |
 * | any other / unnamed material           | white + one console.warn per name             |
 * | extras `hd_edge_threshold: number`     | EdgesGeometry crease angle (degrees)          |
 * | extras `hd_edges: false`               | no outline on that mesh                       |
 * | node `port.<name>` (empty)             | untouched; read with `findPorts`              |
 * | node `anim.<name>`                     | transform untouched; read with `findAnimNodes`|
 *
 * Blender's duplicate suffix is accepted (`hd.white.001` → white). Names
 * are case-sensitive.
 */

export const MATERIAL_PREFIX = 'hd.';
export const PORT_PREFIX = 'port.';
export const ANIM_PREFIX = 'anim.';
/** Name of the outline child `applyHolodeckStyle` adds under each mesh. */
export const EDGE_LINES_NAME = 'hd.edges';

export type ApplyStyleOverrides = {
  /** Colour for every `hd.accent` mesh (e.g. a per-instance handwheel). Beats the source base colour. */
  accent?: ColorRepresentation;
  /**
   * Colour for every `hd.white` (unlit body) mesh, beating `style.finishes.white`.
   * Data-only parts set it from `IsoPartDefinition.colors.body`.
   */
  body?: ColorRepresentation;
  /** Outline colour. Defaults to `style.colors.edge`. */
  edgeColor?: ColorRepresentation;
  /** Outline width in CSS px. Defaults to `style.edges.lineWidth`. */
  lineWidth?: number;
  /** Crease angle for meshes without `hd_edge_threshold`. Defaults to `style.edges.threshold`. */
  threshold?: number;
};

const FINISH_RE = new RegExp(`^hd\\.(${FINISH_NAMES.join('|')})(?:\\.\\d+)?$`);

/** `hd.vessel` / `hd.vessel.001` → `'vessel'`; anything else → `null`. */
export function finishForMaterialName(name: string | undefined | null): FinishName | null {
  const match = name ? FINISH_RE.exec(name) : null;
  return match ? (match[1] as FinishName) : null;
}

const warned = new Set<string>();

/** Warn once per message key for the life of the module (a scene of 50 clones should not spam). */
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  console.warn(message);
}

/** Test hook: forget which unknown material names were already reported. */
export function resetHolodeckStyleWarnings(): void {
  warned.clear();
}

/**
 * The name the author typed. GLTFLoader runs node names through
 * `PropertyBinding.sanitizeNodeName`, which strips `.` (and `[]:/`), so a
 * Blender empty called `port.in` arrives as `object.name === 'portin'`.
 * The loader keeps the original in `userData.name`; read that first.
 * Material names are not sanitized.
 */
export function authoredName(object: Object3D): string {
  const original = object.userData?.name;
  return typeof original === 'string' ? original : object.name;
}

function isLineSegments2(object: Object3D): boolean {
  return (object as { isLineSegments2?: boolean }).isLineSegments2 === true;
}

function isUnderPort(object: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o === root ? null : o.parent) {
    if (authoredName(o).startsWith(PORT_PREFIX)) {
      return true;
    }
  }
  return false;
}

/**
 * Nearest `userData[key]` from the mesh up to `root`. GLTFLoader puts node
 * extras on the node and mesh extras on each primitive mesh; a multi-material
 * Blender object becomes a Group of primitive meshes, so node extras sit one
 * level up. Walking up also lets an empty set `hd_edges: false` for a subtree.
 */
function inheritedUserData(mesh: Object3D, root: Object3D, key: string): unknown {
  for (let o: Object3D | null = mesh; o; o = o === root ? null : o.parent) {
    if (o.userData && key in o.userData) {
      return o.userData[key];
    }
  }
  return undefined;
}

function edgeThresholdFor(mesh: Mesh, root: Object3D, fallback: number): number {
  const raw = inheritedUserData(mesh, root, 'hd_edge_threshold');
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  warnOnce(
    `threshold:${String(raw)}`,
    `applyHolodeckStyle: ignoring hd_edge_threshold ${JSON.stringify(raw)} on "${authoredName(mesh)}" (not a finite number)`,
  );
  return fallback;
}

function edgesDisabled(mesh: Mesh, root: Object3D): boolean {
  const raw = inheritedUserData(mesh, root, 'hd_edges');
  // Older Blender versions store boolean custom properties as ints, so 0 is
  // accepted as "off" too.
  return raw === false || raw === 0;
}

function sourceColor(material: Material): Color | undefined {
  const color = (material as { color?: unknown }).color;
  return color instanceof Color ? color : undefined;
}

/**
 * Style every mesh under `root` in place. Returns a dispose function that
 * frees the materials and outline geometries this call created and removes
 * the outlines. Call it when the part leaves the scene; the meshes keep
 * pointing at the (now disposed) finish materials.
 *
 * - Idempotent: meshes already styled (`userData.hdStyled`) are skipped,
 *   so a second call adds nothing and its dispose frees nothing.
 * - Replaced source materials are disposed once all meshes are swapped.
 *   Their textures are not (finish materials use none); a textured GLB
 *   would need its maps freed by the caller.
 * - Source `side` is kept (Blender "backface culling" off → DoubleSide),
 *   so cutaway shells stay visible from inside.
 * - Meshes sharing a source material share one finish material. A source
 *   that is already a finish material (`userData.hdFinish`) is kept as is.
 * - `port.*` subtrees are skipped entirely. `anim.*` nodes keep their
 *   transform; meshes under (or at) them are styled like any other.
 * - InstancedMesh / SkinnedMesh get the finish but no outline: a child
 *   LineSegments2 would draw once at the base transform / bind pose.
 */
export function applyHolodeckStyle(
  root: Object3D,
  style: HolodeckStyle = HOLODECK_STYLE,
  overrides: ApplyStyleOverrides = {},
): () => void {
  const meshes: Mesh[] = [];
  // Collect first, mutate after: adding outline children mid-traverse would
  // walk into them (LineSegments2 is a Mesh).
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || isLineSegments2(mesh) || mesh.userData.hdStyled) {
      return;
    }
    if (isUnderPort(mesh, root)) {
      return;
    }
    meshes.push(mesh);
  });

  const created = new Map<Material, Material>();
  const lines: LineSegments2[] = [];
  let edgeMaterial: Line2NodeMaterial | null = null;
  const defaultThreshold = overrides.threshold ?? style.edges.threshold;
  const accentOverride = overrides.accent !== undefined ? new Color(overrides.accent) : undefined;
  const bodyOverride = overrides.body !== undefined ? new Color(overrides.body) : undefined;

  const finishFor = (source: Material): Material => {
    const existing = created.get(source);
    if (existing) {
      return existing;
    }
    // Already a finish material (code-built part, or an earlier pass whose
    // mesh flag was cleared): keep it, and do not dispose it — we don't own it.
    if (source.userData?.hdFinish !== undefined) {
      return source;
    }
    let finish = finishForMaterialName(source.name);
    if (!finish) {
      const label = source.name || '(unnamed)';
      warnOnce(
        `material:${label}`,
        `applyHolodeckStyle: material "${label}" is not one of ${FINISH_NAMES.map((n) => MATERIAL_PREFIX + n).join(', ')}; using hd.white`,
      );
      finish = 'white';
    }
    const color =
      finish === 'accent' ? (accentOverride ?? sourceColor(source)) : finish === 'white' ? bodyOverride : undefined;
    const material = createFinishMaterial(finish, { style, color, side: source.side });
    created.set(source, material);
    return material;
  };

  for (const mesh of meshes) {
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(finishFor)
      : finishFor(mesh.material);
    mesh.userData.hdStyled = true;

    // `mesh.type` is 'Mesh' on InstancedMesh in r186, so test the flags.
    const kind =
      (mesh as { isInstancedMesh?: boolean }).isInstancedMesh === true
        ? 'InstancedMesh'
        : (mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh === true
          ? 'SkinnedMesh'
          : null;
    if (kind) {
      warnOnce(
        `edges-skip:${kind}`,
        `applyHolodeckStyle: no outline on ${kind} "${authoredName(mesh)}" (child edges would not follow instances / bones)`,
      );
      continue;
    }
    if (edgesDisabled(mesh, root) || mesh.children.some((c) => c.name === EDGE_LINES_NAME)) {
      continue;
    }
    edgeMaterial ??= createEdgeMaterial({
      color: overrides.edgeColor ?? style.colors.edge,
      lineWidth: overrides.lineWidth ?? style.edges.lineWidth,
    });
    const line = createEdgeLines(mesh.geometry, {
      threshold: edgeThresholdFor(mesh, root, defaultThreshold),
      material: edgeMaterial,
    });
    line.name = EDGE_LINES_NAME;
    mesh.add(line);
    lines.push(line);
  }

  for (const source of created.keys()) {
    source.dispose();
  }

  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    for (const line of lines) {
      line.removeFromParent();
      line.geometry.dispose();
    }
    edgeMaterial?.dispose();
    for (const material of created.values()) {
      material.dispose();
    }
    for (const mesh of meshes) {
      delete mesh.userData.hdStyled;
    }
  };
}

/**
 * `port.*` node positions in `root`'s local space (not world): a part's
 * pipe connection points relative to its own origin, independent of where
 * the part is placed. Keys are the authored names (`'port.in'`). A
 * duplicate authored name keeps the first node and warns.
 */
export function findPorts(root: Object3D): Record<string, Vector3> {
  root.updateWorldMatrix(true, true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const ports: Record<string, Vector3> = {};
  root.traverse((object) => {
    const name = authoredName(object);
    if (object === root || !name.startsWith(PORT_PREFIX)) {
      return;
    }
    if (name in ports) {
      warnOnce(`port:${name}`, `findPorts: duplicate port "${name}"; keeping the first`);
      return;
    }
    ports[name] = new Vector3().setFromMatrixPosition(object.matrixWorld).applyMatrix4(toRoot);
  });
  return ports;
}

/** `anim.*` nodes by authored name (`'anim.impeller'`). First wins on duplicates. */
export function findAnimNodes(root: Object3D): Record<string, Object3D> {
  const nodes: Record<string, Object3D> = {};
  root.traverse((object) => {
    const name = authoredName(object);
    if (object === root || !name.startsWith(ANIM_PREFIX)) {
      return;
    }
    if (name in nodes) {
      warnOnce(`anim:${name}`, `findAnimNodes: duplicate anim node "${name}"; keeping the first`);
      return;
    }
    nodes[name] = object;
  });
  return nodes;
}
