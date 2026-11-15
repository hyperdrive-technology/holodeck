"""Swing check valve with a raised bolted cover and a +X flow arrow.

Layout: -X flange -- broad check body -- +X flange; hinged cover hump on
top, raised arrow on the +Z side. No handle or exposed moving assembly.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Overall about
1.0 X x 0.75 Y x 0.60 Z; length 1.0, suggested footprint 1 x 1.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0). No animation nodes.
hd.accent is the flow arrow only; no live parameter is required.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_a as a
from _common import hd


def build():
    m = c.materials()
    c.lathe("body", [(-0.29, 0.18), (-0.20, 0.285), (0.20, 0.285),
                     (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.lathe("cover.hump", [(0.19, 0.18), (0.30, 0.21), (0.38, 0.21)],
            m["white"], position=(-0.025, 0, 0))
    c.edges(c.y_cylinder("cover.cap", 0.38, 0.435, 0.235, m["white"], x=-0.025), 40)
    for i, (x, z) in enumerate(((-0.15, -0.125), (0.10, -0.125),
                               (-0.15, 0.125), (0.10, 0.125))):
        c.edges(c.y_cylinder(f"cover.bolt.{i}", 0.435, 0.465, 0.027, m["shaded"],
                            x=x, z=z, segments=6), enabled=False)
    c.edges(c.z_cylinder("cover.hinge", -0.14, 0.14, 0.045, m["white"],
                        x=-0.235, y=0.36, segments=c.SMALL_SEG), 45)
    for i, z in enumerate((-0.09, 0.09)):
        c.box(f"hinge.lug.{i}", (0.07, 0.07, 0.05), m["white"], (-0.20, 0.365, z))
    arrow = [(-0.16, -0.03), (0.04, -0.03), (0.04, -0.08), (0.19, 0),
             (0.04, 0.08), (0.04, 0.03), (-0.16, 0.03)]
    c.edges(a.prism("flow.arrow", arrow, 0.26, 0.305, m["accent"], axis="Z",
                    position=(0, -0.025, 0)), enabled=False)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.29, height=0.76, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "valve-check")
