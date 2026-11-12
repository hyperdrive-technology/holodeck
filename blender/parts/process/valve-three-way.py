"""Three-way control valve with an electric actuator, stem at lower stop.

Layout: -X flange -- tee globe -- +X flange, third flange toward +Z;
bonnet and open yoke below a compact actuator with a forward round dial.
Origin = pipe-axis centre (place at world Y=0.32). Overall about
1.0 X x 1.31 Y x 0.79 Z; length 1.0, suggested footprint 1 x 1.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0), branch (0, 0, +0.5).
anim.stem = (0, 0.45, 0), travels +Y by 0.06; the rod and indicator disc
are children. Position is travel fraction, not a promise of port flow split.
hd.accent is the fixed actuator dial ring only; it can show fault state.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_a as a
from _common import hd

STEM_Y = 0.45
STEM_TRAVEL = 0.06
PORTS = {"in": (-0.5, 0, 0), "out": (0.5, 0, 0), "branch": (0, 0, 0.5)}


def build():
    m = c.materials()
    c.lathe("globe", [(-0.29, 0.18), (-0.21, 0.255), (0, 0.29),
                      (0.21, 0.255), (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), PORTS[name], m["white"])
    c.nozzle("branch", (0, 0, 0.19), PORTS["branch"], m["white"])
    c.y_cylinder("bonnet", 0.20, 0.43, 0.16, m["white"], radius_end=0.105)
    c.edges(c.y_cylinder("bonnet.flange", 0.32, 0.37, 0.18, m["white"]), 40)
    a.ring("packing", 0.43, 0.50, 0.11, 0.036, m["white"])
    for i, x in enumerate((-0.14, 0.14)):
        c.box(f"yoke.leg.{i}", (0.055, 0.35, 0.10), m["white"], (x, 0.61, 0))
    c.box("yoke.bridge", (0.39, 0.03, 0.22), m["white"], (0, 0.785, 0))
    a.ring("upper.guide", 0.67, 0.77, 0.06, 0.036, m["white"])
    c.box("actuator.case", (0.39, 0.215, 0.30), m["white"], (0, 0.9075, 0))
    c.box("actuator.lid", (0.405, 0.025, 0.315), m["white"], (0, 1.0275, 0))
    c.edges(c.z_cylinder("dial.ring", 0.15, 0.185, 0.095, m["accent"], y=0.91), 40)
    c.edges(c.z_cylinder("dial.face", 0.18, 0.19, 0.070, m["white"], y=0.91), enabled=False)
    c.edges(c.box("dial.index", (0.015, 0.055, 0.008), m["shaded"],
                  (0, 0.925, 0.195)), enabled=False)

    stem = hd.add_anim("stem", (0, STEM_Y, 0))
    # Hollow lower packing and upper guide accommodate the complete stroke.
    # The rod stops below the solid bridge even at +0.06, rather than clipping it.
    c.edges(c.y_cylinder("stem.rod", -0.015, 0.235, 0.026, m["shaded"],
                        segments=c.SMALL_SEG, parent=stem), enabled=False)
    c.edges(c.y_cylinder("travel.indicator", 0.10, 0.125, 0.075, m["white"], parent=stem), 40)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.30, height=1.35, length=1.0,
            ports=PORTS, anim={"stem": (0, STEM_Y, 0)})


if __name__ == "__main__":
    hd.run_part(build, "valve-three-way")
