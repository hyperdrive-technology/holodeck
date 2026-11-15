"""Wafer butterfly valve, modelled OPEN (lever along +X).

Layout: -X flange -- thin wafer ring -- +X flange; short neck, notched
quadrant plate and paddle lever above. Origin = pipe-axis centre, local
Y=0; place at world Y=0.32. Overall about 0.64 X x 0.88 Y x 0.57 Z;
face-to-face length 0.5, suggested footprint 1 x 1 including lever sweep.
Ports: in (-0.25, 0, 0), out (+0.25, 0, 0).
anim.handle = (0, 0.50, 0), quarter turn about Y; lever and stem cap are
children. For open fraction u, rotate Y=(1-u)*pi/2. hd.accent is the lever.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_a as a
from _common import hd


def build():
    m = c.materials("#c0392b")
    a.ring("wafer.body", -0.07, 0.07, 0.285, 0.185, m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.065, 0, 0), (sign * 0.25, 0, 0), m["white"])
    c.y_cylinder("neck", 0.24, 0.425, 0.08, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("packing.nut", 0.395, 0.445, 0.105, m["white"], segments=c.SMALL_SEG)

    # Three broad notches survive the small iso preview; no sawtooth rim.
    outline = [(0, 0)]
    for degrees, radius in ((-100, 0.17), (-85, 0.17), (-80, 0.145), (-70, 0.145),
                            (-65, 0.17), (-55, 0.17), (-50, 0.145), (-40, 0.145),
                            (-35, 0.17), (-25, 0.17), (-20, 0.145), (-10, 0.145),
                            (-5, 0.17), (10, 0.17)):
        angle = math.radians(degrees)
        outline.append((radius * math.cos(angle), radius * math.sin(angle)))
    c.edges(a.prism("notched.plate", outline, 0.445, 0.47, m["white"]), 40)
    c.edges(c.y_cylinder("stem", 0.44, 0.50, 0.035, m["shaded"]), enabled=False)
    handle = hd.add_anim("handle", (0, 0.50, 0))
    grip = [(-0.065, -0.04), (0.07, -0.04), (0.315, -0.06), (0.385, -0.04),
            (0.385, 0.04), (0.315, 0.06), (0.07, 0.04), (-0.065, 0.04)]
    c.edges(a.prism("lever", grip, 0, 0.055, m["accent"], parent=handle), 40)
    c.edges(c.y_cylinder("stem.cap", 0.055, 0.095, 0.055, m["white"],
                        segments=c.SMALL_SEG, parent=handle), enabled=False)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.29, height=0.90, length=0.5,
            ports={"in": (-0.25, 0, 0), "out": (0.25, 0, 0)}, anim={"handle": (0, 0.50, 0)})


if __name__ == "__main__":
    hd.run_part(build, "valve-butterfly")
