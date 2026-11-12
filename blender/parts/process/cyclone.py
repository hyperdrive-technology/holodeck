"""Cyclone separator with a long cone on a four-leg open frame.

Layout: floor frame -> downward cone -> cylindrical separating chamber;
tangential rectangular inlet at -X / +Z, central clean-gas outlet on top.
Origin = floor at footprint centre. Overall about 0.94 X x 2.40 Y x 0.82 Z,
within a 1 x 1 footprint. Solids flange is 0.24 above the floor.
Ports: in (-0.5, 1.84, 0.235), facing -X; out (0, 2.40, 0), +Y;
solids (0, 0.24, 0), -Y. Inlet is rectangular; both outlets use pipe flanges.
Animation nodes: none. No state colour; pressure / flow are external readouts.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd

PORTS = {"in": (-0.5, 1.84, 0.235), "out": (0, 2.40, 0), "solids": (0, 0.24, 0)}


def build():
    m = c.materials()
    for i, (x, z) in enumerate(((-0.38, -0.35), (-0.38, 0.35),
                                (0.38, -0.35), (0.38, 0.35))):
        c.plinth(f"frame.foot.{i}", 0.12, 0.12, 0.045, m["white"], x=x, z=z)
        c.box(f"frame.leg.{i}", (0.065, 1.43, 0.065), m["white"], (x, 0.715, z))
    for i, z in enumerate((-0.35, 0.35)):
        c.box(f"frame.bearer.{i}", (0.825, 0.10, 0.10), m["white"], (0, 1.39, z))
    for i, x in enumerate((-0.38, 0.38)):
        c.box(f"frame.tie.{i}", (0.065, 0.075, 0.70), m["white"], (x, 0.20, 0))
    c.lathe("separator", [(0.43, 0.17), (1.43, 0.36), (2.075, 0.36)], m["white"])
    c.edges(c.y_cylinder("support.collar", 1.36, 1.44, 0.385, m["white"]), 40)
    c.lathe("roof", [(2.07, 0.36), (2.15, 0.24)], m["white"])
    c.nozzle("out", (0, 2.09, 0), PORTS["out"], m["white"])
    c.nozzle("solids", (0, 0.49, 0), PORTS["solids"], m["white"])
    # The outer duct wall lies at Z=0.36, tangent to the chamber. The face
    # stays perpendicular to X so routing does not inherit a diagonal port.
    # Reverse preview exposed coplanar triangles at X=-0.5. Like c.nozzle,
    # end the duct inside the flange so only one mesh owns the mating face.
    c.box("in.duct", (0.525, 0.29, 0.25), m["white"], (-0.2125, 1.84, 0.235))
    c.box("in.flange", (0.05, 0.38, 0.34), m["white"], (-0.475, 1.84, 0.235))
    hd.add_port("in", PORTS["in"])
    c.check(kind="floor", footprint=(1, 1), height=2.4, ports=PORTS, anim={})


if __name__ == "__main__":
    hd.run_part(build, "cyclone")
