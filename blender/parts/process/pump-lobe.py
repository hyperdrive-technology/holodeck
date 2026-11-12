"""Skid-mounted rotary lobe pump with opposed process connections.

Layout: -X motor / exposed coupling -- gearbox -- twin-boss pump head +X;
the head's suction and discharge face -Z and +Z respectively.
Origin = floor at footprint centre. Overall 1.90 X x 0.59 Y x 1.0 Z,
within a 2 x 1 footprint; both process axes are at Y=0.32.
Ports: in (0.53, 0.32, -0.50), out (0.53, 0.32, 0.50).
anim.shaft = (-0.17, 0.32, 0), continuous spin about X (0..2*pi).
The visible keyed coupling is its child. hd.accent is the flush motor band.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_b as b
from _common import hd

PORTS = {"in": (0.53, 0.32, -0.50), "out": (0.53, 0.32, 0.50)}
SHAFT = (-0.17, 0.32, 0)


def build():
    m = c.materials()
    c.plinth("baseplate", 1.90, 0.74, 0.055, m["shaded"])
    for i, z in enumerate((-0.16, 0.16)):
        c.box(f"motor.foot.{i}", (0.48, 0.14, 0.10), m["white"], (-0.57, 0.125, z))
    b.motor("motor", m, (-0.55, 0.32, 0), scale=0.65)
    c.box("gearbox.foot", (0.45, 0.065, 0.51), m["white"], (0.20, 0.0875, 0))
    c.box("gearbox", (0.36, 0.40, 0.43), m["white"], (0.20, 0.32, 0))
    c.box("gearbox.lid", (0.31, 0.025, 0.39), m["white"], (0.20, 0.5325, 0))
    # A broad clipped cover and two bosses distinguish this from an end-
    # suction centrifugal pump; no tiny bolt forest around the cover.
    outline = [(-0.22, -0.18), (-0.16, -0.29), (0.16, -0.29), (0.22, -0.18),
               (0.22, 0.18), (0.16, 0.29), (-0.16, 0.29), (-0.22, 0.18)]
    b.extrude("head.casing", outline, 0.36, 0.70, m["white"], axis="X", position=(0, 0.32, 0))
    b.extrude("head.cover", [(y*1.04, z*1.04) for y, z in outline], 0.70, 0.75,
              m["white"], axis="X", position=(0, 0.32, 0))
    for i, z in enumerate((-0.135, 0.135)):
        c.edges(c.x_cylinder(f"head.lobe.boss.{i}", 0.75, 0.78, 0.115,
                            m["white"], y=0.32, z=z), 40)
    for name, sign in (("in", -1), ("out", 1)):
        c.nozzle(name, (0.53, 0.32, sign*0.22), PORTS[name], m["white"])

    c.x_cylinder("motor.axle", -0.3355, -0.28, 0.042, m["shaded"], y=0.32, segments=8)
    c.x_cylinder("gearbox.axle", -0.06, 0.021, 0.042, m["shaded"], y=0.32, segments=8)
    shaft = hd.add_anim("shaft", SHAFT)
    c.x_cylinder("coupling", -0.11, 0.11, 0.074, m["shaded"], segments=8, parent=shaft)
    c.edges(c.box("coupling.key", (0.12, 0.018, 0.035), m["white"],
                  (0, 0.074, 0), parent=shaft), enabled=False)
    c.check(kind="floor", footprint=(2, 1), height=0.60, ports=PORTS, anim={"shaft": SHAFT})


if __name__ == "__main__":
    hd.run_part(build, "pump-lobe")
