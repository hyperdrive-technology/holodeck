"""Flanged ball valve, modelled OPEN (lever along +X).

Layout: -X flange -- round body -- +X flange; short neck and lever above.
Origin = pipe-axis centre, local Y=0; place at world Y=0.32. Overall about
1.0 X x 0.9 Y x 0.58 Z; one-cell footprint, face-to-face length 1.0.
Ports: in (-0.5, 0, 0), out (+0.5, 0, 0).
anim.handle = (0, 0.50, 0), quarter turn about Y. Lever and stem cap are
children. For open fraction u, rotate Y=(1-u)*pi/2; hd.accent is the lever.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials("#c0392b")
    c.lathe("body", [(-0.29, 0.18), (-0.22, 0.25), (-0.10, 0.285),
                     (0.10, 0.285), (0.22, 0.25), (0.29, 0.18)], m["white"], axis="X")
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (sign * 0.23, 0, 0), (sign * 0.5, 0, 0), m["white"])
    c.y_cylinder("neck", 0.22, 0.42, 0.095, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("packing.nut", 0.39, 0.46, 0.12, m["white"], segments=c.SMALL_SEG)
    c.edges(c.y_cylinder("stem", 0.445, 0.52, 0.045, m["white"]), enabled=False)

    handle = hd.add_anim("handle", (0, 0.50, 0))
    # Preview round two: a clipped, widening paddle reads as a grip at small
    # size; the first plain rectangular bar looked like a generic crosspiece.
    outline = [(-0.08, -0.04), (0.05, -0.04), (0.36, -0.065), (0.44, -0.045),
               (0.44, 0.045), (0.36, 0.065), (0.05, 0.04), (-0.08, 0.04)]
    n = len(outline)
    vertices = [(x, y, z) for y in (0, 0.055) for x, z in outline]
    faces = [tuple(reversed(range(n))), tuple(n + i for i in range(n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    c.edges(c.mesh("lever", vertices, faces, m["accent"], parent=handle), 40)
    c.edges(c.y_cylinder("stem.cap", 0.055, 0.095, 0.065, m["white"],
                        segments=c.SMALL_SEG, parent=handle), enabled=False)
    c.check(kind="inline", footprint=(1, 1), y_min=-0.30, height=0.95, length=1.0,
            ports={"in": (-0.5, 0, 0), "out": (0.5, 0, 0)}, anim={"handle": (0, 0.50, 0)})


if __name__ == "__main__":
    hd.run_part(build, "valve-ball")
