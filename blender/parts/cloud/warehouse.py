"""Low hall with a clerestory roof: 1.98 × 1.12 × 1.60; logo 0.74 at Y=1.12."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("slab", (1.98, 0.10, 1.60), accent, (0, 0.05, 0), radius=0.030)
    c.box("hall", (1.84, 0.72, 1.44), white, (0, 0.44, 0), radius=0.040)
    # An overhanging roof and a raised clerestory give a stepped industrial
    # outline, unlike the taller, ribbed container.
    c.box("roof", (1.98, 0.10, 1.60), white, (0, 0.85, 0), radius=0.028)
    c.box("clerestory", (1.98, 0.22, 0.84), white, (0, 1.01, 0), radius=0.040)
    for side in (-1, 1):
        c.box(f"skylight.{side}", (1.60, 0.08, 0.03), accent,
              (0, 1.01, side * 0.43), radius=0.008)
    # Roller door with slats and a side door on the +Z front.
    c.box("door", (0.92, 0.60, 0.04), accent, (-0.30, 0.38, 0.735), radius=0.010)
    for i in range(4):
        c.box(f"slat.{i}", (0.84, 0.045, 0.02), white,
              (-0.30, 0.17 + i * 0.14, 0.755), radius=0.006)
    c.box("side-door", (0.24, 0.46, 0.04), accent, (0.58, 0.31, 0.735), radius=0.010)
    c.box("window-strip", (0.04, 0.14, 1.00), accent, (0.935, 0.62, 0), radius=0.008)
    c.logo(1.12, 0.74)


if __name__ == "__main__":
    c.hd.run_part(build, "warehouse")
