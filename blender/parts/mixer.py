"""
Agitated mixing vessel, Arcentry-style cutaway -> assets/models/mixer.glb

Reference: the central mixer in packages/editor-2.5d-react/tests/snapshots/
reference.jpg: a slim tall bottle with faceted vertical wall panels, a rounded
shoulder into a low dome, a squat cylindrical motor housing on the apex, a
needle shaft down to a small 3-blade impeller low in the liquid, and a wide
cutaway window on the camera side showing the inner back wall (horizontal
ring lines), the wall thickness at the cut, and the liquid.

Three.js space, Y up, origin = floor centre under the axis. R 0.45, ~1.96 tall.
Flat base (no legs; `SUPPORT = "pads"` adds the two small side pads the
reference tanks have). Wall 0..1.45 (rounded heel 0..0.10), shoulder
1.45..1.58 (R -> 0.37), dome 1.58..1.72, motor housing 1.66..1.93, lid to 1.96.

Cutaway: the window is the front 90 deg (theta 0..90 deg as in hd.cylinder,
i.e. between +Z and +X, centred on the iso camera at yaw pi/4), cut through the
straight wall only (y 0.14..1.45). It is modelled as real thick-walled
geometry, not a double-sided open surface (the material contract is
single-sided): three closed solids, `shell.upper` (shoulder + dome, 360 deg,
hollow, shaft hole at the apex), `shell.band` (the windowed wall, a 270 deg
keep-arc with planar cut faces) and `shell.lower` (heel + floor, 360 deg,
hollow). So the cut faces, the window sill and the inner back wall are all
front-facing geometry the style layer shades and outlines like any other.
Inner back-wall ring lines are shallow ridges in the band's inner profile:
their apex crease (~22 deg) is above the default 15 deg edge threshold, their
feet (~11 deg) below it, so each ring draws as one line.

Empties
  port.in        (0, 1.25, -0.60)  -Z upper side inlet nozzle (back-right in iso)
  port.out       (-0.60, 0.22, 0)  -X low side outlet nozzle (back-left in iso);
                                   the base is flat so a downward nozzle has no room
  anim.agitator  (0, 1.72, 0)      spins about Y. Children: shaft, impeller.hub,
                                   impeller.blade.0..2 (pitched 3-blade propeller
                                   at y 0.32, hub r 0.045, tip-to-tip 0.35)
  anim.liquid    (0, 0.06, 0)      liquid origin = inner floor
Liquid convention (brewery.py): child mesh `liquid` spans local y 0..1.39 when
full, hd.accent, OUTLINED (hd_edges on, see build); runtime sets anim.liquid.scale.y = fill 0..1.
Unlike the opaque-shell vessels the liquid is NOT an outset sight-window pie
slice: it is the full inner volume cut by the same two radial planes as the
wall (a 270 deg keep-arc). hd.accent is opaque in the style layer, so a full
revolution would hide the shaft and impeller at any realistic fill; cutting
the contents along the wall's planes is standard cutaway-drawing practice and
keeps the impeller visible. If a translucent liquid finish is added at
runtime, set LIQUID_ARC to None for a full revolution.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bmesh  # noqa: E402
import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

# --- shell -----------------------------------------------------------------
R = 0.45  # outer wall radius (slim: ~2.2 tall per diameter like the reference)
T = 0.06  # wall thickness; reads as the light cut faces either side of the window
R_IN = R - T
HEEL = 0.10  # outer bottom corner radius (reference heel is rounded, no legs)
HEEL_IN = HEEL - T
Y_W0 = 0.14  # window sill (must be >= HEEL so the band is a straight cylinder)
Y_WALL1 = 1.45  # top of the straight wall = window top = shoulder start
SH_H = 0.13  # shoulder height (cosine ease R -> R_D, as the procedural mixer)
R_D = 0.37  # dome equator radius (0.82 R, MIXER_SHOULDER_RATIO 0.18)
DOME_H = 0.14
Y_SH1 = Y_WALL1 + SH_H
Y_APEX = Y_SH1 + DOME_H  # 1.72
HOLE_R = 0.06  # shaft hole through the dome apex (hidden under the housing)
# --- motor housing on the apex ------------------------------------------------
HOUSING_R, HOUSING_H = 0.23, 0.27
HOUSING_Y0 = Y_APEX - 0.06  # sunk into the dome so its rim meets the curve
LID_R, LID_H = 0.245, 0.03
HOUSING_SEG = 12
Y_TOP = HOUSING_Y0 + HOUSING_H + LID_H  # 1.96
# --- window / keep arc ----------------------------------------------------------
# theta as in hd.cylinder (x = r sin, z = r cos). Camera sits at theta 45 deg.
KEEP_ARC = (math.pi / 2, math.tau)  # the 270 deg of wall that stays
KEEP_STEPS = 12  # 22.5 deg per step so the cut lands on the 16-gon facets
RING_YS = (0.35, 0.55, 0.75, 0.95, 1.15, 1.35)  # inner back-wall ring lines
RING_DEPTH, RING_HALF_H = 0.006, 0.03  # ridge apex crease = 2*atan(0.2) ~ 22.6 deg
# --- liquid ---------------------------------------------------------------------
Y_LIQ0 = T  # inner floor
LIQ_H = Y_WALL1 - T  # 1.39, full = up to the shoulder
R_LIQ = R_IN - 0.01
LIQUID_ARC = KEEP_ARC  # None -> full revolution (needs a translucent runtime finish)
# --- agitator ---------------------------------------------------------------------
SHAFT_R = 0.025
Y_IMP = 0.32  # impeller hub centre; "near the bottom" (0.26 above the inner floor)
HUB_R, HUB_H = 0.045, 0.07
BLADE_LEN, BLADE_H, BLADE_T = 0.14, 0.05, 0.012  # radial, tall, thick
BLADE_PITCH = math.radians(35.0)
BLADE_YAW0 = math.pi / 6  # one blade across the window, like the procedural mixer
# --- ports ----------------------------------------------------------------------
PORT_IN_Y, PORT_OUT_Y = 1.25, 0.22
NOZZLE_LEN = 0.17
# --- optional support -----------------------------------------------------------
SUPPORT = "none"  # "none" (reference mixer) | "pads" (two side pads like the tanks)
PAD_SIZE = (0.12, 0.26, 0.12)
# Dev-only: HD_MIXER_PREVIEW_FILL=0.52 scales anim.liquid so the parts page /
# preview shows a part-filled vessel (the reference is ~52%). It is baked into
# the GLB, so never commit one built with it set (the rebuild check in
# valve-glb.test.ts runs without it and would fail on the byte diff).
PREVIEW_FILL = float(os.environ.get("HD_MIXER_PREVIEW_FILL", "1"))


def sweep(name, loop, seg, mat, arc=None, arc_steps=None, parent=None):
    """Revolve a CLOSED polygon `loop` [(r, y), ...] about three-space +Y.

    Unlike brewery.lathe (an open profile closed by caps on the axis), the
    loop is the wall's cross-section, so a full revolution gives a hollow
    closed solid (outer + inner surface joined at the loop's end segments)
    and `arc` gives a closed wedge with the polygon itself as the two planar
    cut faces. Points with r == 0 become single shared pole vertices; a loop
    edge lying on the axis sweeps to nothing and is dropped. Winding is fixed
    with bmesh.recalc_face_normals (closed manifold meshes only).
    Candidate for brewery.py once a second part needs it.
    """
    cols = (arc_steps + 1) if arc else seg
    verts, rings = [], []
    for r, y in loop:
        if r <= 1e-9:
            verts.append((0.0, y, 0.0))
            rings.append([len(verts) - 1] * cols)
            continue
        ring = []
        for c in range(cols):
            th = (arc[0] + c / arc_steps * (arc[1] - arc[0])) if arc else c / seg * math.tau
            verts.append((r * math.sin(th), y, r * math.cos(th)))
            ring.append(len(verts) - 1)
        rings.append(ring)
    faces = []
    n_quads = arc_steps if arc else seg
    for i, a in enumerate(rings):
        nxt = rings[(i + 1) % len(rings)]
        for c in range(n_quads):
            c2 = c + 1 if arc else (c + 1) % seg
            f = b._dedupe((a[c], nxt[c], nxt[c2], a[c2]))
            if len(f) >= 3:
                faces.append(f)
    if arc:
        faces.append(b._dedupe(tuple(ring[0] for ring in rings)))
        faces.append(b._dedupe(tuple(ring[-1] for ring in reversed(rings))))
    obj = hd._mesh_object(name, verts, faces, mat, (0, 0, 0), (0, 0, 0), parent)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def shoulder(r0, r1, y0, y1, steps):
    """Cosine-eased radius change (bottleShoulderEase in tank-params.ts), excluding the start point."""
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        e = (1 - math.cos(math.pi * t)) / 2
        pts.append((r0 + (r1 - r0) * e, y0 + (y1 - y0) * t))
    return pts


def dome(rd, y0, h, hole_r, steps):
    """Elliptical head from the equator (excluded) up to the ring at r == hole_r."""
    a1 = math.acos(hole_r / rd)
    return [(rd * math.cos(a), y0 + h * math.sin(a)) for a in (a1 * i / steps for i in range(1, steps + 1))]


def corner(r_wall, rc, y0, steps):
    """Quarter-round bottom corner from (r_wall, y0 + rc) down to (r_wall - rc, y0), inclusive."""
    pts = []
    for i in range(steps + 1):
        a = math.pi / 2 * i / steps
        pts.append((r_wall - rc + rc * math.cos(a), y0 + rc - rc * math.sin(a)))
    return pts


_BOX_FACES = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6), (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]


def blade(name, yaw, mat, parent, y_local):
    """One propeller blade: a thin box along +X from the hub, pitched about its own
    radial axis, then yawed about Y. The yaw-after-pitch order is not an R3F
    'XYZ' Euler, so the vertices are rotated here instead of via rotation_t."""
    hx, hy, hz = BLADE_LEN / 2, BLADE_H / 2, BLADE_T / 2
    cx = HUB_R + BLADE_LEN / 2 - 0.01  # overlaps into the hub
    cp, sp, cy, sy = math.cos(BLADE_PITCH), math.sin(BLADE_PITCH), math.cos(yaw), math.sin(yaw)
    verts = []
    for sx, sy_, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
        x, y, z = sx * hx + cx, sy_ * hy, sz * hz
        y, z = cp * y - sp * z, sp * y + cp * z  # pitch about X
        x, z = cy * x + sy * z, -sy * x + cy * z  # yaw about Y (three.js convention)
        verts.append((x, y, z))
    return hd._mesh_object(name, verts, _BOX_FACES, mat, (0, y_local, 0), (0, 0, 0), parent)


def build() -> None:
    flask = hd.material("hd.flask")
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.accent", "#18bae6")

    # Shoulder + dome: hollow 360 deg solid with the shaft hole at the apex.
    outer = [(R, Y_WALL1)] + shoulder(R, R_D, Y_WALL1, Y_SH1, 4) + dome(R_D, Y_SH1, DOME_H, HOLE_R, 4)
    inner = [(R_IN, Y_WALL1)] + shoulder(R_IN, R_D - T, Y_WALL1, Y_SH1, 4) + dome(R_D - T, Y_SH1, DOME_H - T, HOLE_R, 4)
    sweep("shell.upper", outer + list(reversed(inner)), b.SEG, flask)

    # Windowed wall band: 270 deg keep-arc, ridges on the inner face for the ring lines.
    band = [(R, Y_WALL1), (R, Y_W0), (R_IN, Y_W0)]
    for y in RING_YS:
        band += [(R_IN, y - RING_HALF_H), (R_IN - RING_DEPTH, y), (R_IN, y + RING_HALF_H)]
    band.append((R_IN, Y_WALL1))
    sweep("shell.band", band, b.SEG, flask, arc=KEEP_ARC, arc_steps=KEEP_STEPS)

    # Heel + floor: hollow 360 deg solid, closed on the axis top and bottom.
    lower = [(R, Y_W0)] + corner(R, HEEL, 0.0, 3) + [(0.0, 0.0), (0.0, T)]
    lower += list(reversed(corner(R_IN, HEEL_IN, T, 2))) + [(R_IN, Y_W0)]
    sweep("shell.lower", lower, b.SEG, flask)

    # Motor housing: squat 12-gon on the apex, vertex-on to the camera, with a lid rim.
    yaw = math.pi / HOUSING_SEG
    hd.cylinder("housing", HOUSING_R, HOUSING_R, HOUSING_H, HOUSING_SEG, flask,
                position_t=(0, HOUSING_Y0 + HOUSING_H / 2, 0), rotation_t=(0, yaw, 0))
    hd.cylinder("housing.lid", LID_R, LID_R, LID_H, HOUSING_SEG, flask,
                position_t=(0, HOUSING_Y0 + HOUSING_H + LID_H / 2, 0), rotation_t=(0, yaw, 0))

    # Nozzles on the back quadrants so they never cross the window.
    hd.add_port("in", b.pipe_stub("inlet", (0, PORT_IN_Y, -R + 0.02), "-z", NOZZLE_LEN, white))
    hd.add_port("out", b.pipe_stub("outlet", (-R + 0.02, PORT_OUT_Y, 0), "-x", NOZZLE_LEN, white))

    # Agitator: shaft from inside the housing down to the impeller, all under one pivot.
    ag = hd.add_anim("agitator", (0, Y_APEX, 0))
    shaft_bot, shaft_top = Y_IMP - HUB_H / 2, HOUSING_Y0 + HOUSING_H / 2
    hd.cylinder("shaft", SHAFT_R, SHAFT_R, shaft_top - shaft_bot, 8, white,
                position_t=(0, (shaft_top + shaft_bot) / 2 - Y_APEX, 0), parent=ag)
    hd.cylinder("impeller.hub", HUB_R, HUB_R, HUB_H, 8, white, position_t=(0, Y_IMP - Y_APEX, 0), parent=ag)
    for i in range(3):
        blade(f"impeller.blade.{i}", BLADE_YAW0 + i * math.tau / 3, white, ag, Y_IMP - Y_APEX)

    if SUPPORT == "pads":
        # Screen-left / screen-right of the base in iso (theta 315 / 135 deg).
        for th in (math.radians(315.0), math.radians(135.0)):
            rr = R + PAD_SIZE[0] / 2 - 0.03
            b.box(f"pad.{int(math.degrees(th))}", PAD_SIZE, flask,
                  position_t=(rr * math.sin(th), PAD_SIZE[1] / 2, rr * math.cos(th)), rotation_t=(0, th, 0))

    # Liquid: inner volume, cut by the window's planes (see module docstring).
    pivot = hd.add_anim("liquid", (0, Y_LIQ0, 0))
    liq = [(0.0, LIQ_H), (R_LIQ, LIQ_H), (R_LIQ, HEEL_IN)] + corner(R_LIQ, HEEL_IN, 0.0, 2)[1:] + [(0.0, 0.0)]
    liquid = b.lathe("liquid", liq, b.SEG, liquid_mat, parent=pivot,
                     arc=LIQUID_ARC, arc_steps=KEEP_STEPS if LIQUID_ARC else 3)
    # Outlined, unlike the sight-window vessels: the cut faces and the level
    # are planar unlit accent, so without edges the notch reads as one flat
    # slab. The reference liquid is drawn with wire lines too.
    hd.set_props(liquid, hd_edges=True)
    if PREVIEW_FILL != 1:
        pivot.scale = (1.0, 1.0, PREVIEW_FILL)  # Blender Z = three Y


if __name__ == "__main__":
    hd.run_part(build, "mixer")
