"""
Holodeck Blender helpers — shared by every `parts/*.py` script.

Blender owns SHAPE only. White fill, iso shading and #666 outlines are
applied at runtime by material NAME (`hd.white`, `hd.shaded`, ...), so
nothing here sets up lighting, textures or edge rendering for export.

Coordinate convention (important, discovered by checking the exporter):
  * Blender is Z-up, right-handed. three.js / glTF is Y-up, right-handed.
  * The glTF exporter with `export_yup=True` (the default) maps a Blender
    point (x, y, z) to glTF (x, z, -y). Equivalently three (X, Y, Z) lives
    at Blender (X, -Z, Y).
  * Part scripts are ported from R3F code, so the builders below take
    positions, Euler rotations and primitive axes in **three.js space**
    (`*_t` arguments) and convert once via `T2B`. A cylinder built here
    along three's +Y lands on Blender +Z and exports back along glTF +Y.
  * Vertices are generated with the same parametrisation as three.js's
    SphereGeometry / CylinderGeometry / TorusGeometry (same start angle and
    winding of segments), so facets line up 1:1 with the hand-coded parts
    instead of being rotated by half a segment. Seam/pole duplicates that
    three emits for UVs are welded; caps are n-gons (the exporter
    triangulates). With flat shading this renders identically.

Determinism: run Blender with `--factory-startup` (scripts/build-parts.mjs
does) so user prefs / add-ons cannot change exporter defaults, and always
start from `reset_scene()`.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from typing import Iterable, Sequence

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------
# Axis conversion
# --------------------------------------------------------------------------

# Change of basis three.js -> Blender: b = T2B @ t, i.e. (x, y, z) -> (x, -z, y).
T2B = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0)))
B2T = T2B.transposed()  # orthonormal, so inverse == transpose

Vec3 = Sequence[float]


def t2b(v: Vec3) -> Vector:
    """Convert a three.js-space point/direction to Blender space."""
    return T2B @ Vector(v)


def three_euler_matrix(euler_xyz: Vec3) -> Matrix:
    """three.js Euler (default order 'XYZ') -> 3x3 rotation in three space.

    three's 'XYZ' order means the matrix is Rx @ Ry @ Rz (intrinsic X then
    Y then Z), i.e. a vector is rotated by Z first, then Y, then X.
    """
    rx, ry, rz = euler_xyz
    return (
        Matrix.Rotation(rx, 3, "X")
        @ Matrix.Rotation(ry, 3, "Y")
        @ Matrix.Rotation(rz, 3, "Z")
    )


def three_matrix(position_t: Vec3 = (0, 0, 0), rotation_t: Vec3 = (0, 0, 0)) -> Matrix:
    """4x4 Blender-space local matrix equivalent to an R3F position/rotation."""
    rot_b = T2B @ three_euler_matrix(rotation_t) @ B2T
    m = rot_b.to_4x4()
    m.translation = t2b(position_t)
    return m


# --------------------------------------------------------------------------
# Scene + materials
# --------------------------------------------------------------------------

HD_MATERIALS = ("hd.white", "hd.shaded", "hd.vessel", "hd.flask", "hd.accent", "hd.liquid")


def reset_scene() -> None:
    """Start from an empty file: no default cube, camera or light."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Orphan data from the factory file would otherwise keep names like
    # "Material" alive and suffix ours (.001) — purge to be safe.
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.objects):
        for item in list(coll):
            coll.remove(item)


def srgb_to_linear(c: float) -> float:
    """glTF baseColorFactor (and Blender's Base Color socket) are LINEAR.

    three.js GLTFLoader keeps them linear in its working colour space, so
    `material.color.getHexString()` gives back the sRGB hex we started with.
    """
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(hex_color: str) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


def material(name: str, color: str = "#ffffff", alpha: float = 1.0) -> bpy.types.Material:
    """Get or create an `hd.*` material. Only `hd.accent`'s colour matters
    to the runtime (it is the default accent); others are placeholders.
    `hd.liquid` is the runtime's translucent liquid finish (style.ts
    `liquidFinish`, opacity 0.62, colour from the style, edges drawn);
    `alpha < 1` here only makes the Workbench PREVIEW translucent (and lands
    in the GLB as alphaMode BLEND, which the style layer ignores)."""
    if name not in HD_MATERIALS:
        raise ValueError(f"material {name!r} is not part of the hd.* contract {HD_MATERIALS}")
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    rgba = hex_to_linear_rgba(color)
    if alpha < 1.0:
        rgba = (rgba[0], rgba[1], rgba[2], alpha)
        # Blender 4.2+ EEVEE/Workbench transparency switch; older name kept for safety.
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
    mat.diffuse_color = rgba
    # Without this the exporter writes `doubleSided: true` (found by
    # inspecting the GLB). Parts are closed solids -> single-sided like
    # three's default FrontSide.
    mat.use_backface_culling = True
    # Blender 5.x: new materials always have a node tree with a Principled
    # BSDF (verified in 5.2.2); the exporter reads Base Color from it.
    bsdf = mat.node_tree.nodes.get("Principled BSDF") if mat.node_tree else None
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 1.0
        bsdf.inputs["Metallic"].default_value = 0.0
        if alpha < 1.0:
            bsdf.inputs["Alpha"].default_value = alpha
    return mat


