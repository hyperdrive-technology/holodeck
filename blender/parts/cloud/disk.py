"""Platter with a read arm: 1.80 × 0.50 × 1.80; logo 0.54 at Y=0.50."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.disc("tray", 0.90, 0, 0.12, accent, edge=0.025, segments=24)
    c.disc("platter", 0.84, 0.10, 0.34, white, edge=0.030, segments=24)
    # The raised hub is the highest surface, so the arm can sweep the outer
    # platter without ever crossing the logo square.
    c.disc("hub", 0.44, 0.32, 0.50, white, edge=0.025, segments=24)
    c.disc("pivot", 0.11, 0, 0.48, accent, edge=0.020, segments=12,
           position=(0.78, 0, 0.78))
    # Arm and head lie along the +X+Z diagonal from the pivot toward the hub.
    diagonal = (0, 3 * math.pi / 4, 0)
    c.box("arm", (0.52, 0.06, 0.12), accent,
          (0.537, 0.41, 0.537), radius=0.010, rotation=diagonal)
    c.box("head", (0.12, 0.06, 0.18), accent,
          (0.375, 0.41, 0.375), radius=0.010, rotation=diagonal)
    c.logo(0.50, 0.54)


if __name__ == "__main__":
    c.hd.run_part(build, "disk")
