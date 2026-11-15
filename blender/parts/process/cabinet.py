"""Floor-standing control cabinet with operator window and status beacon.

Layout: floor plinth -> tall enclosure -> small beacon; door faces +Z.
Origin = floor at footprint centre. Body 0.94 X x 1.68 Y x 0.50 Z on a
0.10 plinth; overall 0.98 X x 1.94 Y x 0.61 Z including the handle, fitting
a 1 x 1 footprint.
Ports: none. Animation nodes: none. hd.accent is the top beacon lens only.
Door seam, handle, operator window and four broad louvres are geometry;
no painted labels or tiny vents that turn into outline noise at iso scale.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials("#49a57a")
    c.plinth("plinth", 0.98, 0.56, 0.10, m["shaded"])
    c.box("enclosure", (0.94, 1.68, 0.50), m["white"], (0, 0.94, 0))
    c.box("door", (0.84, 1.54, 0.025), m["white"], (0, 0.94, 0.2575))
    c.box("operator.frame", (0.32, 0.22, 0.025), m["white"], (-0.08, 1.39, 0.2825))
    c.box("operator.window", (0.255, 0.15, 0.008), m["shaded"], (-0.08, 1.39, 0.299))
    c.box("door.handle", (0.04, 0.24, 0.055), m["shaded"], (0.32, 0.94, 0.2975))
    for i in range(4):
        c.box(f"vent.louvre.{i}", (0.39, 0.035, 0.035), m["white"],
              (-0.04, 0.42 + i * 0.075, 0.275), rotation=(-0.35, 0, 0))
    c.y_cylinder("beacon.base", 1.78, 1.825, 0.065, m["white"], x=0.30, segments=c.SMALL_SEG)
    c.edges(c.lathe("beacon.lens", [(1.825, 0.06), (1.91, 0.06), (1.94, 0.035)],
                    m["accent"], position=(0.30, 0, 0), segments=c.SMALL_SEG), enabled=False)
    c.check(kind="floor", footprint=(1, 1), height=1.95)


if __name__ == "__main__":
    hd.run_part(build, "cabinet")
