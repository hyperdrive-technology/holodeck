"""Process-family geometry in three.js space (Y up, one unit per grid cell).

Shape only: material names and crease hints hand appearance to the runtime.
Keep dimensions explicit, moving geometry local to its anim pivot, and ports
on mating faces. No modifiers, random inputs, textures or UVs are required.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import bmesh
import bpy
from mathutils import Vector

import holodeck_bpy as hd

# pipe-math.ts: PIPE_RADIUS and pipeWorldY(). Inline models use local Y=0;
# placement adds PIPE_Y. Floor models use PIPE_Y directly for low pipe axes.
PIPE_R = 0.2
PIPE_Y = 0.32
# valve-geometry.ts: VALVE_FLANGE_R / VALVE_FLANGE_LEN. The pipe stub collar
# is slightly different (0.2 * 1.32, 0.07); these are equipment mating flanges.
FLANGE_R = PIPE_R * 1.35
FLANGE_T = 0.05
SEG = 12
SMALL_SEG = 8
PIPE_SEG = 6
EPS = 1e-5

# Positive local Y must map to the positive target axis. In particular,
# rotation Z=+pi/2 points it toward -X; using -pi/2 keeps tapered ends honest.
AXIS_ROTATION = {"X": (0, 0, -math.pi / 2), "Y": (0, 0, 0), "Z": (math.pi / 2, 0, 0)}


def materials(accent="#2e6fb7"):
    return {
        "white": hd.material("hd.white"),
        "shaded": hd.material("hd.shaded", "#b8c0c6"),
        "accent": hd.material("hd.accent", accent),
    }


def edges(obj, threshold=40.0, enabled=True):
    """Thin 12-sided pieces retain cap creases without 12 longitudinal lines."""
    hd.set_props(obj, hd_edge_threshold=float(threshold), hd_edges=enabled)
    return obj


def mesh(name, vertices, faces, mat, position=(0, 0, 0), rotation=(0, 0, 0), parent=None):
    obj = hd._mesh_object(name, vertices, faces, mat, position, rotation, parent)
    # The family also uses concave extruded saddle profiles. As in cloud's
    # mesh helper, recalculate outward normals before glTF triangulates them.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return edges(obj, 15)


def box(name, size, mat, position=(0, 0, 0), rotation=(0, 0, 0), parent=None):
    x, y, z = (v / 2 for v in size)
    vertices = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
                (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6),
             (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
    return mesh(name, vertices, faces, mat, position, rotation, parent)


def cylinder(name, start, end, radius, mat, radius_end=None, segments=SEG, parent=None):
    """Capped cylinder/cone between axis-aligned points, including -X/-Y/-Z.

    Points are relative to parent when supplied; radius_end belongs to end,
    regardless of direction. Reject diagonal stubs instead of silently moving
    their ports off the mating face.
    """
    a, b = Vector(start), Vector(end)
    delta = b - a
    axes = [i for i in range(3) if abs(delta[i]) > EPS]
    if len(axes) != 1:
        raise ValueError(f"{name}: cylinder endpoints must differ along one axis")
    i = axes[0]
    r_end = radius if radius_end is None else radius_end
    r_top, r_bottom = (r_end, radius) if delta[i] > 0 else (radius, r_end)
    # Main casings retain facet creases like pipe/valve geometry. Only thin
    # collars suppress the 30-degree side facets; Workbench's studio shading
    # can otherwise hide the absence of these edges in the runtime's white fill.
    return edges(hd.cylinder(name, r_top, r_bottom, abs(delta[i]), segments, mat,
                            position_t=(a + b) / 2,
                            rotation_t=AXIS_ROTATION["XYZ"[i]], parent=parent), 15)


def x_cylinder(name, x0, x1, radius, mat, y=0, z=0, **kwargs):
    return cylinder(name, (x0, y, z), (x1, y, z), radius, mat, **kwargs)


def y_cylinder(name, y0, y1, radius, mat, x=0, z=0, **kwargs):
    return cylinder(name, (x, y0, z), (x, y1, z), radius, mat, **kwargs)


def z_cylinder(name, z0, z1, radius, mat, x=0, y=0, **kwargs):
    return cylinder(name, (x, y, z0), (x, y, z1), radius, mat, **kwargs)


def lathe(name, profile, mat, axis="Y", position=(0, 0, 0), segments=SEG, parent=None):
    """Closed faceted revolved profile: increasing (axis coordinate, radius).

    Zero-radius tips use one vertex, avoiding collapsed quads at dished heads.
    """
    if len(profile) < 2 or any(b[0] <= a[0] for a, b in zip(profile, profile[1:])):
        raise ValueError(f"{name}: profile coordinates must increase")
    vertices, rings, faces = [], [], []
    for height, radius in profile:
        if radius < 0:
            raise ValueError(f"{name}: negative radius")
        count = segments if radius else 1
        ring = list(range(len(vertices), len(vertices) + count))
        rings.append(ring)
        vertices.extend((radius * math.sin(i * math.tau / segments), height,
                         radius * math.cos(i * math.tau / segments)) for i in range(count))
    if len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    for lower, upper in zip(rings, rings[1:]):
        if len(lower) == len(upper) == 1:
            raise ValueError(f"{name}: consecutive zero-radius rings")
        for i in range(segments):
            j = (i + 1) % segments
            if len(lower) == 1:
                faces.append((lower[0], upper[j], upper[i]))
            elif len(upper) == 1:
                faces.append((lower[i], lower[j], upper[0]))
            else:
                faces.append((lower[i], lower[j], upper[j], upper[i]))
    if len(rings[-1]) > 1:
        faces.append(tuple(rings[-1]))
    return mesh(name, vertices, faces, mat, position, AXIS_ROTATION[axis], parent)


def flange(name, face, direction, mat, radius=FLANGE_R, thickness=FLANGE_T):
    """Outer face is exactly face; the solid extends inward by thickness."""
    normal = Vector(direction)
    if abs(normal.length - 1) > EPS:
        raise ValueError(f"{name}: flange direction must be a unit axis")
    return edges(cylinder(name, Vector(face) - normal * thickness, face, radius, mat), 40)


def nozzle(name, base, face, mat, radius=PIPE_R, flange_radius=FLANGE_R,
           thickness=FLANGE_T, segments=SEG):
    """Stub + mating flange + one named connection on the outward face."""
    a, b = Vector(base), Vector(face)
    if (b - a).length <= thickness:
        raise ValueError(f"{name}: nozzle needs room for its flange")
    normal = (b - a).normalized()
    cylinder(f"{name}.stub", a, b - normal * (thickness / 2), radius, mat, segments=segments)
    flange(f"{name}.flange", face, normal, mat, flange_radius, thickness)
    return hd.add_port(name, face)


def plinth(name, width, depth, height, mat, x=0, z=0):
    return box(name, (width, height, depth), mat, (x, height / 2, z))


def feet(name, mat, length=0.61, spread=0.205):
    """Two floor-contact rails with short bearing webs for a small motor."""
    for i, z in enumerate((-spread, spread)):
        plinth(f"{name}.{i}.pad", length, 0.16, 0.055, mat, x=-0.035, z=z)
        box(f"{name}.{i}.web", (length - 0.11, 0.14, 0.10), mat,
            (-0.035, 0.12, math.copysign(0.17, z)))


def saddle(name, x, axis_y, radius, mat, width=0.20, depth=0.86):
    """Concave support cradles a horizontal X-axis shell; foot rests on Y=0."""
    plinth(f"{name}.foot", width + 0.12, depth, 0.06, mat, x=x)
    outline = [(0.05, -depth * 0.44), (0.05, depth * 0.44)]
    outline += [(axis_y - radius * math.cos(math.radians(a)),
                 radius * math.sin(math.radians(a))) for a in (70, 45, 0, -45, -70)]
    n = len(outline)
    vertices = [(side * width / 2, y, z) for side in (-1, 1) for y, z in outline]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return mesh(name, vertices, faces, mat, (x, 0, 0))


def check(*, kind, footprint, height, ports=(), anim=(), length=None, y_min=0):
    """Fail before export on a broken placement, material or node contract.

    footprint is (X, Z), centered on the origin; height is the complete
    vertical envelope starting at y_min. Inline ports are in LOCAL Y=0.
    ports/anim may be name sequences or mappings to required positions.
    """
    if kind not in {"inline", "floor", "mounted"}:
        raise ValueError(f"unknown part kind: {kind}")
    if min(*footprint, height) <= 0:
        raise ValueError("footprint and height must be positive")
    if kind == "floor" and any(abs(n - round(n)) > EPS for n in footprint):
        raise ValueError("floor footprints must use whole grid cells")
    bpy.context.view_layer.update()
    objects = list(bpy.context.scene.objects)
    meshes = [o for o in objects if o.type == "MESH"]
    if not meshes:
        raise ValueError("part has no geometry")
    points, triangles = [], 0
    for obj in objects:
        if obj.type not in {"MESH", "EMPTY"}:
            raise ValueError(f"{obj.name}: parts must contain only meshes and empties")
    for obj in meshes:
        if obj.modifiers:
            raise ValueError(f"{obj.name}: bake modifiers before checking bounds")
        if not obj.data.materials or any(m is None or m.name not in hd.HD_MATERIALS for m in obj.data.materials):
            raise ValueError(f"{obj.name}: material outside the hd.* contract")
        points.extend(hd.B2T @ (obj.matrix_world @ v.co) for v in obj.data.vertices)
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    if any(not math.isfinite(v) for p in points for v in p):
        raise ValueError("non-finite mesh coordinates")
    low = tuple(min(p[i] for p in points) for i in range(3))
    high = tuple(max(p[i] for p in points) for i in range(3))
    allowed_low = (-footprint[0] / 2, y_min, -footprint[1] / 2)
    allowed_high = (footprint[0] / 2, y_min + height, footprint[1] / 2)
    if any(low[i] < allowed_low[i] - EPS or high[i] > allowed_high[i] + EPS for i in range(3)):
        raise ValueError(f"bounds {low} .. {high} exceed {allowed_low} .. {allowed_high}")
    if kind in {"floor", "mounted"} and abs(low[1]) > EPS:
        raise ValueError(f"{kind} part must start at Y=0, got {low[1]}")
    if triangles >= 3000:
        raise ValueError(f"triangle budget exceeded: {triangles} >= 3000")
    for prefix, expected in (("port.", ports), ("anim.", anim)):
        found = {o.name[len(prefix):]: o for o in objects if o.name.startswith(prefix)}
        if set(found) != set(expected):
            raise ValueError(f"{prefix} nodes: expected {sorted(expected)}, got {sorted(found)}")
        for name, obj in found.items():
            if obj.type != "EMPTY":
                raise ValueError(f"{obj.name}: contract node must be an empty")
            if hasattr(expected, "items"):
                actual = hd.B2T @ obj.matrix_world.translation
                if (actual - Vector(expected[name])).length > EPS:
                    raise ValueError(f"{obj.name}: position {tuple(actual)} != {expected[name]}")
            if prefix == "anim." and not any(c.type == "MESH" for c in obj.children_recursive):
                raise ValueError(f"{obj.name}: animation pivot has no moving meshes")
    if kind == "inline":
        if length is None or length <= 0 or abs(length * 2 - round(length * 2)) > EPS:
            raise ValueError("inline body length must be a positive multiple of 0.5")
        for name, sign in (("in", -1), ("out", 1)):
            obj = bpy.data.objects.get(f"port.{name}")
            target = Vector((sign * length / 2, 0, 0))
            if obj is None or (hd.B2T @ obj.matrix_world.translation - target).length > EPS:
                raise ValueError(f"port.{name}: must be at {tuple(target)} on the local pipe axis")
    print(f"[process] {kind}: {triangles} triangles; bounds {low} .. {high}")

