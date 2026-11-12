"""Inline electromagnetic flowmeter with a coil barrel and round transmitter.

Layout: -X flange -- fat coil housing -- +X flange; short neck and the
transmitter-family head above, display toward +Z and cable gland at +X.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Overall about
1.0 X x 1.07 Y x 0.58 Z; face-to-face length 1.0, footprint 1 x 1.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0). No animation nodes.
State colour: hd.accent on the display bezel ring only.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
import _batch_d as d


def build():
    m = c.materials()
    c.lathe("coil.housing", [(-0.28, 0.22), (-0.22, 0.29),
                             (0.22, 0.29), (0.28, 0.22)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.24, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.box("neck.seat", (0.19, 0.065, 0.15), m["white"], (0, 0.29, 0))
    c.y_cylinder("neck", 0.30, 0.505, 0.055, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("neck.collar", 0.465, 0.53, 0.07, m["white"], segments=c.SMALL_SEG)
    d.transmitter_head(m, y=0.63)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.29, height=1.07, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "flowmeter-mag")
