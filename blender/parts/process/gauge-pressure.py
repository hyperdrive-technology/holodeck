"""Bottom-entry pressure gauge with a recessed dial, modelled at zero.

Layout: bottom hex -> short stem -> round case; dial faces +Z.
Origin = process fitting's bottom face. Overall 0.35 X x 0.50 Y x 0.13 Z;
suggested mounting envelope 0.36 x 0.16. port.process = (0, 0, 0).
anim.needle = (0, 0.325, 0.059), rotating about Z; the pointer is its child.
Zero points lower-left (7 o'clock). For normalised pressure u, rotation Z
= -u * 3*pi/2: a 270-degree clockwise sweep viewed from +Z.
State colour: hd.accent on the pointer only. Scale ticks are unlettered.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
import _batch_d as d

DIAL_Y = 0.325
NEEDLE_Z = 0.059
NEEDLE_SWEEP = -3 * math.pi / 2


def build():
    m = c.materials("#c0392b")
    c.y_cylinder("process.hex", 0, 0.055, 0.055, m["white"], segments=6)
    c.y_cylinder("stem", 0.045, 0.175, 0.030, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("case.socket", 0.14, 0.195, 0.045, m["white"], segments=c.SMALL_SEG)
    hd.add_port("process", (0, 0, 0))
    c.z_cylinder("case", -0.05, 0.045, 0.175, m["white"], y=DIAL_Y)
    d.ring("dial.rim", 0.040, 0.075, 0.175, 0.145, m["white"], DIAL_Y)
    c.edges(c.z_cylinder("dial.face", 0.044, 0.050, 0.145, m["white"], y=DIAL_Y), enabled=False)
    # The pointer occupies Z=0.059..0.063: clear of face/ticks behind it and
    # hub in front. The hollow rim leaves its entire circular sweep open.
    for i in range(7):
        a = math.radians(-120 - i * 45)
        c.edges(c.box(f"dial.tick.{i}", (0.022, 0.008, 0.003), m["shaded"],
                      (0.126 * math.cos(a), DIAL_Y + 0.126 * math.sin(a), 0.052),
                      rotation=(0, 0, a)), enabled=False)
    needle = hd.add_anim("needle", (0, DIAL_Y, NEEDLE_Z))
    # Local +X arrow, including a short counterweight, is rotated to 7 o'clock.
    outline = [(-0.028, -0.011), (0.025, -0.011), (0.108, 0),
               (0.025, 0.011), (-0.028, 0.011)]
    n = len(outline)
    vertices = [(x, y, z) for z in (0, 0.004) for x, y in outline]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    c.edges(c.mesh("pointer", vertices, faces, m["accent"],
                   rotation=(0, 0, math.radians(-120)), parent=needle), enabled=False)
    c.edges(c.z_cylinder("dial.hub", 0.066, 0.074, 0.018, m["white"],
                        y=DIAL_Y, segments=c.SMALL_SEG), enabled=False)
    c.check(kind="mounted", footprint=(0.36, 0.16), height=0.50,
            ports={"process": (0, 0, 0)}, anim={"needle": (0, DIAL_Y, NEEDLE_Z)})


if __name__ == "__main__":
    hd.run_part(build, "gauge-pressure")
