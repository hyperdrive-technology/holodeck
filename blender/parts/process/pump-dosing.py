"""Diaphragm metering pump with vertical check-valve connections.

Layout: small motor at -X -- gearbox / exposed pushrod -- liquid end +X;
suction enters the head from below, discharge leaves vertically above.
Origin = floor at footprint centre. Overall about 0.86 X x 0.94 Y x
0.55 Z, within a 1 x 1 footprint. Small process radius = 0.10.
Ports: in (0.30, 0.12, 0), facing -Y and clear of the floor;
out (0.30, 0.94, 0), facing +Y. These require vertical small-bore routing.
anim.stem = (0.12, 0.52, 0), reciprocates along +X by 0..0.04;
the visible rod and collar are children. hd.accent is the +Z stroke knob.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_b as b
from _common import hd

PORTS = {"in": (0.30, 0.12, 0), "out": (0.30, 0.94, 0)}
STEM = (0.12, 0.52, 0)
STROKE = 0.04


def build():
    m = c.materials()
    c.plinth("foot", 0.62, 0.46, 0.065, m["shaded"], x=-0.11)
    c.box("gearbox.pedestal", (0.27, 0.13, 0.30), m["white"], (-0.10, 0.13, 0))
    c.box("gearbox", (0.25, 0.40, 0.34), m["white"], (-0.105, 0.39, 0))
    c.box("gearbox.cap", (0.27, 0.035, 0.36), m["white"], (-0.105, 0.6075, 0))
    # Preview/build feedback: this motor's tiny terminal box was mostly
    # buried in the gearbox cap and pushed the GLB over 60,000 bytes. The
    # pilot fins and cowl carry the silhouette without that hidden detail.
    b.motor("motor", m, (-0.25, 0.47, 0), scale=0.40, accent=False, terminal=False)
    c.x_cylinder("head.body", 0.26, 0.37, 0.18, m["white"], y=0.52)
    c.edges(c.x_cylinder("head.front.disc", 0.37, 0.40, 0.195, m["white"], y=0.52), 40)
    c.edges(c.x_cylinder("head.centre.boss", 0.40, 0.415, 0.065, m["white"], y=0.52), 40)
    for name, base in (("in", (0.30, 0.38, 0)), ("out", (0.30, 0.66, 0))):
        c.nozzle(name, base, PORTS[name], m["white"], radius=0.10,
                 flange_radius=0.135, thickness=0.035, segments=8)
    c.y_cylinder("in.check.housing", 0.235, 0.36, 0.12, m["white"], x=0.30, segments=8)
    c.y_cylinder("out.check.housing", 0.68, 0.805, 0.12, m["white"], x=0.30, segments=8)
    c.z_cylinder("stroke.knob.seat", 0.17, 0.215, 0.075, m["white"], x=-0.10, y=0.46, segments=8)
    c.edges(c.z_cylinder("stroke.knob", 0.215, 0.30, 0.09, m["accent"],
                        x=-0.10, y=0.46, segments=8), 50)
    c.edges(c.box("stroke.knob.mark", (0.014, 0.055, 0.006), m["white"],
                  (-0.10, 0.482, 0.303)), enabled=False)
    # Real bores, not solid caps: the rod stays inside these guides through
    # its complete stroke without crossing a fixed surface or floating free.
    b.ring("pushrod.guide.rear", 0.02, 0.10, 0.060, 0.034, m["white"],
           axis="X", position=(0, 0.52, 0))
    b.ring("pushrod.guide.front", 0.18, 0.26, 0.060, 0.034, m["white"],
           axis="X", position=(0, 0.52, 0))
    stem = hd.add_anim("stem", STEM)
    c.edges(c.x_cylinder("pushrod", -0.07, 0.10, 0.026, m["shaded"],
                        segments=8, parent=stem), enabled=False)
    c.edges(c.x_cylinder("pushrod.collar", -0.015, 0.005, 0.045, m["shaded"],
                        segments=8, parent=stem), 50)
    c.check(kind="floor", footprint=(1, 1), height=0.96, ports=PORTS, anim={"stem": STEM})


if __name__ == "__main__":
    hd.run_part(build, "pump-dosing")
