"""Three-tier stack light on a short mounting pole.

Layout: round foot -> pole -> three separated lens tiers -> weather cap.
Origin = underside of the round base. Overall 0.20 X x 0.70 Y x 0.20 Z;
suggested mounting envelope 0.22 x 0.22. No ports or animation nodes.
State colour: hd.accent on tier.0, tier.1, tier.2 only, bottom to top.
Each tier is a separate mesh; independent tier colours require per-mesh
material instances at runtime (the authored hd.accent material is shared).
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials("#49a57a")
    c.edges(c.y_cylinder("base", 0, 0.045, 0.10, m["white"]), 40)
    c.y_cylinder("pole.socket", 0.035, 0.08, 0.044, m["white"], segments=c.SMALL_SEG)
    c.edges(c.y_cylinder("pole", 0.06, 0.265, 0.022, m["shaded"],
                        segments=c.SMALL_SEG), enabled=False)
    c.edges(c.lathe("stack.base", [(0.25, 0.045), (0.27, 0.10),
                                   (0.285, 0.10)], m["white"]), 40)
    for i in range(3):
        y = 0.285 + i * 0.125
        c.edges(c.y_cylinder(f"tier.{i}", y, y + 0.11, 0.092, m["accent"]), enabled=False)
        c.edges(c.y_cylinder(f"separator.{i}", y + 0.11, y + 0.125,
                            0.10, m["white"]), 40)
    c.edges(c.lathe("cap", [(0.66, 0.10), (0.685, 0.095),
                            (0.70, 0.06)], m["white"]), 40)
    c.check(kind="mounted", footprint=(0.22, 0.22), height=0.70, ports={}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "beacon")
