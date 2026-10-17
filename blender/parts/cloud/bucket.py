"""Tapered storage bucket: 1.60 × 1.43 × 1.60; logo 0.90 at Y=1.43."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def handle(mat):
    """A broad, lowered bail follows the vessel without covering its lid."""
    segments = 12
    verts = []
    for i in range(segments + 1):
        angle = i * math.pi / segments
        height = 1.17 - 0.54 * math.sin(angle)
        for radius, dy in ((0.735, -0.035), (0.795, -0.035),
                           (0.795, 0.035), (0.735, 0.035)):
            verts.append((radius * math.cos(angle), height + dy,
                          radius * 0.91 * math.sin(angle)))
    faces = [(3, 2, 1, 0)]
    for i in range(segments):
        for j in range(4):
            k = (j + 1) % 4
            faces.append((i * 4 + j, i * 4 + k,
                          (i + 1) * 4 + k, (i + 1) * 4 + j))
    faces.append(tuple(segments * 4 + j for j in range(4)))
    c.mesh("lowered-handle", verts, faces, mat)


def build():
    white, accent = c.materials()
    c.disc("foot", 0.57, 0, 0.12, accent, edge=0.025)
    c.lathe("vessel", [(0.08, 0.54), (0.14, 0.58),
                       (1.25, 0.74), (1.31, 0.74)], white)
    for side in (-1, 1):
        c.box(f"handle-mount.{side}", (0.08, 0.14, 0.14), accent,
              (side * 0.742, 1.17, 0), radius=0.022)
    handle(accent)
    c.disc("rim", 0.80, 1.25, 1.39, accent, edge=0.025)
    # A closed white lid gives the logo a real top face, while the taper,
    # broad rim and lowered handle retain the bucket silhouette.
    c.disc("lid", 0.745, 1.35, 1.43, white, edge=0.020)
    c.logo(1.43, 0.90)


if __name__ == "__main__":
    c.hd.run_part(build, "bucket")
