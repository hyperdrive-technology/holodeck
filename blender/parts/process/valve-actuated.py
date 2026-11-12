"""Ball valve with a pneumatic rack-and-pinion rotary actuator, OPEN.

Layout: -X flange -- ball body -- +X flange; open bracket supports a
box-like actuator across Z, with end caps and a top position puck.
Origin = pipe-axis centre (place at world Y=0.32). Overall about
1.0 X x 1.27 Y x 0.78 Z; face-to-face length 1.0, footprint 1 x 1.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0).
anim.handle = (0, 0.91, 0), quarter turn about Y; puck and raised indicator
bar are children. For open fraction u, rotate Y=(1-u)*pi/2.
hd.accent is the indicator bar only; the actuator casing remains white.
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
    # Same body profile and mating dimensions as the manual valve-ball pilot.
    c.lathe("body", [(-0.29, 0.18), (-0.22, 0.25), (-0.10, 0.285),
                     (0.10, 0.285), (0.22, 0.25), (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.y_cylinder("neck", 0.22, 0.42, 0.095, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("packing.nut", 0.39, 0.46, 0.12, m["white"], segments=c.SMALL_SEG)
    c.edges(c.y_cylinder("drive.stem", 0.445, 0.66, 0.045, m["shaded"]), enabled=False)
    for i, x in enumerate((-0.125, 0.125)):
        c.box(f"bracket.leg.{i}", (0.055, 0.18, 0.15), m["white"], (x, 0.535, 0))
    c.box("bracket.plate", (0.36, 0.04, 0.25), m["white"], (0, 0.63, 0))
    # An octagonal box section reads as an extruded actuator, not a second valve.
    section = [(-0.13, 0.65), (0.13, 0.65), (0.185, 0.695), (0.185, 0.835),
               (0.13, 0.88), (-0.13, 0.88), (-0.185, 0.835), (-0.185, 0.695)]
    a.prism("actuator.case", section, -0.31, 0.31, m["white"], axis="Z")
    for i, sign in enumerate((-1, 1)):
        cap = [(x * 1.06, 0.765 + (y - 0.765) * 1.08) for x, y in section]
        z0, z1 = sorted((sign * 0.305, sign * 0.39))
        c.edges(a.prism(f"actuator.end.cap.{i}", cap, z0, z1, m["white"], axis="Z"), 40)
    c.edges(c.y_cylinder("indicator.bearing", 0.88, 0.91, 0.065, m["shaded"]), enabled=False)
    handle = hd.add_anim("handle", (0, 0.91, 0))
    c.edges(c.y_cylinder("indicator.puck", 0, 0.045, 0.12, m["white"], parent=handle), 40)
    c.edges(c.box("indicator.bar", (0.19, 0.03, 0.045), m["accent"],
                  (0, 0.06, 0), parent=handle), enabled=False)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.30, height=1.30, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={"handle": (0, 0.91, 0)})


if __name__ == "__main__":
    hd.run_part(build, "valve-actuated")
