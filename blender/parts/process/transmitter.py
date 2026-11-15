"""Compact dual-compartment field transmitter with a forward display.

Layout: process connection -> short stem -> round housing; display at +Z,
rear terminal compartment at -Z and a small cable gland at +X.
Origin = bottom of process connection (mount on a pipe or vessel nozzle).
Overall about 0.32 X x 0.58 Y x 0.30 Z; suggested mounting envelope 0.36 x
0.36. port.process is exactly (0, 0, 0). No animation nodes.
hd.accent is the display bezel; the readout face is intentionally unlettered.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd


def build():
    m = c.materials()
    # A small instrument process fitting, not a full 0.27-radius pipe flange.
    # Its bottom mating face is the placement anchor and process port.
    c.y_cylinder("process.hex", 0, 0.06, 0.065, m["white"], segments=6)
    c.y_cylinder("stem", 0.05, 0.24, 0.041, m["white"], segments=c.SMALL_SEG)
    c.y_cylinder("sensor.neck", 0.20, 0.32, 0.065, m["white"], segments=c.SMALL_SEG)
    hd.add_port("process", (0, 0, 0))
    c.z_cylinder("housing", -0.105, 0.105, 0.15, m["white"], y=0.43)
    # A slight diameter step distinguishes the terminal compartment from
    # the display housing; the first preview read as one uninterrupted can.
    c.lathe("rear.cover", [(-0.15, 0.11), (-0.135, 0.14), (-0.10, 0.14)],
            m["white"], axis="Z", position=(0, 0.43, 0))
    c.z_cylinder("display.bezel", 0.10, 0.145, 0.15, m["accent"], y=0.43)
    c.edges(c.z_cylinder("display.face", 0.142, 0.15, 0.115, m["shaded"], y=0.43), enabled=False)
    c.box("display.window", (0.14, 0.073, 0.006), m["white"], (0, 0.435, 0.153))
    c.x_cylinder("cable.gland", 0.12, 0.175, 0.04, m["white"],
                 y=0.43, z=-0.045, segments=c.SMALL_SEG)
    c.check(kind="mounted", footprint=(0.36, 0.36), height=0.60,
            ports={"process": (0, 0, 0)})


if __name__ == "__main__":
    hd.run_part(build, "transmitter")
