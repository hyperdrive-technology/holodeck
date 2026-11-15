"""Vertical cartridge / bag filter with a domed, swing-bolt clamp lid.

Layout: three short legs -> cylindrical housing -> clamp ring and dome;
upper inlet at -X, low outlet at +X and a small vent at the lid apex.
Origin = floor at footprint centre. Overall 1.0 X x 1.53 Y x 0.713 Z,
fitting a 1 x 1 footprint and resting on Y=0.
Ports: in (-0.5, 0.84, 0), facing -X; out (0.5, 0.32, 0), facing +X.
Animation nodes: none. hd.accent is the lid clamp ring only; blocked or
differential-pressure severity can tint it. Numeric pressure is a readout.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
from _batch_c import ring

PORTS = {"in": (-0.5, 0.84, 0), "out": (0.5, c.PIPE_Y, 0)}


def build():
    m = c.materials()
    c.lathe("housing", [(0.22, 0.16), (0.29, 0.29), (1.12, 0.29)], m["white"])
    # First preview exposed a leg through the outlet. Put the single leg
    # under the elevated inlet and the other two astride the low outlet;
    # their inner Z faces clear its 0.20-radius stub by more than 0.018.
    for i, angle in enumerate((-math.pi / 2, math.pi / 6, 5 * math.pi / 6)):
        x, z = 0.29 * math.sin(angle), 0.29 * math.cos(angle)
        c.box(f"leg.{i}", (0.065, 0.43, 0.065), m["white"], (x, 0.215, z))
        c.plinth(f"leg.{i}.pad", 0.13, 0.13, 0.045, m["white"], x=x, z=z)
    c.edges(ring("clamp.ring", 1.10, 1.18, 0.34, 0.275, m["accent"]), 40)
    c.lathe("lid", [(1.15, 0.30), (1.23, 0.275), (1.31, 0.20),
                    (1.36, 0.09), (1.37, 0)], m["white"])
    # Three deliberately chunky lugs, without threads or tiny handwheels.
    for i, angle in enumerate((0, 2 * math.pi / 3, 4 * math.pi / 3)):
        x, z = 0.32 * math.sin(angle), 0.32 * math.cos(angle)
        c.box(f"clamp.lug.{i}", (0.105, 0.085, 0.105), m["white"], (x, 1.12, z))
        c.edges(c.y_cylinder(f"clamp.bolt.{i}", 1.10, 1.23, 0.027,
                            m["shaded"], x=x, z=z, segments=6), enabled=False)
    c.y_cylinder("vent.stem", 1.32, 1.48, 0.035, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("vent.hex", 1.465, 1.53, 0.065, m["white"], segments=6)
    # Keep the top of the stub below the lid clamp, not embedded in it.
    c.nozzle("in", (-0.17, PORTS["in"][1], 0), PORTS["in"], m["white"])
    c.nozzle("out", (0.12, c.PIPE_Y, 0), PORTS["out"], m["white"])
    c.check(kind="floor", footprint=(1, 1), height=1.6, ports=PORTS, anim={})


if __name__ == "__main__":
    hd.run_part(build, "filter")
