"""Shallow field junction box with a screwed lid and three bottom glands.

Layout: three downward glands -> shallow enclosure and front lid (+Z),
with a mounting lug on each side. Origin = bottom centre, at gland tips.
Overall 0.42 X x 0.40 Y x 0.20 Z; mounting envelope 0.44 x 0.24.
No ports or animation nodes. No state colour; all surfaces are hd.white
or hd.shaded. Four broad screw bosses remain readable at small iso scale.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials()
    c.box("enclosure", (0.34, 0.29, 0.16), m["white"], (0, 0.245, 0))
    c.box("lid.seal", (0.35, 0.30, 0.008), m["shaded"], (0, 0.245, 0.083))
    c.box("lid", (0.36, 0.31, 0.018), m["white"], (0, 0.245, 0.094))
    for i, (x, y) in enumerate(((-0.14, 0.125), (0.14, 0.125),
                                (-0.14, 0.365), (0.14, 0.365))):
        c.edges(c.z_cylinder(f"screw.boss.{i}", 0.102, 0.115, 0.022,
                            m["white"], x=x, y=y, segments=c.SMALL_SEG), 50)
        c.edges(c.box(f"screw.slot.{i}", (0.024, 0.004, 0.002), m["shaded"],
                      (x, y, 0.116)), enabled=False)
    for i, x in enumerate((-0.1875, 0.1875)):
        c.box(f"mount.lug.{i}", (0.045, 0.10, 0.028), m["white"], (x, 0.25, -0.06))
        c.edges(c.z_cylinder(f"mount.recess.{i}", -0.045, -0.042, 0.010,
                            m["shaded"], x=x, y=0.25, segments=c.SMALL_SEG), enabled=False)
    # Iso preview: centred glands disappeared behind the projecting lid.
    # Set them forward under its lip so all three read from above, while
    # keeping the original envelope, gland length and bottom anchor plane.
    for i, x in enumerate((-0.105, 0, 0.105)):
        c.y_cylinder(f"gland.hex.{i}", 0.065, 0.105, 0.038, m["white"],
                     x=x, z=0.06, segments=6)
        c.edges(c.y_cylinder(f"gland.barrel.{i}", 0.018, 0.070, 0.029,
                            m["white"], x=x, z=0.06, segments=c.SMALL_SEG), 50)
        c.edges(c.y_cylinder(f"gland.tip.{i}", 0, 0.020, 0.022, m["shaded"],
                            x=x, z=0.06, segments=c.SMALL_SEG), enabled=False)
    c.check(kind="mounted", footprint=(0.44, 0.24), height=0.40, ports={}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "junction-box")
