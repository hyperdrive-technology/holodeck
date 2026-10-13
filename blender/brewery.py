"""
Shared helpers for the brewery parts (fermenter, brite-tank, mash-tun,
kettle, heat-exchanger). Lives next to holodeck_bpy.py, NOT in parts/, because
every parts/*.py must produce a GLB (models-contract.test.ts enforces 1:1).

LIQUID CONVENTION (all vessels; the runtime relies on it)
---------------------------------------------------------
`anim.liquid` is an empty whose ORIGIN IS THE BOTTOM OF THE LIQUID VOLUME
(inner bottom of the vessel, on the vessel axis x=z=0). Its child mesh
`liquid` is built for a FULL vessel and extends from local y=0 up to local
y=H (H is the part's inner fill height, documented in each script header).
Fill level L in 0..1  ->  anim.liquid.scale.y = L (x/z stay 1).
Because the origin is at the bottom, scaling Y grows the liquid upward.
Scaling Y=0 degenerates the node: also set `visible=false` at L<=0.
Cone/dish bottoms are scaled along with the rest, so the shape squashes
proportionally rather than filling the cone first; that is a deliberate
trade-off for a single-mesh, single-scale runtime contract.

Materials: only the 5 `hd.*` ones exist. The liquid uses `hd.accent`, so the
host tints it via `applyHolodeckStyle(..., { accent })`. That means NOTHING
ELSE in these parts uses hd.accent (a second accent band would be tinted
too), so the pump-style accent band is deliberately omitted.

The shell is opaque (hd.white), so a fully-internal liquid would be
invisible. The liquid mesh is therefore a narrow pie-slice "sight window"
of the revolved inner profile, outset 0.035 so it pokes through the wall over
a 45 degree arc facing the iso camera (between +X and +Z). Its flat accent
faces are unlit, so it reads as a sight glass filled to the current level.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

SEG = 16  # radial segments on every round part
PIPE_R = 0.07
FLANGE_R = 0.1
FLANGE_T = 0.03
WINDOW_ARC = (math.radians(22.5), math.radians(67.5))
WINDOW_OUTSET = 0.035  # must exceed any jacket/band outset (fermenter jacket = 0.025)


def box(name, size_t, mat, position_t=(0, 0, 0), rotation_t=(0, 0, 0), parent=None):
    """Axis-aligned box (same as pump.py's local helper)."""
    hx, hy, hz = (s / 2.0 for s in size_t)
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6), (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
    return hd._mesh_object(name, verts, faces, mat, position_t, rotation_t, parent)


def _dedupe(face):
    """Drop consecutive duplicate indices (cyclic) so pole quads become tris."""
    out = [i for k, i in enumerate(face) if i != face[k - 1]]
    return tuple(out)


def lathe(name, profile, seg, mat, position_t=(0, 0, 0), parent=None, arc=None, arc_steps=3):
    """Solid of revolution about three-space +Y.

    `profile` is [(r, y), ...] ordered TOP -> BOTTOM. Rings with r == 0 are
    single shared pole vertices. Full revolution: a non-zero first/last r gets
    an n-gon cap. `arc=(a0, a1)` (radians, theta as in hd.cylinder: x=r sin,
    z=r cos) builds a closed pie slice instead; then profile must start and
    end on the axis (r == 0).
    Face winding is fixed afterwards with bmesh.recalc_face_normals so it
    does not depend on getting every orientation right by hand (closed
    manifold meshes only, which all of these are).
    """
    cols = (arc_steps + 1) if arc else seg
    verts, rings = [], []
    for r, y in profile:
        if r <= 1e-9:
            verts.append((0.0, y, 0.0))
            rings.append([len(verts) - 1] * cols)
        else:
            ring = []
            for c in range(cols):
                th = (arc[0] + c / arc_steps * (arc[1] - arc[0])) if arc else c / seg * math.tau
                verts.append((r * math.sin(th), y, r * math.cos(th)))
                ring.append(len(verts) - 1)
            rings.append(ring)
    faces = []
    n_quads = arc_steps if arc else seg
    for a, b in zip(rings, rings[1:]):
        for c in range(n_quads):
            c2 = c + 1 if arc else (c + 1) % seg
            f = _dedupe((a[c], b[c], b[c2], a[c2]))
            if len(f) >= 3:
                faces.append(f)
    if arc:
        assert profile[0][0] == 0 and profile[-1][0] == 0, "arc lathe profile must start/end on the axis"
        faces.append(_dedupe(tuple(ring[0] for ring in rings)))
        faces.append(_dedupe(tuple(ring[-1] for ring in reversed(rings))))
    else:
        if profile[0][0] > 0:
            faces.append(tuple(rings[0]))
        if profile[-1][0] > 0:
            faces.append(tuple(reversed(rings[-1])))
    obj = hd._mesh_object(name, verts, faces, mat, position_t, (0, 0, 0), parent)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def dome_top(radius, y0, height, steps=3):
    """Elliptical head on top of a cylinder ending at y0: pole -> rim (top->bottom)."""
    return [(radius * math.cos(a), y0 + height * math.sin(a))
            for a in (math.pi / 2 * (1 - i / steps) for i in range(steps + 1))][:-1] + [(radius, y0)]


def dish_bottom(radius, y0, height, steps=3):
    """Elliptical head under a cylinder starting at y0: rim -> pole (top->bottom)."""
    return [(radius, y0)] + [(radius * math.cos(a), y0 - height * math.sin(a))
                             for a in (math.pi / 2 * (i / steps) for i in range(1, steps + 1))]


def legs(count, ring_r, top_y, mat, leg_r=0.035, parent=None, start_deg=45.0):
    """`count` round legs on a circle of ring_r, floor to top_y, with foot pads."""
    for i in range(count):
        th = math.radians(start_deg) + i / count * math.tau
        x, z = ring_r * math.sin(th), ring_r * math.cos(th)
        hd.cylinder(f"leg.{i}", leg_r, leg_r, top_y, 6, mat, position_t=(x, top_y / 2, z), parent=parent)
        hd.cylinder(f"leg.{i}.foot", leg_r * 2, leg_r * 2, 0.025, 6, mat, position_t=(x, 0.0125, z), parent=parent)


_AXES = {"+x": ((0, 0, math.pi / 2), (1, 0, 0)), "-x": ((0, 0, math.pi / 2), (-1, 0, 0)),
         "+z": ((math.pi / 2, 0, 0), (0, 0, 1)), "-z": ((math.pi / 2, 0, 0), (0, 0, -1)),
         "+y": ((0, 0, 0), (0, 1, 0)), "-y": ((0, 0, 0), (0, -1, 0))}


def pipe_stub(name, start_t, axis, length, mat, radius=PIPE_R, flange=True):
    """Pipe nozzle from start_t along `axis` ('+x','-z','-y',...) with a flange
    on the free end. Returns the free-end face centre (port position)."""
    rot, d = _AXES[axis]
    c = tuple(s + di * length / 2 for s, di in zip(start_t, d))
    hd.cylinder(name, radius, radius, length, 8, mat, position_t=c, rotation_t=rot)
    end = tuple(s + di * length for s, di in zip(start_t, d))
    if flange:
        fc = tuple(e - di * FLANGE_T / 2 for e, di in zip(end, d))
        hd.cylinder(f"{name}.flange", FLANGE_R, FLANGE_R, FLANGE_T, 8, mat, position_t=fc, rotation_t=rot)
    return end


def liquid_window(inner_profile, y_pivot, mat):
    """Create `anim.liquid` (origin at world y_pivot on the axis) with the
    child pie-slice mesh `liquid`. `inner_profile` is the FULL-vessel inner
    profile [(r, y_world)...] top->bottom starting/ending on the axis; the
    bottom point must be at y_pivot. See the module docstring."""
    pivot = hd.add_anim("liquid", (0, y_pivot, 0))
    local = [((r + WINDOW_OUTSET) if r > 0 else 0.0, y - y_pivot) for r, y in inner_profile]
    win = lathe("liquid", local, SEG, mat, parent=pivot, arc=WINDOW_ARC)
    hd.set_props(win, hd_edges=False)
    return pivot
