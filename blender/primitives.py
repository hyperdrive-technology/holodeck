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
  profile_y_at_r(...)     height of a profile at a radius (seating parts on it)
  cutaway_shell(...)      thick-walled vessel with a window: three closed solids;
                          cuts land on rings of BOTH profiles (conical caps
                          join rings at different heights), sill on a wall
  ellipse_head(...)       elliptical head profile with a hole at the apex
  round_corner(...)       quarter-round corner profile (heels)
  dish(...)               elliptical dish profile (floors, liquid bottoms)
  ring(...) / collar(...) short bands; stack_cylinders(...) drum + rims, caps touching
  nozzle_with_flange(...) slim pipe stub + flange ring(s); returns the port point
  impeller(...)           hub + pitched blades under an anim pivot
  liquid_volume(...)      full-revolution liquid lathe under anim.liquid
  check_terminations(...) proves every meridian line ends on a drawn ring

LINE TERMINATION RULE (Des, round 4): every vertical / meridian line the
runtime draws must end exactly on a drawn horizontal ring (or a window cut
edge) — no line may fade out part-way across a curved band, and no cylinder
may be sunk into another surface so its lines vanish without a ring.
How the runtime draws lines: EdgesGeometry at EDGE_THRESHOLD_DEG (style.ts
`edges.threshold`), i.e. an edge is drawn iff the dihedral angle between its
two faces is >= the threshold. For a band of a revolved profile tilted `phi`
from vertical, adjacent facets meet at
    delta = acos(cos^2(phi) * cos(2 pi / seg) + sin^2(phi))
