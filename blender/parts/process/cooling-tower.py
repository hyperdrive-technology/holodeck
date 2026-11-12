"""Induced-draft package cooling tower with an open fan stack.

Layout: square cold-water basin -> lower louvre banks -> casing -> round
stack; four pitched blades and their hub are visible inside the opening.
Origin = floor at footprint centre. Overall 2.0 X x 2.45 Y x 1.80 Z,
fitting a 2 x 2 footprint and resting on Y=0.
Ports: in (-1.0, 1.50, 0), hot water facing -X; out (1.0, 0.32, 0), +X.
anim.blades = (0, 2.22, 0), continuous spin about Y (0..2*pi per turn);
hub and all four blades are its children. hd.accent is the fan hub only.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
from _batch_c import ring

FAN_Y = 2.22
PORTS = {"in": (-1.0, 1.50, 0), "out": (1.0, c.PIPE_Y, 0)}


def build():
    m = c.materials()
    c.plinth("basin", 1.76, 1.76, 0.41, m["white"])
    c.box("basin.rim", (1.80, 0.075, 1.80), m["white"], (0, 0.41, 0))
    c.box("casing", (1.54, 1.38, 1.54), m["white"], (0, 1.11, 0))
    # Four broad tilted slats per bank are readable at icon size; individual
    # fill-pack fins would turn the lower casing into dense outline noise.
    for side in (-1, 1):
        for i in range(4):
            y = 0.57 + i * 0.16
            c.edges(c.box(f"louvre.z{side}.{i}", (1.39, 0.065, 0.11), m["white"],
                          (0, y, side * 0.805), rotation=(side * 0.34, 0, 0)), 40)
            c.edges(c.box(f"louvre.x{side}.{i}", (0.11, 0.065, 1.39), m["white"],
                          (side * 0.805, y, 0), rotation=(0, 0, -side * 0.34)), 40)
    c.box("roof", (1.62, 0.09, 1.62), m["white"], (0, 1.835, 0))
    ring("fan.stack", 1.875, 2.40, 0.64, 0.55, m["white"])
    c.edges(ring("fan.rim", 2.395, 2.45, 0.665, 0.55, m["white"]), 40)
    # Fixed shaft stops below the rotating hub; the stack bore contains the
    # entire swept blade envelope, not just the rest pose. Sweep verification
    # leaves 0.041 between the blade tips and the 12-sided bore's flat faces
    # (use the bore apothem, not its larger vertex radius, for clearance).
    c.y_cylinder("fan.support", 1.87, FAN_Y - 0.06, 0.07, m["shaded"], segments=c.SMALL_SEG)
    fan = hd.add_anim("blades", (0, FAN_Y, 0))
    c.edges(c.lathe("fan.hub", [(-0.06, 0.12), (0.04, 0.12), (0.10, 0.07)],
                    m["accent"], parent=fan), 40)
    # Swept, pitched polygon blades: their broad tops remain distinct through
    # the stack opening without requiring a grille or transparent material.
    outline = [(0.085, -0.045), (0.41, -0.10), (0.49, -0.015),
               (0.455, 0.11), (0.15, 0.075)]
    n = len(outline)
    for i in range(4):
        vertices = [(x, layer + z * 0.32, z) for layer in (-0.02, 0.02) for x, z in outline]
        faces = [tuple(reversed(range(n))), tuple(n + j for j in range(n))]
        faces += [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
        c.edges(c.mesh(f"fan.blade.{i}", vertices, faces, m["shaded"],
                       rotation=(0, i * math.pi / 2, 0), parent=fan), 40)
    c.nozzle("in", (-0.70, 1.50, 0), PORTS["in"], m["white"])
    c.nozzle("out", (0.76, c.PIPE_Y, 0), PORTS["out"], m["white"])
    c.check(kind="floor", footprint=(2, 2), height=2.6, ports=PORTS,
            anim={"blades": (0, FAN_Y, 0)})


if __name__ == "__main__":
    hd.run_part(build, "cooling-tower")
