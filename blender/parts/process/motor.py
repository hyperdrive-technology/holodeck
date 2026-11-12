"""Foot-mounted electric motor with axial fins, terminal box and fan cowl.

Layout along X: -X fan hub / cowl -- finned frame -- drive bell / shaft +X.
Origin = floor at footprint centre. Shaft axis Y=0.32. Overall about
0.98 X x 0.67 Y x 0.57 Z, fitting a 1 x 1 footprint and resting on Y=0.
Ports: none. anim.shaft = (0, 0.32, 0), rotates about X; shaft stub, raised
shaft key and fan hub are children. hd.accent is a flush drive-end band.
"""

import math

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials()
    c.feet("feet", m["white"])
    c.x_cylinder("frame", -0.29, 0.23, 0.23, m["white"], y=c.PIPE_Y)
    # Few broad longitudinal fins instead of many thin circumferential rings.
    # Flat radial faces remain readable next to the six-sided scene pipes.
    # Preview feedback: the top fin poked out from under the terminal box as
    # an unexplained little block. Six side fins leave a clean terminal seat.
    for i in (1, 2, 3, 5, 6, 7):
        angle = i * math.tau / 8
        c.edges(c.box(f"fin.{i}", (0.43, 0.05, 0.035), m["white"],
                      (-0.055, c.PIPE_Y + 0.235 * math.cos(angle), 0.235 * math.sin(angle)),
                      rotation=(angle, 0, 0)), 45)
    c.x_cylinder("fan.cowl", -0.46, -0.28, 0.205, m["white"],
                 y=c.PIPE_Y, radius_end=0.245)
    c.x_cylinder("drive.bell", 0.23, 0.33, 0.23, m["white"],
                 y=c.PIPE_Y, radius_end=0.16)
    # Only 0.001 above the frame: a paint stripe, not a protruding collar.
    c.edges(c.x_cylinder("drive.band", 0.17, 0.23, 0.231, m["accent"], y=c.PIPE_Y), enabled=False)
    c.box("terminal.box", (0.25, 0.12, 0.235), m["white"], (-0.08, 0.59, 0))
    c.box("terminal.lid", (0.265, 0.02, 0.25), m["white"], (-0.08, 0.66, 0))

    shaft = hd.add_anim("shaft", (0, c.PIPE_Y, 0))
    c.x_cylinder("shaft.stub", 0.315, 0.49, 0.06, m["shaded"],
                 segments=c.SMALL_SEG, parent=shaft)
    c.edges(c.box("shaft.key", (0.10, 0.018, 0.025), m["white"],
                  (0.405, 0.061, 0), parent=shaft), enabled=False)
    c.x_cylinder("fan.hub", -0.49, -0.445, 0.065, m["shaded"],
                 segments=c.SMALL_SEG, parent=shaft)
    c.check(kind="floor", footprint=(1, 1), height=0.72,
            anim={"shaft": (0, c.PIPE_Y, 0)})


if __name__ == "__main__":
    hd.run_part(build, "motor")
