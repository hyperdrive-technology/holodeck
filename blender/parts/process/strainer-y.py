"""Inline Y-strainer with a rolled-down diagonal basket and removable cap.

Layout: -X flange -- straight body -- +X flange; basket leaves the body
toward +X, -Y and +Z at 45 degrees to X. Its roll keeps the cap off the floor.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Face-to-face
length 1.0; overall about 1.0 X x 0.546 Y x 0.851 Z, footprint 1 x 2.
Ports: in (-0.5, 0, 0), out (0.5, 0, 0). Animation nodes: none.
hd.accent is the basket cap only, tintable from blocked / differential
pressure severity. The cleanout plug is fixed and is not a process port.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd

LEG_START = (-0.24, 0, 0)
# The branch remains 45 degrees to X, rolled toward +Z. A vertical 45-degree
# leg at the scene's fixed 0.32 pipe height would put its cap below the floor.
# Built mesh bounds verify 0.0438 of floor clearance at that placement.
LEG_DIRECTION = (math.sqrt(0.5), -0.12, math.sqrt(0.5 - 0.12 ** 2))


def build():
    m = c.materials()
    c.lathe("body", [(-0.30, 0.20), (-0.23, 0.24),
                     (0.23, 0.24), (0.30, 0.20)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.24, 0, 0), (sign * 0.5, 0, 0), m["white"])
    # c.cylinder deliberately rejects diagonal ports. Rotate these decorative
    # lathed solids together; the only connection faces remain axis-aligned.
    leg_rotation = hd.t2b((0, 1, 0)).rotation_difference(hd.t2b(LEG_DIRECTION)).to_matrix().to_4x4()
    leg_rotation.translation = hd.t2b(LEG_START)
    for name, profile, mat, segments, threshold in (
        ("basket", [(0, 0.18), (0.49, 0.18), (0.555, 0.195)], m["white"], c.SEG, 15),
        ("basket.cap", [(0.545, 0.21), (0.62, 0.21), (0.65, 0.17)], m["accent"], c.SEG, 40),
        ("cleanout.plug", [(0.645, 0.07), (0.72, 0.07)], m["white"], 6, 40),
    ):
        obj = c.lathe(name, profile, mat, segments=segments)
        obj.matrix_basis = leg_rotation.copy()
        c.edges(obj, threshold)
    c.check(kind="inline", footprint=(1, 2), y_min=-0.30, height=0.58, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "strainer-y")
