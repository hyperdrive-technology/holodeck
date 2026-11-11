"""Batch D's private instrument vocabulary; all coordinates are three.js Y-up.

The round head repeats the transmitter pilot's proportions. Hollow bezels
leave real clearance for recessed faces and the pressure gauge's needle.
"""

import math

import _common as c


def ring(name, z0, z1, outer, inner, mat, y=0, segments=c.SEG):
    """Closed annular prism along Z, with no disc covering its centre."""
    vertices = [(r * math.sin(i * math.tau / segments),
                 r * math.cos(i * math.tau / segments), z)
                for z, r in ((z0, outer), (z1, outer), (z0, inner), (z1, inner))
                for i in range(segments)]
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces += [(i, j, j + segments, i + segments),
                  (i + 2 * segments, i + 3 * segments, j + 3 * segments, j + 2 * segments),
                  (i, i + 2 * segments, j + 2 * segments, j),
                  (i + segments, j + segments, j + 3 * segments, i + 3 * segments)]
    return c.edges(c.mesh(name, vertices, faces, mat, position=(0, y, 0)), 40)


def transmitter_head(m, y, scale=1.0):
    """Pilot head, scaled about its centre, with forward display and rear gland."""
    s = scale
    c.z_cylinder("housing", -0.105 * s, 0.105 * s, 0.15 * s, m["white"], y=y)
    c.lathe("rear.cover", [(-0.15 * s, 0.11 * s), (-0.135 * s, 0.14 * s),
                           (-0.10 * s, 0.14 * s)], m["white"], axis="Z", position=(0, y, 0))
    ring("display.bezel", 0.10 * s, 0.145 * s, 0.15 * s, 0.115 * s, m["accent"], y)
    c.edges(c.z_cylinder("display.face", 0.105 * s, 0.136 * s, 0.115 * s,
                        m["shaded"], y=y), enabled=False)
    c.box("display.window", (0.14 * s, 0.073 * s, 0.006 * s), m["white"],
          (0, y + 0.005 * s, 0.139 * s))
    c.x_cylinder("cable.gland", 0.12 * s, 0.175 * s, 0.04 * s, m["white"],
                 y=y, z=-0.045 * s, segments=c.SMALL_SEG)
