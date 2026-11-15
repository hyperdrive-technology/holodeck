"""Globe control valve with pneumatic diaphragm actuator, modelled CLOSED.

Layout: -X flange -- globe -- +X flange; bonnet, open yoke and diaphragm
stack above it. A positioner hangs from the +X yoke leg, facing +Z.
Origin = pipe-axis centre (place at world Y=0.32). Size about 1.0 X x
1.61 Y x 0.72 Z, including the body below the axis; footprint 1 x 1.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0).
anim.stem = (0, 0.48, 0), travels +Y by 0.08 to fully open. The stem and
indicator disc are its children; casing, yoke and positioner stay fixed.
State colour: hd.accent on the upper diaphragm cap only.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd

STEM_Y = 0.48
STEM_TRAVEL = 0.08


def build():
    m = c.materials()
    c.lathe("globe", [(-0.29, 0.18), (-0.21, 0.255), (0, 0.29),
                      (0.21, 0.255), (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.y_cylinder("bonnet", 0.20, 0.47, 0.16, m["white"], radius_end=0.10)
    c.y_cylinder("bonnet.flange", 0.34, 0.39, 0.18, m["white"])
    c.y_cylinder("packing", 0.445, 0.515, 0.115, m["white"], segments=c.SMALL_SEG)

    # An actual open yoke, not a filled cylinder: daylight around the moving
    # stem is the strongest small-scale cue for an analogue control valve.
    for i, x in enumerate((-0.15, 0.15)):
        c.box(f"yoke.leg.{i}", (0.065, 0.53, 0.095), m["white"], (x, 0.75, 0))
    c.box("yoke.bridge", (0.365, 0.07, 0.16), m["white"], (0, 1.01, 0))
    c.lathe("actuator.lower", [(1.025, 0.13), (1.10, 0.25),
                               (1.165, 0.36), (1.20, 0.36)], m["white"])
    c.edges(c.lathe("actuator.cap", [(1.20, 0.36), (1.25, 0.33),
                                    (1.305, 0.22), (1.32, 0.10)], m["accent"]), 45)

    stem = hd.add_anim("stem", (0, STEM_Y, 0))
    c.edges(c.y_cylinder("stem.rod", -0.10, 0.56, 0.027, m["shaded"],
                        segments=c.SMALL_SEG, parent=stem), enabled=False)
    c.y_cylinder("travel.indicator", 0.135, 0.16, 0.08, m["white"], parent=stem)
    c.box("positioner", (0.17, 0.24, 0.18), m["white"], (0.255, 0.72, 0.04))
    c.box("positioner.face", (0.105, 0.115, 0.008), m["shaded"], (0.255, 0.745, 0.134))

    c.check(kind="inline", footprint=(1, 1), y_min=-0.30, height=1.65, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={"stem": (0, STEM_Y, 0)})


if __name__ == "__main__":
    hd.run_part(build, "valve-control")
