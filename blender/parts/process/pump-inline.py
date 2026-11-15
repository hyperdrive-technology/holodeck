"""Vertical inline centrifugal pump with an open lantern and finned motor.

Layout: -X flange -- volute -- +X flange; lantern, vertical pilot-family
motor and top fan hub above. Origin = pipe-axis centre, local Y=0;
place at world Y=0.32. Overall 1.0 X x 1.59 Y x 0.58 Z, envelope 1 x 1.
Ports: in (-0.5, 0, 0), out (0.5, 0, 0); face-to-face length 1.0.
anim.shaft = (0, 0.47, 0), continuous spin about Y (0..2*pi); coupling,
coupling key and raised top fan hub are children. hd.accent is a flush
drive-end motor band. Nothing is scaled by the scene placement.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_b as b
from _common import hd

SHAFT = (0, 0.47, 0)


def build():
    m = c.materials()
    c.lathe("volute", [(-0.28, 0.12), (-0.23, 0.24), (-0.12, 0.29),
                        (0.09, 0.29), (0.19, 0.22), (0.26, 0.13)], m["white"])
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign*0.20, 0, 0), (sign*0.50, 0, 0), m["white"])
    c.edges(c.y_cylinder("lantern.lower", 0.25, 0.30, 0.17, m["white"]), 40)
    c.edges(c.y_cylinder("lantern.upper", 0.60, 0.64, 0.17, m["white"]), 40)
    for i, x in enumerate((-0.135, 0.135)):
        c.box(f"lantern.leg.{i}", (0.055, 0.32, 0.08), m["white"], (x, 0.45, -0.035))
    b.motor("motor", m, (0, 0.90, 0), scale=0.82, rotation=(0, 0, -math.pi/2))
    c.y_cylinder("lower.axle", 0.30, 0.37, 0.033, m["shaded"], segments=8)
    c.y_cylinder("upper.axle", 0.57, 0.60, 0.033, m["shaded"], segments=8)
    shaft = hd.add_anim("shaft", SHAFT)
    c.y_cylinder("coupling", -0.10, 0.10, 0.062, m["shaded"], segments=8, parent=shaft)
    c.edges(c.box("coupling.key", (0.018, 0.105, 0.025), m["white"],
                  (0.062, 0, 0), parent=shaft), enabled=False)
    # The cowl ends at 1.2772. Keep the rotating hub above its closed face;
    # it shares this pivot, so a single Y rotation drives both visible ends.
    c.y_cylinder("fan.hub", 1.278-0.47, 1.305-0.47, 0.060,
                 m["shaded"], segments=8, parent=shaft)
    c.edges(c.box("fan.hub.key", (0.07, 0.012, 0.018), m["white"],
                  (0.009, 1.311-0.47, 0), parent=shaft), enabled=False)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.28, height=1.60, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={"shaft": SHAFT})


if __name__ == "__main__":
    hd.run_part(build, "pump-inline")
