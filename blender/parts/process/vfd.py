"""Wall-mounted variable frequency drive with rear heatsink and front keypad.

Layout: bottom gland plate -> vented upright enclosure -> upper keypad;
five broad heatsink fins run vertically along the back (-Z). Front is +Z.
Origin = bottom centre, at the gland tips. Overall about 0.40 X x 0.70 Y x
0.31 Z; suggested mounting envelope 0.42 x 0.32. No ports or anim nodes.
State colour: hd.accent on the display bezel only; display is unlettered.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials()
    c.box("enclosure", (0.36, 0.63, 0.20), m["white"], (0, 0.385, 0.02))
    c.box("heatsink.plate", (0.40, 0.60, 0.03), m["shaded"], (0, 0.38, -0.095))
    for i in range(5):
        c.box(f"heatsink.fin.{i}", (0.027, 0.58, 0.05), m["white"],
              (-0.172 + i * 0.086, 0.38, -0.125))
    c.box("front.cover", (0.335, 0.59, 0.016), m["white"], (0, 0.38, 0.126))
    c.box("keypad.module", (0.255, 0.21, 0.012), m["white"], (0, 0.525, 0.14))
    c.box("display.bezel", (0.205, 0.09, 0.008), m["accent"], (0, 0.565, 0.15))
    c.edges(c.box("display.window", (0.165, 0.052, 0.003), m["shaded"],
                  (0, 0.565, 0.1555)), enabled=False)
    for i, x in enumerate((-0.072, 0, 0.072)):
        c.edges(c.box(f"keypad.key.{i}", (0.042, 0.030, 0.008), m["shaded"],
                      (x, 0.475, 0.15)), enabled=False)
    # Broad slots, not a dense grille: this is a small wall device beside
    # a full-size cabinet, so tiny perforations would become outline noise.
    for i, y in enumerate((0.12, 0.158, 0.65)):
        c.edges(c.box(f"vent.slot.{i}", (0.23, 0.016, 0.004), m["shaded"],
                      (0, y, 0.136)), enabled=False)
    c.box("gland.plate", (0.30, 0.035, 0.18), m["shaded"], (0, 0.0525, 0.02))
    for i, x in enumerate((-0.085, 0.085)):
        c.y_cylinder(f"cable.gland.{i}", 0, 0.045, 0.028, m["white"],
                     x=x, z=0.02, segments=6)
    c.check(kind="mounted", footprint=(0.42, 0.32), height=0.70, ports={}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "vfd")
