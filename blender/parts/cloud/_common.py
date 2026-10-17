"""Small geometry vocabulary for the cloud archetypes (all inputs Y-up).

The scripts own geometry only. Two semantic materials let the runtime theme
recolour the whole family. Explicit segments, flat normals and no UVs keep
the exports compact and reproducible under Blender's factory settings.
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import bmesh
import bpy
from mathutils import Matrix

import holodeck_bpy as hd


def materials():
    return hd.material("hd.white"), hd.material("hd.accent", "#6d8fbd")


def mesh(name, verts, faces, mat, position=(0, 0, 0), rotation=(0, 0, 0)):
    obj = hd._mesh_object(name, verts, faces, mat, position, rotation, None)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    for face in obj.data.polygons:
        face.use_smooth = False
    hd.set_props(obj, hd_edge_threshold=30.0)
    return obj


def bevel(obj, width, segments=2):
    """Small baked corner radii; two facets retain the illustrated look."""
    if width:
        modifier = obj.modifiers.new("corner-radius", "BEVEL")
        modifier.width = width
        modifier.segments = segments
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(30)
        modifier.affect = "EDGES"
        modifier.use_clamp_overlap = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for face in obj.data.polygons:
        face.use_smooth = False
    return obj


def box(name, size, mat, position=(0, 0, 0), radius=0.035, rotation=(0, 0, 0)):
    x, y, z = (v / 2 for v in size)
    verts = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
             (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6),
             (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
    return bevel(mesh(name, verts, faces, mat, position, rotation), radius)


def lathe(name, profile, mat, segments=20, position=(0, 0, 0),
          scale_x=1, scale_z=1, angle=0):
    """Closed stacked rings; profile is [(height, radius), ...] bottom-up.

    Flat caps are deliberate: a logo always has a real horizontal surface,
    including on the head of the user archetype.
    """
    verts = [(r * math.sin(i * math.tau / segments + angle) * scale_x, y,
              r * math.cos(i * math.tau / segments + angle) * scale_z)
             for y, r in profile for i in range(segments)]
    faces = [tuple(reversed(range(segments)))]
    for row in range(len(profile) - 1):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((row * segments + i, row * segments + j,
                          (row + 1) * segments + j, (row + 1) * segments + i))
    faces.append(tuple((len(profile) - 1) * segments + i for i in range(segments)))
    return mesh(name, verts, faces, mat, position)


def disc(name, radius, bottom, top, mat, edge=0.025, segments=20,
         scale_x=1, scale_z=1, angle=0, position=(0, 0, 0)):
    edge = min(edge, (top - bottom) / 3)
    return lathe(name, [(bottom, radius - edge), (bottom + edge, radius),
                        (top - edge, radius), (top, radius - edge)], mat,
                 segments, position=position, scale_x=scale_x,
                 scale_z=scale_z, angle=angle)


def place(obj, position, rotation=(0, 0, 0)):
    """Move a finished piece (three.js position and Euler XYZ rotation)."""
    obj.matrix_basis = hd.three_matrix(position, rotation)
    return obj


def plate(name, points_xy, thickness, mat, z, radius=0.0):
    """An outlined face extruded along Z, useful for generic pictograms."""
    n = len(points_xy)
    verts = [(x, y, z - thickness / 2) for x, y in points_xy]
    verts += [(x, y, z + thickness / 2) for x, y in points_xy]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return bevel(mesh(name, verts, faces, mat), radius)


def ring(name, radius, tube, radial_segments, tubular_segments, mat,
         position=(0, 0, 0), rotation=(0, 0, 0)):
    """Faceted torus in the XY plane (axis +Z), three.js parametrisation.

    Same vertex order as `hd.torus`, but routed through `mesh()` so normals
    are recalculated and the edge threshold is set like every other piece.
    """
    rs, ts = radial_segments, tubular_segments
    verts = []
    for j in range(rs):
        v = j / rs * math.tau
        for i in range(ts):
            u = i / ts * math.tau
            verts.append(((radius + tube * math.cos(v)) * math.cos(u),
                          (radius + tube * math.cos(v)) * math.sin(u),
                          tube * math.sin(v)))

    def idx(j, i):
        return (j % rs) * ts + (i % ts)

    faces = [(idx(j, i), idx(j, i + 1), idx(j + 1, i + 1), idx(j + 1, i))
             for j in range(rs) for i in range(ts)]
    return mesh(name, verts, faces, mat, position, rotation)


def polygon(n, radius, angle=0.0):
    """Regular n-gon outline for `plate`, counter-clockwise from `angle`."""
    return [(radius * math.cos(i * math.tau / n + angle),
             radius * math.sin(i * math.tau / n + angle)) for i in range(n)]


def stroke(points_xy, width):
    """Thick polyline as a closed polygon, for bold pictogram traces.

    Each vertex is offset perpendicular to the local direction; the two
    offset chains joined end-to-end form the outline `plate` extrudes.
    """
    half = width / 2
    left, right = [], []
    for i, (x, y) in enumerate(points_xy):
        x0, y0 = points_xy[max(i - 1, 0)]
        x1, y1 = points_xy[min(i + 1, len(points_xy) - 1)]
        length = math.hypot(x1 - x0, y1 - y0) or 1.0
        nx, ny = -(y1 - y0) / length, (x1 - x0) / length
        left.append((x + nx * half, y + ny * half))
        right.append((x - nx * half, y - ny * half))
    return left + list(reversed(right))


def logo(height, size, x=0, z=0, rotation=(0, 0, 0)):
    """Exactly one marker, centered on a flat face; size is in three X/Z.

    Conjugating the scale avoids swapping logo depth with its Y scale when
    Blender converts the empty back to glTF's Y-up coordinate system.
    The renderer supplies its own tiny depth offset, so this is on the face.

    `rotation` (three.js Euler XYZ) turns the whole marker: its local +Y is
    the face normal and its local X/Z scale stays the square edge. The
    billboard uses (pi/2, 0, 0) so the slot faces +Z on the upright sign.
    """
    obj = hd.empty("logo", (x, height, z))
    scale_t = Matrix.Diagonal((size, 1.0, size))
    obj.matrix_basis = hd.three_matrix((x, height, z), rotation) @ (
        hd.T2B @ scale_t @ hd.B2T).to_4x4()
    return obj
