"""Batch A's closed extrusions and hollow guides, in three.js space.

Kept private while the process vocabulary is shared by concurrent batches.
Hollow guides leave genuine clearance around moving rods and hinge pins.
"""

import math

import _common as c


def prism(name, outline, start, end, mat, axis="Y", position=(0, 0, 0), parent=None):
    """Extrude a simple 2D outline along one axis; recalculate outward normals."""
    if end <= start:
        raise ValueError(f"{name}: extrusion must have positive thickness")
    project = {"X": lambda u, v, h: (h, u, v),
               "Y": lambda u, v, h: (u, h, v),
               "Z": lambda u, v, h: (u, v, h)}[axis]
    n = len(outline)
    vertices = [project(u, v, h) for h in (start, end) for u, v in outline]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    return c.mesh(name, vertices, faces, mat, position=position, parent=parent)


def ring(name, start, end, outer, inner, mat, axis="Y", position=(0, 0, 0), parent=None):
    """A watertight annular prism with an open bore, not a capped cylinder."""
    if not (end > start and outer > inner > 0):
        raise ValueError(f"{name}: invalid annular prism")
    n = c.SEG
    vertices = [(r * math.sin(i * math.tau / n), h, r * math.cos(i * math.tau / n))
                for h, r in ((start, outer), (end, outer), (start, inner), (end, inner))
                for i in range(n)]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend(((i, j, n + j, n + i), (2*n + j, 2*n + i, 3*n + i, 3*n + j),
                      (j, i, 2*n + i, 2*n + j), (n + i, n + j, 3*n + j, 3*n + i)))
    return c.edges(c.mesh(name, vertices, faces, mat, position=position,
                          rotation=c.AXIS_ROTATION[axis], parent=parent), 40)
