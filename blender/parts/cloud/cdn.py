"""Faceted globe with edge nodes: 1.80 × 1.50 × 1.80; logo 0.52 at Y=1.50."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.disc("base", 0.90, 0, 0.12, accent, edge=0.025, segments=16)
    c.disc("cradle", 0.54, 0.10, 0.32, white, edge=0.030, segments=16)
    # A sphere of radius 0.72 about Y=0.90, planed flat at both poles: the
    # crown carries the logo and the foot sits in the cradle.
    radius, centre = 0.72, 0.90
    profile = [(y, math.sqrt(radius * radius - (y - centre) ** 2))
               for y in (0.30, 0.44, 0.62, 0.90, 1.18, 1.36, 1.50)]
    c.lathe("globe", profile, white, segments=16)
    c.disc("equator", 0.76, 0.855, 0.945, accent, edge=0.015, segments=16)
    # Four edge nodes on the diagonals face the globe; together they say
    # "one origin, points of presence all around".
    for i in range(4):
        angle = math.pi / 4 + i * math.pi / 2
        x, z = 0.70 * math.sin(angle), 0.70 * math.cos(angle)
        c.box(f"edge-node.{i}", (0.24, 0.22, 0.24), white, (x, 0.23, z),
              radius=0.028, rotation=(0, angle, 0))
        c.box(f"edge-cap.{i}", (0.18, 0.05, 0.18), accent, (x, 0.365, z),
              radius=0.012, rotation=(0, angle, 0))
    c.logo(1.50, 0.52)


if __name__ == "__main__":
    c.hd.run_part(build, "cdn")
