"""
Reusable vessel primitives for parts/*.py, on top of holodeck_bpy (hd).
Lives next to holodeck_bpy.py and brewery.py, NOT in parts/, because every
parts/*.py must produce a GLB (models-contract.test.ts enforces 1:1).

Everything is in three.js space (Y up) with the hd.cylinder theta convention
(x = r sin theta, z = r cos theta; the iso camera sits at theta = pi/4).
Profiles are [(r, y), ...] ordered TOP -> BOTTOM like brewery.lathe.

  lathe(...)              solid of revolution of an open profile (moved here from
                          brewery.py; brewery re-exports it unchanged)
  sweep(...)              revolve a CLOSED cross-section polygon: hollow shells,
                          wedges with planar cut faces; self-checks the solid
  split_profile(...)      cut a profile at a height (interpolates a point)
  cutaway_shell(...)      thick-walled vessel with a window: three closed solids
  interior_rings(...)     ridge profile points that outline as ring lines
  ellipse_head(...)       elliptical head profile with a hole at the apex
  round_corner(...)       quarter-round corner profile (heels, dish rims)
  nozzle_with_flange(...) slim pipe stub + flange ring; returns the port point
  impeller(...)           hub + pitched blades under an anim pivot
  liquid_volume(...)      full-revolution liquid lathe under anim.liquid

`theta0` rotates the facet boundaries so a window can be centred on the camera
with any segment count (18 segments + theta0 = -5 deg puts boundaries at -5 deg
and 95 deg, a 100 deg window centred on 45 deg).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import holodeck_bpy as hd  # noqa: E402


def _dedupe(face):
    """Drop consecutive duplicate indices (cyclic) so pole quads become tris."""
    out = [i for k, i in enumerate(face) if i != face[k - 1]]
    return tuple(out)


def _ring_theta(c, seg, arc, arc_steps, theta0):
    if arc:
        return arc[0] + c / arc_steps * (arc[1] - arc[0])
    return theta0 + c / seg * math.tau


def _recalc(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def lathe(name, profile, seg, mat, position_t=(0, 0, 0), parent=None, arc=None, arc_steps=3, theta0=0.0):
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
                th = _ring_theta(c, seg, arc, arc_steps, theta0)
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
    _recalc(obj)
    return obj


def sweep(name, loop, seg, mat, arc=None, arc_steps=None, parent=None, theta0=0.0):
    """Revolve a CLOSED polygon `loop` [(r, y), ...] about three-space +Y.

    Unlike `lathe` (an open profile closed by caps on the axis), the loop is a
    wall's cross-section, so a full revolution gives a hollow closed solid
    (outer + inner surface joined by the loop's end segments) and `arc` gives
    a closed wedge with the polygon itself as the two planar cut faces.
    Points with r == 0 become single shared pole vertices; a loop edge lying
    on the axis sweeps to nothing and is dropped. Winding is made consistent
    with bmesh.recalc_face_normals, then the solid is checked: it must be
    manifold with positive signed volume. Materials are single-sided, so an
    inside-out shell would silently render as its own interior (culled walls,
    no outlines on interior ridges) instead of failing.
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
            th = _ring_theta(c, seg, arc, arc_steps, theta0)
            verts.append((r * math.sin(th), y, r * math.cos(th)))
            ring.append(len(verts) - 1)
        rings.append(ring)
    faces = []
    n_quads = arc_steps if arc else seg
    for i, a in enumerate(rings):
        nxt = rings[(i + 1) % len(rings)]
        for c in range(n_quads):
            c2 = c + 1 if arc else (c + 1) % seg
            f = _dedupe((a[c], nxt[c], nxt[c2], a[c2]))
            if len(f) >= 3:
                faces.append(f)
    if arc:
        faces.append(_dedupe(tuple(ring[0] for ring in rings)))
        faces.append(_dedupe(tuple(ring[-1] for ring in reversed(rings))))
    obj = hd._mesh_object(name, verts, faces, mat, (0, 0, 0), (0, 0, 0), parent)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    vol = bm.calc_volume(signed=True)
    if vol <= 0 or any(not e.is_manifold for e in bm.edges):
        raise RuntimeError(f"{name}: sweep is not a closed outward solid (signed volume {vol:.5f})")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def split_profile(profile, y_cut):
    """Split a TOP -> BOTTOM profile (non-increasing y) at `y_cut`.

    Returns (above, below): `above` ends and `below` starts with the point on
    the profile at y_cut (interpolated unless a profile point is already
    there), so both halves share that boundary ring.
    """
    for i in range(len(profile) - 1):
        (r0, y0), (r1, y1) = profile[i], profile[i + 1]
        if abs(y0 - y_cut) < 1e-9:
            return list(profile[: i + 1]), list(profile[i:])
        if y0 > y_cut > y1:
            t = (y0 - y_cut) / (y0 - y1)
            p = (r0 + (r1 - r0) * t, y_cut)
            return list(profile[: i + 1]) + [p], [p] + list(profile[i + 1 :])
    if abs(profile[-1][1] - y_cut) < 1e-9:
        return list(profile), [profile[-1]]
    raise ValueError(f"y={y_cut} is outside the profile's y range")


def cutaway_shell(prefix, outer, inner, window, window_y, seg, mat, theta0=0.0):
    """Thick-walled vessel of revolution with a cutaway window, as three CLOSED solids.

    `outer` / `inner` are the full outer and inner surface profiles TOP ->
    BOTTOM (start at the apex hole or pole, end on the bottom pole/hole).
    `window=(a0, a1)` is the removed arc (radians, hd.cylinder theta) and
    `window_y=(y0, y1)` its sill and top. Result, named f"{prefix}.upper"
    (360 deg above y1), f"{prefix}.band" (the keep-arc between y0 and y1,
    with planar cut faces that follow the wall profile, e.g. up into a
    shoulder) and f"{prefix}.lower" (360 deg below y0). The window edges
    must land on facet boundaries: (a0 - theta0) and (a1 - a0) must be
    multiples of 2*pi/seg. Materials are single-sided, so this is how a
    cutaway stays a valid solid: cut faces, sill and the inner back wall are
    all real front-facing geometry.
    """
    a0, a1 = window
    y0, y1 = window_y
    step = math.tau / seg
    k0 = (a0 - theta0) / step
    n_win = (a1 - a0) / step
    if abs(k0 - round(k0)) > 1e-6 or abs(n_win - round(n_win)) > 1e-6:
        raise ValueError(f"window {math.degrees(a0):.1f}..{math.degrees(a1):.1f} deg must align with the "
                         f"{seg}-gon facets at theta0 {math.degrees(theta0):.1f} deg")
    keep = (a1, a0 + math.tau)
    keep_steps = seg - int(round(n_win))
    o_up, o_rest = split_profile(outer, y1)
    o_mid, o_low = split_profile(o_rest, y0)
    i_up, i_rest = split_profile(inner, y1)
    i_mid, i_low = split_profile(i_rest, y0)
    return {
        "upper": sweep(f"{prefix}.upper", o_up + list(reversed(i_up)), seg, mat, theta0=theta0),
        "band": sweep(f"{prefix}.band", o_mid + list(reversed(i_mid)), seg, mat, arc=keep, arc_steps=keep_steps),
        "lower": sweep(f"{prefix}.lower", o_low + list(reversed(i_low)), seg, mat, theta0=theta0),
    }


def interior_rings(r_in, ys, depth=0.006, half_h=0.03):
    """Inner-wall profile points (TOP -> BOTTOM) for horizontal ring lines.

    Each ring is a shallow ridge protruding into the cavity: its apex crease
    is 2*atan(depth/half_h) (22.6 deg at the defaults, above the 15 deg edge
    threshold -> one line) while its feet are half that (below it -> no line).
    Splice between the straight-wall points of an inner profile.
    """
    pts = []
    for y in sorted(ys, reverse=True):
        pts += [(r_in, y + half_h), (r_in - depth, y), (r_in, y - half_h)]
    return pts


def ellipse_head(r, y0, h, hole_r, steps):
    """Elliptical head TOP -> BOTTOM: from the ring at r == hole_r (apex hole)
    down to the equator (r, y0), semi-axes (r, h), equal angle steps."""
    a1 = math.acos(hole_r / r)
    return [(r * math.cos(a), y0 + h * math.sin(a)) for a in (a1 * (1 - i / steps) for i in range(steps + 1))]


def round_corner(r_wall, rc, y0, steps):
    """Quarter-round from (r_wall, y0 + rc) down to (r_wall - rc, y0), inclusive, TOP -> BOTTOM."""
    pts = []
    for i in range(steps + 1):
        a = math.pi / 2 * i / steps
        pts.append((r_wall - rc + rc * math.cos(a), y0 + rc - rc * math.sin(a)))
    return pts


def dish(r, y_rim, depth, steps):
    """Elliptical dish TOP -> BOTTOM: rim (r, y_rim) down to the pole (0, y_rim - depth)."""
    return [(r * math.cos(a), y_rim - depth * math.sin(a)) for a in (math.pi / 2 * i / steps for i in range(steps + 1))]


_AXES = {"+x": ((0, 0, math.pi / 2), (1, 0, 0)), "-x": ((0, 0, math.pi / 2), (-1, 0, 0)),
         "+z": ((math.pi / 2, 0, 0), (0, 0, 1)), "-z": ((math.pi / 2, 0, 0), (0, 0, -1)),
         "+y": ((0, 0, 0), (0, 1, 0)), "-y": ((0, 0, 0), (0, -1, 0))}


def ring(name, radius, length, mat, position_t, rotation_t=(0, 0, 0), seg=12):
    """Short closed cylinder band: a flange ring, lid rim or collar. Same
    facet count as the drum/stub it sits on so the meridians line up; its
    two 90 deg edges outline as the band's top and bottom lines."""
    return hd.cylinder(name, radius, radius, length, seg, mat, position_t=position_t, rotation_t=rotation_t)


def collar(name, drum_r, y_bottom, height, mat, scale=1.08, seg=12, yaw=0.0):
    """Base collar around a vertical drum (e.g. a motor housing on a dome):
    a band `scale` x wider than the drum from `y_bottom` up `height`. Sink
    `y_bottom` a little below the surface it sits on so the band's lower
    edge disappears into it and only the top edge outlines (the reference
    mixer cap reads as drum + top rim + wider base band)."""
    return ring(name, drum_r * scale, height, mat, (0, y_bottom + height / 2, 0), (0, yaw, 0), seg)


def nozzle_with_flange(name, start_t, axis, length, mat, radius=0.05, flange_scale=1.32, flange_len=0.02, seg=12):
    """Slim pipe stub from `start_t` along `axis` ('+x', '-z', ...) with a flange
    RING at the free end, perpendicular to the stub, in the scene pipes'
    proportions (pipe-math.ts PIPE_FLANGE_SCALE 1.32). Returns the free-end
    face centre (the port position)."""
    rot, d = _AXES[axis]
    c = tuple(s + di * length / 2 for s, di in zip(start_t, d))
    hd.cylinder(name, radius, radius, length, seg, mat, position_t=c, rotation_t=rot)
    end = tuple(s + di * length for s, di in zip(start_t, d))
    fc = tuple(e - di * flange_len / 2 for e, di in zip(end, d))
    ring(f"{name}.flange", radius * flange_scale, flange_len, mat, fc, rot, seg)
    return end


_BOX_FACES = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6), (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
_BOX_CORNERS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))


