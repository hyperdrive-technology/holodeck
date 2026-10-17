"""Octagonal hub with four satellites: 1.84 × 1.26 × 1.84; logo 0.56 at Y=1.26."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("board", (1.84, 0.16, 1.84), white, (0, 0.08, 0), radius=0.050)
    # Eight flats, axis-aligned, keep the hub apart from the round database
    # and the square compute parts; the collar echoes the platter family.
    octagon = dict(segments=8, angle=math.pi / 8)
    c.disc("hub-base", 0.56, 0.16, 0.28, accent, edge=0.020, **octagon)
    c.disc("hub", 0.50, 0.24, 1.26, white, edge=0.040, **octagon)
    c.disc("collar", 0.52, 1.00, 1.08, accent, edge=0.010, **octagon)
    # Satellites on the four axes with short raised spokes: a plus-shaped
    # footprint that reads as "one hub, many subscribers" from any quadrant.
    for i, (dx, dz) in enumerate(((1, 0), (0, 1), (-1, 0), (0, -1))):
        c.box(f"satellite.{i}", (0.28, 0.28, 0.28), white,
              (dx * 0.78, 0.30, dz * 0.78), radius=0.030)
        c.box(f"satellite-cap.{i}", (0.22, 0.05, 0.22), accent,
              (dx * 0.78, 0.465, dz * 0.78), radius=0.012)
        c.box(f"spoke.{i}", (0.26 if dx else 0.12, 0.07, 0.12 if dx else 0.26),
              accent, (dx * 0.55, 0.195, dz * 0.55), radius=0.012)
    c.logo(1.26, 0.56)


if __name__ == "__main__":
    c.hd.run_part(build, "broker")
