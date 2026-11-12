"""Packaged screw compressor with service doors and cooling-air intake.

Layout: low plinth -- enclosure with +Z doors and controller -- roof cowl;
louvred intake and low discharge occupy the +X end.
Origin = floor at footprint centre. Overall 1.93 X x 1.46 Y x 0.94 Z,
including the discharge, within a 2 x 1 footprint. Enclosure is about
1.74 X x 1.20 Y x 0.84 Z, on a 0.10-high plinth.
port.out = (1.0, 0.32, 0), facing +X at the standard low pipe axis.
No animation nodes. hd.accent is the controller screen bezel only;
running/load/fault may tint it, with numeric readings supplied by the UI.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_b as b
from _common import hd


def build():
    m = c.materials()
    c.plinth("plinth", 1.86, 0.88, 0.10, m["shaded"])
    c.box("enclosure", (1.74, 1.20, 0.84), m["white"], (0, 0.70, 0))
    for i, x in enumerate((-0.423, 0.423)):
        c.box(f"door.{i}", (0.79, 1.10, 0.025), m["white"], (x, 0.70, 0.4325))
    c.box("door.handle", (0.035, 0.18, 0.04), m["shaded"], (0.105, 0.70, 0.465))
    c.box("controller.bezel", (0.34, 0.23, 0.025), m["accent"], (0.425, 1.065, 0.4575))
    c.edges(c.box("controller.screen", (0.275, 0.165, 0.008), m["shaded"],
                  (0.425, 1.065, 0.474)), enabled=False)
    c.box("intake.recess", (0.012, 0.49, 0.61), m["shaded"], (0.876, 0.945, 0))
    for i in range(4):
        c.edges(c.box(f"intake.louvre.{i}", (0.045, 0.045, 0.57), m["white"],
                      (0.895, 0.78 + i*0.11, 0), rotation=(0, 0, 0.35)), 45)
    # A single clipped hood reads as a cooling-air cowl at small size; the
    # rear lip is a broad outlet, not dozens of thin grille slats.
    roof = [(-0.55, 1.30), (0.45, 1.30), (0.45, 1.40), (0.29, 1.46), (-0.55, 1.46)]
    b.extrude("cooling.cowl", roof, -0.30, 0.30, m["white"])
    c.box("cooling.outlet", (0.012, 0.065, 0.48), m["shaded"], (-0.556, 1.365, 0))
    c.nozzle("out", (0.82, 0.32, 0), (1.0, 0.32, 0), m["white"])
    c.check(kind="floor", footprint=(2, 1), height=1.47, ports={"out": (1.0, 0.32, 0)})


if __name__ == "__main__":
    hd.run_part(build, "compressor")