so meridians are drawn on steep bands only, and the ring between two bands is
drawn iff the profile turns by >= threshold there. `check_terminations`
enforces (with a safety margin, because near-threshold angles would flip with
float error): wherever meridian drawing changes between two bands, the ring
between them is drawn. `stack_cylinders` keeps drum/collar/lid caps touching
so each drum's lines end on its own cap ring; `nozzle_with_flange(base_ring=
True)` seats a ring on the wall so stub lines end there.

`theta0` rotates the facet boundaries so a window can be centred on the camera
with any segment count (18 segments + theta0 = -5 deg puts boundaries at -5 deg
and 95 deg, a 100 deg window centred on 45 deg).

NO DECORATIVE RINGS ON INNER WALLS (Des, 2026-10-30, mixer round 6): an inner
wall is one plain band between the structural rims where it meets the floor
dish and the head; the only ring lines inside a vessel are those rims and the
window's cut edges. (An `interior_rings` helper that spliced shallow ridge
rings into the inner profile existed through round 5 and was removed with the
mixer's rings; don't reintroduce it.)
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import holodeck_bpy as hd  # noqa: E402

EDGE_THRESHOLD_DEG = 15.0  # mirrors assets/process/style.ts HOLODECK_STYLE.edges.threshold
TERMINATION_MARGIN_DEG = 2.0  # creases / facet angles must sit this far from the threshold


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


# --------------------------------------------------------------------------
# Line-termination analysis (see module docstring)
# --------------------------------------------------------------------------


def facet_dihedral_deg(tilt_deg, seg):
    """Angle between adjacent facets of a revolved band tilted `tilt_deg` from vertical."""
    phi = math.radians(tilt_deg)
    c = math.cos(phi) ** 2 * math.cos(math.tau / seg) + math.sin(phi) ** 2
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _bands(profile):
    """(tilt_deg from vertical, direction angle) per profile segment, skipping zero-length ones."""
    out = []
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        dr, dy = r1 - r0, y1 - y0
        if abs(dr) < 1e-9 and abs(dy) < 1e-9:
            continue
        out.append((math.degrees(math.atan2(abs(dr), abs(dy))), math.degrees(math.atan2(dy, dr)), r0, y0, r1, y1))
    return out


def check_terminations(name, profile, seg, closed=False, threshold=EDGE_THRESHOLD_DEG, margin=TERMINATION_MARGIN_DEG):
    """Raise unless every meridian line of the revolved `profile` ends on a
    drawn ring. `closed` treats the profile as a cyclic loop (sweep). Bands
    whose facet angle or whose ring crease lies within `margin` of the
    threshold are rejected too: they would be drawn or not by float luck."""
    bands = _bands(profile)
    if closed:
        bands.append(bands[0])
    problems = []
    for i, (tilt, direction, r0, y0, r1, y1) in enumerate(bands):
        delta = facet_dihedral_deg(tilt, seg)
        if r0 > 1e-9 or r1 > 1e-9:  # a segment on the axis sweeps to nothing
            if abs(delta - threshold) < margin:
                problems.append(f"band ({r0:.3f},{y0:.3f})->({r1:.3f},{y1:.3f}) facets meet at {delta:.1f} deg, "
                                f"within {margin} deg of the {threshold} deg edge threshold")
        if i + 1 >= len(bands):
            continue
        tilt2, direction2, r2, y2, r3, y3 = bands[i + 1]
        on_axis = r1 <= 1e-9 and r2 <= 1e-9
        if on_axis:
            continue  # bands meet at a pole: meridians converge there
        crease = abs(direction2 - direction)
        crease = min(crease, 360 - crease)
        drawn_a = delta >= threshold and (r0 > 1e-9 or r1 > 1e-9)
        drawn_b = facet_dihedral_deg(tilt2, seg) >= threshold and (r2 > 1e-9 or r3 > 1e-9)
        if abs(crease - threshold) < margin:
            problems.append(f"ring at y={y1:.3f} r={r1:.3f} turns {crease:.1f} deg, within {margin} deg of the threshold")
        elif drawn_a != drawn_b and crease < threshold:
            problems.append(f"meridians {'stop' if drawn_a else 'start'} at y={y1:.3f} r={r1:.3f} but the ring there "
                            f"turns only {crease:.1f} deg (< {threshold}) and is not drawn")
    if problems:
        raise RuntimeError(f"{name}: line termination rule violated:\n  " + "\n  ".join(problems))


# --------------------------------------------------------------------------
# Revolves
# --------------------------------------------------------------------------


def lathe(name, profile, seg, mat, position_t=(0, 0, 0), parent=None, arc=None, arc_steps=3, theta0=0.0, check=False):
    """Solid of revolution about three-space +Y.

    `profile` is [(r, y), ...] ordered TOP -> BOTTOM. Rings with r == 0 are
    single shared pole vertices. Full revolution: a non-zero first/last r gets
    an n-gon cap. `arc=(a0, a1)` (radians, theta as in hd.cylinder: x=r sin,
    z=r cos) builds a closed pie slice instead; then profile must start and
    end on the axis (r == 0).
    Face winding is fixed afterwards with bmesh.recalc_face_normals so it
    does not depend on getting every orientation right by hand (closed
    manifold meshes only, which all of these are).
    `check=True` runs check_terminations on the profile (plus its caps).
    """
    if check:
        capped = ([(0.0, profile[0][1])] if profile[0][0] > 0 else []) + list(profile) + \
                 ([(0.0, profile[-1][1])] if profile[-1][0] > 0 else [])
        check_terminations(name, capped, seg)
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


def sweep(name, loop, seg, mat, arc=None, arc_steps=None, parent=None, theta0=0.0, check=False):
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
    no outlines on the inner wall) instead of failing.
    `check=True` runs check_terminations on the loop.
    """
    if check:
        check_terminations(name, list(loop) + [loop[0]], seg, closed=True)
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


# --------------------------------------------------------------------------
# Profiles
# --------------------------------------------------------------------------


def split_profile(profile, y_cut):
    """Split a TOP -> BOTTOM profile (non-increasing y) at `y_cut`.

    Returns (above, below): `above` ends and `below` starts with the point on
    the profile at y_cut (interpolated unless a profile point is already
    there), so both halves share that boundary ring. Cut at an existing
    profile ring where you can: an interpolated cut adds a ring the runtime
    outlines (the two solids' cap edges) without a crease behind it.
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


def profile_y_at_r(profile, r):
    """Height of a (monotonic-in-r) profile at radius `r`, interpolated. Used
    to seat a collar or ring exactly on a revolved surface."""
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        lo, hi = min(r0, r1), max(r0, r1)
        if lo - 1e-9 <= r <= hi + 1e-9 and hi - lo > 1e-9:
            return y0 + (y1 - y0) * (r - r0) / (r1 - r0)
    raise ValueError(f"r={r} is outside the profile's r range")


def _angles(steps_or_angles, end_deg):
    """Equal steps (int) or an explicit ascending list of interior angles (deg) -> full ascending list."""
    if isinstance(steps_or_angles, int):
        return [end_deg * i / steps_or_angles for i in range(steps_or_angles + 1)]
    return [0.0] + [float(a) for a in steps_or_angles] + [end_deg]


def ellipse_head(r, y0, h, hole_r, steps):
    """Elliptical head TOP -> BOTTOM: from the ring at r == hole_r (apex hole)
    down to the equator (r, y0), semi-axes (r, h). `steps` is an int (equal
    angle steps) or a list of interior ellipse angles in degrees, ascending
    from the equator, chosen so each band's tilt is clear of the edge
    threshold (see check_terminations)."""
    a1 = math.degrees(math.acos(hole_r / r))
    angles = _angles(steps, a1)
    return [(r * math.cos(math.radians(a)), y0 + h * math.sin(math.radians(a))) for a in reversed(angles)]


def round_corner(r_wall, rc, y0, steps):
    """Quarter-round from (r_wall, y0 + rc) down to (r_wall - rc, y0), inclusive, TOP -> BOTTOM.
    `steps`: int or interior angles (deg) from the wall tangent."""
    pts = []
    for a in _angles(steps, 90.0):
        a = math.radians(a)
        pts.append((r_wall - rc + rc * math.cos(a), y0 + rc - rc * math.sin(a)))
    return pts


def dish(r, y_rim, depth, steps):
    """Elliptical dish TOP -> BOTTOM: rim (r, y_rim) down to the pole (0, y_rim - depth).
    `steps`: int or interior angles (deg) from the rim."""
    return [(r * math.cos(math.radians(a)), y_rim - depth * math.sin(math.radians(a))) for a in _angles(steps, 90.0)]


def _cut_heights(v):
    """`window_y` entry -> (outer_y, inner_y): one height for both profiles, or a pair."""
    if isinstance(v, (int, float)):
        return float(v), float(v)
    yo, yi = v
    return float(yo), float(yi)


def _ring_index(profile, y, what):
    """Index of the profile point at height `y`; raises when the cut would
    interpolate mid-band (which adds a seam ring the runtime outlines without
    a crease behind it, see split_profile)."""
    for i, (_, py) in enumerate(profile):
        if abs(py - y) < 1e-9:
            return i
    rings = ", ".join(f"{py:.4f}" for _, py in profile)
    raise ValueError(f"{what}: cut at y={y:.4f} is not on a profile ring (rings at {rings}); "
                     "cut on an existing ring of each profile (window_y entries may be (outer_y, inner_y) pairs)")


def _check_sill_on_wall(profile, y, what):
    """The sill must sit on a wall: the profile band ending at the sill ring
    (the one just above it) is vertical. A sill part-way across a floor dish
    or heel would leave the floor's rings as open arcs ('C' rings) whose cut
    edges wander across the curved band to the sill."""
    i = _ring_index(profile, y, what)
    if i == 0:
        raise ValueError(f"{what}: sill at y={y:.4f} is the profile's top point")
    (r_above, _), (r_sill, _) = profile[i - 1], profile[i]
    if abs(r_above - r_sill) > 1e-9:
        raise ValueError(f"{what}: sill at y={y:.4f} r={r_sill:.4f} is not at the bottom of a vertical wall band "
                         f"(the band above it runs from r={r_above:.4f}); the window would slice through a "
                         "curved band and leave its rings as open C-shaped arcs. Cut on the wall's bottom ring "
                         "and let the floor stay whole in the lower solid")


def cutaway_shell(prefix, outer, inner, window, window_y, seg, mat, theta0=0.0, check=True):
    """Thick-walled vessel of revolution with a cutaway window, as three CLOSED solids.

    `outer` / `inner` are the full outer and inner surface profiles TOP ->
    BOTTOM (start at the apex hole or pole, end on the bottom pole/hole).
    `window=(a0, a1)` is the removed arc (radians, hd.cylinder theta) and
    `window_y=(sill, top)` its sill and top heights. Each of the two may be a
    single height or an `(outer_y, inner_y)` pair; every cut must land ON AN
    EXISTING RING of its profile (no mid-band interpolation, which would add
    a seam ring). Where the outer and inner rings sit at different heights
    (the outer heel ring vs the inner floor's dish rim; the two head
    profiles' first rings) the cap between them is a conical face, so the
    window's sill is a bevel from the outer ring up to the inner one and the
    floor dish stays a full 360 deg surface in the lower solid. The sill
    rings must be at the BOTTOM OF A VERTICAL WALL BAND of each profile: a
    sill part-way across a floor dish leaves the dish's rings as open
    C-shaped arcs with cut edges wandering across the dish (mixer round 5).
    Result, named f"{prefix}.upper" (360 deg above the top), f"{prefix}.band"
    (the keep-arc between sill and top, with planar cut faces that follow
    the wall profile, e.g. up into a shoulder) and f"{prefix}.lower" (360
    deg below the sill). The window edges must land on facet boundaries:
    (a0 - theta0) and (a1 - a0) must be multiples of 2*pi/seg. Materials
    are single-sided, so this is how a cutaway stays a valid solid: cut
    faces, sill and the inner back wall are all real front-facing geometry.
    `check` runs check_terminations on both full profiles and on each
    solid's closed cross-section (which includes the conical caps).
    """
    a0, a1 = window
    (y0o, y0i), (y1o, y1i) = (_cut_heights(v) for v in window_y)
    step = math.tau / seg
    k0 = (a0 - theta0) / step
    n_win = (a1 - a0) / step
    if abs(k0 - round(k0)) > 1e-6 or abs(n_win - round(n_win)) > 1e-6:
        raise ValueError(f"window {math.degrees(a0):.1f}..{math.degrees(a1):.1f} deg must align with the "
                         f"{seg}-gon facets at theta0 {math.degrees(theta0):.1f} deg")
    for prof, y, what in ((outer, y1o, f"{prefix} outer top"), (inner, y1i, f"{prefix} inner top")):
        _ring_index(prof, y, what)
    _check_sill_on_wall(outer, y0o, f"{prefix} outer sill")
    _check_sill_on_wall(inner, y0i, f"{prefix} inner sill")
    if check:
        check_terminations(f"{prefix} outer", outer, seg)
        check_terminations(f"{prefix} inner", inner, seg)
    keep = (a1, a0 + math.tau)
    keep_steps = seg - int(round(n_win))
    o_up, o_rest = split_profile(outer, y1o)
    o_mid, o_low = split_profile(o_rest, y0o)
    i_up, i_rest = split_profile(inner, y1i)
    i_mid, i_low = split_profile(i_rest, y0i)
    loops = {
        "upper": o_up + list(reversed(i_up)),
        "band": o_mid + list(reversed(i_mid)),
        "lower": o_low + list(reversed(i_low)),
    }
    if check:
        for part, loop in loops.items():
            check_terminations(f"{prefix}.{part}", list(loop) + [loop[0]], seg, closed=True)
    return {
        "upper": sweep(f"{prefix}.upper", loops["upper"], seg, mat, theta0=theta0),
        "band": sweep(f"{prefix}.band", loops["band"], seg, mat, arc=keep, arc_steps=keep_steps),
        "lower": sweep(f"{prefix}.lower", loops["lower"], seg, mat, theta0=theta0),
    }


# --------------------------------------------------------------------------
# Cylindrical details
# --------------------------------------------------------------------------


def ring(name, radius, length, mat, position_t, rotation_t=(0, 0, 0), seg=12):
    """Short closed cylinder band: a flange ring, lid rim or collar. Same
    facet count as the drum/stub it sits on so the meridians line up; its
    two 90 deg edges outline as the band's top and bottom lines."""
    return hd.cylinder(name, radius, radius, length, seg, mat, position_t=position_t, rotation_t=rotation_t)


def collar(name, drum_r, y_bottom, height, mat, scale=1.08, seg=12, yaw=0.0):
    """Base collar around a vertical drum: a band `scale` x wider than the
    drum from `y_bottom` up `height`. Seat `y_bottom` ON the surface below
    (profile_y_at_r at the collar's inscribed radius, see stack_cylinders) —
    not sunk into it — so the band's bottom ring is the line where its
    meridians end."""
    return ring(name, drum_r * scale, height, mat, (0, y_bottom + height / 2, 0), (0, yaw, 0), seg)


def stack_cylinders(specs, y0, mat, seg=12, yaw=0.0):
    """Closed cylinders stacked bottom-up from `y0`, caps touching:
    specs = [(name, radius, height), ...]. Each drum's meridian lines end on
    its own cap rings, which lie on the neighbour's cap face (the drum's
    bottom ring IS the line where it meets a wider collar below). Returns
    the top y."""
    y = y0
    for name, radius, height in specs:
        ring(name, radius, height, mat, (0, y + height / 2, 0), (0, yaw, 0), seg)
        y += height
    return y


_AXES = {"+x": ((0, 0, math.pi / 2), (1, 0, 0)), "-x": ((0, 0, math.pi / 2), (-1, 0, 0)),
         "+z": ((math.pi / 2, 0, 0), (0, 0, 1)), "-z": ((math.pi / 2, 0, 0), (0, 0, -1)),
         "+y": ((0, 0, 0), (0, 1, 0)), "-y": ((0, 0, 0), (0, -1, 0))}


def _axis(axis):
    """('+x' | '-z' | ... | horizontal theta in radians) -> (three Euler XYZ, unit direction)."""
    if isinstance(axis, str):
        return _AXES[axis]
    d = (math.sin(axis), 0.0, math.cos(axis))
    # +Y -> +Z (rotate pi/2 about X), then yaw about Y by theta. three's 'XYZ'
    # Euler is Rx*Ry*Rz (intrinsic), which is Blender's 'ZYX' decomposition.
    m = Matrix.Rotation(axis, 3, "Y") @ Matrix.Rotation(math.pi / 2, 3, "X")
    e = m.to_euler("ZYX")
    got = hd.three_euler_matrix((e.x, e.y, e.z)) @ hd.Vector((0.0, 1.0, 0.0))
    assert all(abs(a - b) < 1e-6 for a, b in zip(got, d)), f"axis euler mismatch {tuple(got)} vs {d}"
    return (e.x, e.y, e.z), d


def nozzle_with_flange(name, start_t, axis, length, mat, radius=0.05, flange_scale=1.32, flange_len=0.02, seg=12,
                       base_ring=False, inset=0.02):
    """Slim pipe stub from `start_t` (ON the wall surface) along `axis` ('+x',
    '-z', ... or a horizontal theta in radians) with a flange RING at the free
    end, perpendicular to the stub, in the scene pipes' proportions
    (pipe-math.ts PIPE_FLANGE_SCALE 1.32). `base_ring=True` adds the same
    ring at the wall end, seated on the wall face, so the stub's meridian
    lines end on a drawn ring instead of vanishing into the wall; the stub
    itself starts `inset` inside the wall to hide the seam. Returns the
    free-end face centre (the port position)."""
    rot, d = _axis(axis)
    s = tuple(si - di * inset for si, di in zip(start_t, d))
    c = tuple(si + di * (length + inset) / 2 for si, di in zip(s, d))
    hd.cylinder(name, radius, radius, length + inset, seg, mat, position_t=c, rotation_t=rot)
    end = tuple(si + di * length for si, di in zip(start_t, d))
    fc = tuple(e - di * flange_len / 2 for e, di in zip(end, d))
    ring(f"{name}.flange", radius * flange_scale, flange_len, mat, fc, rot, seg)
    if base_ring:
        bc = tuple(si + di * flange_len / 2 for si, di in zip(start_t, d))
        ring(f"{name}.base", radius * flange_scale, flange_len, mat, bc, rot, seg)
    return end


_BOX_FACES = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6), (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
_BOX_CORNERS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))


def impeller(prefix, parent, y_local, mat, blades=3, hub_r=0.05, hub_h=0.08, blade_len=0.16, blade_h=0.07,
             blade_t=0.012, pitch=math.radians(30.0), yaw0=math.pi / 6, seg=8):
    """Hub + `blades` flat blades at `y_local` under `parent` (an anim pivot on
    the axis). Each blade is a thin box along +X from the hub, pitched about
    its own radial axis, then yawed about Y. Yaw-after-pitch is not an R3F
    'XYZ' Euler, so the vertices are rotated here instead of via rotation_t.
    Returns the hub's top y (local) so a shaft can end exactly there."""
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
    return y_local + hub_h / 2


def liquid_volume(profile_local, seg, mat, y_pivot, theta0=0.0, name="liquid", check=True):
    """`anim.liquid` pivot at (0, y_pivot, 0) with child `liquid`: a FULL
    revolution of the inner profile (TOP -> BOTTOM, axis to axis, in pivot-
    local y with the bottom at 0) for the translucent `hd.liquid` finish.
    Same scale.y = fill convention as brewery.liquid_window; unlike it the
    volume stays inside the wall and keeps its edges (the finish draws them)."""
    pivot = hd.add_anim("liquid", (0, y_pivot, 0))
    lathe(name, profile_local, seg, mat, parent=pivot, theta0=theta0, check=check)
    return pivot