# --------------------------------------------------------------------------
# Mesh builders (three.js parametrisation, three.js-space inputs)
# --------------------------------------------------------------------------


def _mesh_object(
    name: str,
    verts_t: Iterable[Vec3],
    faces: list[tuple[int, ...]],
    mat: bpy.types.Material,
    position_t: Vec3,
    rotation_t: Vec3,
    parent: bpy.types.Object | None,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(t2b(v)) for v in verts_t], [], faces)
    mesh.validate()
    # Flat shading so the runtime's angle-based edge detection sees real
    # facets. (Blender 4.1+ removed mesh auto-smooth; flat faces are enough.)
    for poly in mesh.polygons:
        poly.use_smooth = False
    mesh.materials.append(mat)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    # matrix_basis is relative to the parent (parent inverse stays identity).
    obj.matrix_basis = three_matrix(position_t, rotation_t)
    return obj


def cylinder(
    name: str,
    radius_top: float,
    radius_bottom: float,
    height: float,
    radial_segments: int,
    mat: bpy.types.Material,
    position_t: Vec3 = (0, 0, 0),
    rotation_t: Vec3 = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    """three.js `CylinderGeometry(rTop, rBottom, height, radial)` — axis +Y,
    first vertex at theta=0 -> (0, y, r) i.e. +Z, capped both ends."""
    n = radial_segments
    half = height / 2.0
    verts: list[Vec3] = []
    for r, y in ((radius_top, half), (radius_bottom, -half)):
        for i in range(n):
            th = i / n * math.tau
            verts.append((r * math.sin(th), y, r * math.cos(th)))
    faces: list[tuple[int, ...]] = []
    for i in range(n):
        j = (i + 1) % n
        # top i, bottom i, bottom j, top j — CCW seen from outside.
        faces.append((i, n + i, n + j, j))
    faces.append(tuple(range(n)))  # top cap (+Y), CCW from above
    faces.append(tuple(n + i for i in reversed(range(n))))  # bottom cap
    return _mesh_object(name, verts, faces, mat, position_t, rotation_t, parent)


def uv_sphere(
    name: str,
    radius: float,
    width_segments: int,
    height_segments: int,
    mat: bpy.types.Material,
    position_t: Vec3 = (0, 0, 0),
    rotation_t: Vec3 = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    """three.js `SphereGeometry(r, widthSegs, heightSegs)` — poles on ±Y,
    vertex = (-r cos(phi) sin(theta), r cos(theta), r sin(phi) sin(theta))."""
    w, h = width_segments, height_segments
    verts: list[Vec3] = [(0.0, radius, 0.0)]  # top pole
    for iy in range(1, h):
        th = iy / h * math.pi
        for ix in range(w):
            ph = ix / w * math.tau
            verts.append(
                (-radius * math.cos(ph) * math.sin(th), radius * math.cos(th), radius * math.sin(ph) * math.sin(th))
            )
    bottom = len(verts)
    verts.append((0.0, -radius, 0.0))

    def ring(iy: int, ix: int) -> int:  # iy in 1..h-1
        return 1 + (iy - 1) * w + (ix % w)

    faces: list[tuple[int, ...]] = []
    for ix in range(w):
        faces.append((0, ring(1, ix), ring(1, ix + 1)))
    for iy in range(1, h - 1):
        for ix in range(w):
            faces.append((ring(iy, ix), ring(iy + 1, ix), ring(iy + 1, ix + 1), ring(iy, ix + 1)))
    for ix in range(w):
        faces.append((ring(h - 1, ix), bottom, ring(h - 1, ix + 1)))
    return _mesh_object(name, verts, faces, mat, position_t, rotation_t, parent)


def torus(
    name: str,
    radius: float,
    tube: float,
    radial_segments: int,
    tubular_segments: int,
    mat: bpy.types.Material,
    position_t: Vec3 = (0, 0, 0),
    rotation_t: Vec3 = (0, 0, 0),
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    """three.js `TorusGeometry(radius, tube, radialSegs, tubularSegs)` — ring
    in the XY plane (axis +Z); radialSegs go round the tube, tubularSegs
    round the ring. Rotate [pi/2, 0, 0] for a horizontal wheel."""
    rs, ts = radial_segments, tubular_segments
    verts: list[Vec3] = []
    for j in range(rs):
        v = j / rs * math.tau
        for i in range(ts):
            u = i / ts * math.tau
            verts.append(((radius + tube * math.cos(v)) * math.cos(u), (radius + tube * math.cos(v)) * math.sin(u), tube * math.sin(v)))

    def idx(j: int, i: int) -> int:
        return (j % rs) * ts + (i % ts)

    faces = [(idx(j, i), idx(j, i + 1), idx(j + 1, i + 1), idx(j + 1, i)) for j in range(rs) for i in range(ts)]
    return _mesh_object(name, verts, faces, mat, position_t, rotation_t, parent)


# --------------------------------------------------------------------------
# Empties, parenting, custom props
# --------------------------------------------------------------------------


def empty(
    name: str,
    position_t: Vec3 = (0, 0, 0),
    rotation_t: Vec3 = (0, 0, 0),
    parent: bpy.types.Object | None = None,
    display: str = "PLAIN_AXES",
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = display
    obj.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    obj.matrix_basis = three_matrix(position_t, rotation_t)
    return obj


def add_port(name: str, position_t: Vec3, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    """Pipe connection point -> glTF node `port.<name>`."""
    return empty(f"port.{name}", position_t, parent=parent, display="SPHERE")


def add_anim(name: str, position_t: Vec3, parent: bpy.types.Object | None = None) -> bpy.types.Object:
    """Animated sub-assembly pivot -> glTF node `anim.<name>`. Parent the
    moving meshes to it with positions RELATIVE to the pivot."""
    return empty(f"anim.{name}", position_t, parent=parent, display="ARROWS")


def parent_to(child: bpy.types.Object, parent: bpy.types.Object, keep_world: bool = True) -> None:
    world = child.matrix_world.copy()
    child.parent = parent
    if keep_world:
        child.matrix_basis = parent.matrix_world.inverted() @ world


def set_props(obj: bpy.types.Object, **props: object) -> None:
    """Object custom properties -> glTF node `extras` (export_extras=True).
    Contract keys: `hd_edge_threshold` (float deg), `hd_edges` (bool)."""
    allowed = {"hd_edge_threshold", "hd_edges"}
    for key, value in props.items():
        if key not in allowed:
            raise ValueError(f"unknown hd custom prop {key!r}; allowed: {sorted(allowed)}")
        obj[key] = value


# --------------------------------------------------------------------------
# Export + preview
# --------------------------------------------------------------------------

# Exporter flags verified against Blender 5.2.2 LTS by printing
# `bpy.ops.export_scene.gltf.get_rna_type().properties` headless. Notes:
#  * `export_format` is a dynamic enum (its items list is empty when
#    introspected) but 'GLB' is accepted.
#  * Defaults there: export_yup=True, export_apply=False, export_extras=False,
#    export_cameras=False, export_lights=False, export_texcoords=True.
#    We pin every flag we care about explicitly so a future default change
#    cannot silently alter the asset.
GLTF_EXPORT_FLAGS = dict(
    export_format="GLB",
    export_yup=True,  # Blender Z-up -> glTF Y-up
    export_apply=True,  # apply modifiers
    export_extras=True,  # custom props -> node extras
    export_materials="EXPORT",
    export_normals=True,
    export_texcoords=False,  # no textures; UVs are dead weight
    export_tangents=False,
    export_attributes=False,
    export_vertex_color="NONE",
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_skins=False,
    export_morph=False,
    use_selection=False,
    use_visible=False,
    export_draco_mesh_compression_enable=False,
    export_image_format="NONE",
    check_existing=False,
)


def export_glb(path: str) -> None:
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for obj in bpy.data.objects:
        if obj.type in {"CAMERA", "LIGHT"}:
            raise RuntimeError(f"{obj.name}: cameras/lights must not be in a part export")
        if obj.type == "MESH":
            for slot in obj.material_slots:
                if slot.material is None or slot.material.name not in HD_MATERIALS:
                    raise RuntimeError(f"{obj.name}: material {slot.material and slot.material.name!r} is not hd.*")
    result = bpy.ops.export_scene.gltf(filepath=path, **GLTF_EXPORT_FLAGS)
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {result}")
    print(f"[holodeck] wrote {path} ({os.path.getsize(path)} bytes)")


def render_preview(path: str, resolution: int = 640) -> None:
    """Workbench render from an iso-ish orthographic camera. Call AFTER
    export_glb — it adds a camera, which must never be exported."""
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_object_outline = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("preview")
    cam_data = bpy.data.cameras.new("preview")
    cam_data.type = "ORTHO"
    meshes = [o for o in scene.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = (lo + hi) / 2
    cam_data.ortho_scale = (hi - lo).length * 1.15
    cam = bpy.data.objects.new("preview.camera", cam_data)
    scene.collection.objects.link(cam)
    # Classic iso: 35.264 deg elevation, 45 deg azimuth (Blender Z-up).
    direction = Vector((1.0, -1.0, math.tan(math.radians(35.264)) * math.sqrt(2))).normalized()
    cam.location = center + direction * 10
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    print(f"[holodeck] preview {path}")


def run_part(build, default_name: str) -> None:
    """Entry point for part scripts. Args after Blender's `--`:
    `--out <file.glb>` (required) and optional `--preview <file.png>`."""
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog=f"parts/{default_name}.py")
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview")
    args = ap.parse_args(argv)
    reset_scene()
    build()
    export_glb(args.out)
    if args.preview:
        render_preview(args.preview)
