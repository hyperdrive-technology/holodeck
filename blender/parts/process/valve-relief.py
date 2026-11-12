"""Angle pressure relief valve with spring bonnet and lifting lever, seated.

Layout: bottom inlet flange -> angle body -> side outlet toward +X;
tall spring bonnet, coloured cap and small hinged lifting lever above.
Origin = bottom inlet mating face (Y=0). Overall about 0.67 X x 1.00 Y x
0.54 Z; suggested mounting envelope 0.8 x 0.6 (1 x 1 grid cell if snapped).
Ports: process (0, 0, 0), facing -Y; out (0.40, 0.30, 0), facing +X.
anim.handle = (0.12, 0.955, 0), tilts about +Z by 0 to 20 degrees; lever
and hollow hinge eye are children. Full lifted envelope stays below 1.06.
hd.accent is the bonnet cap only; lifted may also drive its state colour.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_a as a
from _common import hd

# The sampled motion check found the hinge eye intersected the cap at Y=0.94.
# Raising the complete hinge 0.015 clears it throughout the 20-degree tilt;
# the lever's highest corner still stays below the original 1.06 envelope.
HANDLE_PIVOT = (0.12, 0.955, 0)


def build():
    m = c.materials()
    c.nozzle("process", (0, 0.18, 0), (0, 0, 0), m["white"])
    c.lathe("angle.body", [(0.13, 0.18), (0.21, 0.225), (0.33, 0.225),
                           (0.41, 0.145)], m["white"])
    c.nozzle("out", (0.12, 0.30, 0), (0.40, 0.30, 0), m["white"])
    c.y_cylinder("bonnet.hex", 0.40, 0.49, 0.15, m["white"], segments=6)
    c.lathe("spring.bonnet", [(0.47, 0.135), (0.53, 0.135), (0.78, 0.11),
                              (0.83, 0.11)], m["white"])
    c.edges(c.y_cylinder("bonnet.collar", 0.49, 0.525, 0.15, m["white"]), 40)
    c.edges(c.lathe("bonnet.cap", [(0.82, 0.14), (0.875, 0.14), (0.91, 0.10)],
                    m["accent"]), 45)
    hinge_x, hinge_y, _ = HANDLE_PIVOT
    for i, z in enumerate((-0.052, 0.052)):
        c.box(f"hinge.cheek.{i}", (0.05, 0.075, 0.024), m["white"],
              (hinge_x, hinge_y - 0.0325, z))
    c.edges(c.z_cylinder("hinge.pin", -0.069, 0.069, 0.025, m["shaded"],
                        x=hinge_x, y=hinge_y), enabled=False)
    handle = hd.add_anim("handle", HANDLE_PIVOT)
    a.ring("lever.eye", -0.025, 0.025, 0.045, 0.029, m["white"], axis="Z", parent=handle)
    outline = [(0.032, -0.018), (0.22, -0.018), (0.235, -0.008),
               (0.235, 0.018), (0.22, 0.028), (0.032, 0.018)]
    c.edges(a.prism("lifting.lever", outline, -0.022, 0.022, m["white"],
                    axis="Z", parent=handle), 40)
    c.check(kind="mounted", footprint=(0.8, 0.6), height=1.06,
            ports={"process": (0, 0, 0), "out": (0.40, 0.30, 0)}, anim={"handle": HANDLE_PIVOT})


if __name__ == "__main__":
    hd.run_part(build, "valve-relief")