def impeller(prefix, parent, y_local, mat, blades=3, hub_r=0.05, hub_h=0.08, blade_len=0.16, blade_h=0.07,
             blade_t=0.012, pitch=math.radians(30.0), yaw0=math.pi / 6, seg=8):
    """Hub + `blades` flat blades at `y_local` under `parent` (an anim pivot on
    the axis). Each blade is a thin box along +X from the hub, pitched about
    its own radial axis, then yawed about Y. Yaw-after-pitch is not an R3F
    'XYZ' Euler, so the vertices are rotated here instead of via rotation_t."""
    hd.cylinder(f"{prefix}.hub", hub_r, hub_r, hub_h, seg, mat, position_t=(0, y_local, 0), parent=parent)
    hx, hy, hz = blade_len / 2, blade_h / 2, blade_t / 2
    cx = hub_r + blade_len / 2 - 0.01  # overlaps into the hub
    cp, sp = math.cos(pitch), math.sin(pitch)
    for i in range(blades):
        yaw = yaw0 + i * math.tau / blades
        cy, sy = math.cos(yaw), math.sin(yaw)
        verts = []
        for sx, sy_, sz in _BOX_CORNERS:
            x, y, z = sx * hx + cx, sy_ * hy, sz * hz
            y, z = cp * y - sp * z, sp * y + cp * z  # pitch about X
            x, z = cy * x + sy * z, -sy * x + cy * z  # yaw about Y (three.js convention)
            verts.append((x, y, z))
        hd._mesh_object(f"{prefix}.blade.{i}", verts, _BOX_FACES, mat, (0, y_local, 0), (0, 0, 0), parent)


def liquid_volume(profile_local, seg, mat, y_pivot, theta0=0.0, name="liquid"):
    """`anim.liquid` pivot at (0, y_pivot, 0) with child `liquid`: a FULL
    revolution of the inner profile (TOP -> BOTTOM, axis to axis, in pivot-
    local y with the bottom at 0) for the translucent `hd.liquid` finish.
    Same scale.y = fill convention as brewery.liquid_window; unlike it the
    volume stays inside the wall and keeps its edges (the finish draws them)."""
    pivot = hd.add_anim("liquid", (0, y_pivot, 0))
    lathe(name, profile_local, seg, mat, parent=pivot, theta0=theta0)
    return pivot
