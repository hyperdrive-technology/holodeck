"""One-line description of the part, modelled OPEN (or CLOSED).

Layout: -X flange -- body -- +X flange; neck and lever above.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Overall about
1.0 X x 0.9 Y x 0.58 Z; one-cell footprint, face-to-face length 1.0.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0).
anim.handle = (0, 0.50, 0), quarter turn about Y. The lever is its child.
State colour: hd.accent on the lever only.

Template for a new process part: copy to blender/parts/process/<slug>.py,
change the slug in run_part, and replace the geometry. The docstring layout
(layout, origin, size, ports, anim nodes, state colour) is part of the style.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd

HANDLE_Y = 0.50


def build():
    m = c.materials()
    c.lathe("body", [(-0.29, 0.18), (-0.22, 0.25), (-0.10, 0.285),
                     (0.10, 0.285), (0.22, 0.25), (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.y_cylinder("neck", 0.22, 0.42, 0.095, m["white"], segments=c.SMALL_SEG)

    # Moving geometry is a child of its anim pivot, positioned relative to it.
    handle = hd.add_anim("handle", (0, HANDLE_Y, 0))
    c.edges(c.box("lever", (0.44, 0.055, 0.09), m["accent"], (0.22, 0.03, 0), parent=handle), 40)

    c.check(kind="inline", footprint=(1, 1), y_min=-0.30, height=0.95, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={"handle": (0, HANDLE_Y, 0)})


if __name__ == "__main__":
    hd.run_part(build, "example-part")
