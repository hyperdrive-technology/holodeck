"""Batch C private vocabulary: hollow, flat-sided stack and clamp rings.

Unlike a capped cylinder, an annulus leaves the fan or bore visible. Keep
the inner wall and both lips explicit so single-sided glTF materials work.
"""

import math

import _common as c


def ring(name, y0, y1, outer, inner, mat, position=(0, 0, 0), segments=c.SEG):
    """Closed annular solid around Y, with an unobstructed axial opening."""
    if not 0 < inner < outer or y1 <= y0:
        raise ValueError(f"{name}: invalid annulus dimensions")
    vertices = [(r * math.sin(i * math.tau / segments), y,
                 r * math.cos(i * math.tau / segments))
                for y, r in ((y0, outer), (y1, outer), (y0, inner), (y1, inner))
                for i in range(segments)]
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.extend(((i, j, segments + j, segments + i),
                      (2 * segments + j, 2 * segments + i, 3 * segments + i, 3 * segments + j),
                      (j, i, 2 * segments + i, 2 * segments + j),
                      (segments + i, segments + j, 3 * segments + j, 3 * segments + i)))
    return c.mesh(name, vertices, faces, mat, position)
