"""Compact block-body solenoid valve with a vertical coil and cable plug.

Layout: -X flange -- square valve block -- +X flange; coil box above,
DIN-style cable plug and gland projecting toward +Z.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Overall about
0.50 X x 0.84 Y x 0.61 Z; length 0.5, suggested footprint 1 x 1.
Ports: in (-0.25, 0, 0), out (+0.25, 0, 0). No animation nodes.
hd.accent is the coil box only; bind energised to its state colour.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials()
    c.box("body", (0.34, 0.34, 0.40), m["white"])
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.12, 0, 0), (sign * 0.25, 0, 0), m["white"])
    c.y_cylinder("bonnet.hex", 0.16, 0.25, 0.105, m["white"], segments=6)
    c.y_cylinder("coil.seat", 0.24, 0.29, 0.085, m["white"], segments=c.SMALL_SEG)
    c.box("coil", (0.23, 0.25, 0.25), m["accent"], (0, 0.405, 0))
    c.y_cylinder("coil.retainer", 0.53, 0.57, 0.065, m["white"], segments=6)
    c.box("cable.plug", (0.16, 0.17, 0.14), m["white"], (0, 0.40, 0.19))
    c.edges(c.z_cylinder("cable.gland", 0.25, 0.34, 0.045, m["shaded"],
                        y=0.40, segments=c.SMALL_SEG), 45)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.27, height=0.85, length=0.5,
            ports={"in": (-0.25, 0, 0), "out": (0.25, 0, 0)}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "valve-solenoid")
