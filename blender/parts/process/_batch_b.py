"""Batch B geometry: scaled pilot motors, hollow collars and extruded profiles.

Private to rotating equipment while the wave is being authored in parallel.
All dimensions and transforms are in three.js space; no shared files change.
"""

import math

import _common as c
from _common import hd


def motor(name, materials, position, scale=1, rotation=(0, 0, 0), accent=True,
          terminal=True):
    """The pilot motor's stationary assembly, with its shaft axis at local Y=0.

    The caller supplies feet/pedestal and moving coupling. Local +X is the
    drive end; a uniform transform preserves the pilot's fins and proportions.
    """
    root = hd.empty(name, position_t=position, rotation_t=rotation)
    root.scale = (scale, scale, scale)
    white = materials["white"]
    c.x_cylinder(f"{name}.frame", -0.29, 0.23, 0.23, white, parent=root)
    for i in (1, 2, 3, 5, 6, 7):
        a = i * math.tau / 8
        c.edges(c.box(f"{name}.fin.{i}", (0.43, 0.05, 0.035), white,
                      (-0.055, 0.235 * math.cos(a), 0.235 * math.sin(a)),
                      rotation=(a, 0, 0), parent=root), 45)
    c.x_cylinder(f"{name}.fan.cowl", -0.46, -0.28, 0.205, white,
                 radius_end=0.245, parent=root)
    c.x_cylinder(f"{name}.drive.bell", 0.23, 0.33, 0.23, white,
                 radius_end=0.16, parent=root)
    if accent:
        c.edges(c.x_cylinder(f"{name}.drive.band", 0.17, 0.23, 0.231,
                            materials["accent"], parent=root), enabled=False)
    if terminal:
        c.box(f"{name}.terminal.box", (0.25, 0.12, 0.235), white,
              (-0.08, 0.27, 0), parent=root)
        c.box(f"{name}.terminal.lid", (0.265, 0.02, 0.25), white,
              (-0.08, 0.34, 0), parent=root)
    return root


def extrude(name, outline, start, end, mat, axis="Z", position=(0, 0, 0), parent=None):
    """Extrude a closed 2D outline: XY for Z, YZ for X, ZX for Y."""
    def point(u, v, w):
        return {"Z": (u, v, w), "X": (w, u, v), "Y": (v, w, u)}[axis]
    n = len(outline)
    vertices = [point(u, v, w) for w in (start, end) for u, v in outline]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return c.mesh(name, vertices, faces, mat, position=position, parent=parent)


def ring(name, start, end, outer, inner, mat, axis="Y", position=(0, 0, 0),
         segments=12, parent=None):
    """A closed annulus with a real bore, for visible rotors and sliding rods."""
    if not 0 < inner < outer or end <= start:
        raise ValueError(f"{name}: invalid ring radii or axial extent")
    vertices = [(r * math.sin(i * math.tau / segments), y,
                 r * math.cos(i * math.tau / segments))
                for y, r in ((start, outer), (end, outer), (start, inner), (end, inner))
                for i in range(segments)]
    faces = []
    n = segments
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n + j, n + i), (2*n + j, 2*n + i, 3*n + i, 3*n + j),
                  (j, i, 2*n + i, 2*n + j), (n + i, n + j, 3*n + j, 3*n + i)]
    return c.edges(c.mesh(name, vertices, faces, mat, position=position,
                          rotation=c.AXIS_ROTATION[axis], parent=parent), 40)
