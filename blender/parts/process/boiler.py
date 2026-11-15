"""Packaged horizontal fire-tube boiler on two cradling saddles.

Layout: -X burner / flat front door -- horizontal shell -- +X smoke stack;
steam nozzle on top and control box on the +Z side.
Origin = floor at footprint centre. Overall 2.81 X x 2.16 Y x 1.67 Z,
within a 3 x 2 footprint; shell axis Y=0.86 and saddle feet touch Y=0.
Ports: feed (0.38, 0.32, 1.0), facing +Z; steam (-0.30, 1.88, 0), +Y.
Animation nodes: none. hd.accent is the round burner housing only;
firing/fault tint it, while pressure is an external readout.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
from _batch_c import ring

AXIS_Y = 0.86
SHELL_R = 0.64
PORTS = {"feed": (0.38, c.PIPE_Y, 1.0), "steam": (-0.30, 1.88, 0)}


def build():
    m = c.materials("#c0392b")
    for i, x in enumerate((-0.48, 0.79)):
        c.saddle(f"saddle.{i}", x, AXIS_Y, SHELL_R, m["white"], width=0.24, depth=1.14)
    c.x_cylinder("shell", -0.88, 1.25, SHELL_R, m["white"], y=AXIS_Y)
    c.edges(c.x_cylinder("front.rim", -0.99, -0.86, 0.67, m["white"], y=AXIS_Y), 40)
    c.x_cylinder("front.door", -1.025, -0.975, 0.595, m["white"], y=AXIS_Y)
    c.edges(c.x_cylinder("rear.cover", 1.23, 1.32, 0.65, m["white"], y=AXIS_Y), 40)
    c.x_cylinder("burner.throat", -1.15, -1.01, 0.18, m["shaded"], y=AXIS_Y)
    # First build caught the intake 0.005 outside the 3-cell footprint.
    # Shorten the burner nose; the mating ports and placement stay fixed.
    c.lathe("burner.housing", [(-1.48, 0.215), (-1.44, 0.285),
                               (-1.16, 0.285), (-1.105, 0.19)],
            m["accent"], axis="X", position=(0, AXIS_Y, 0))
    c.edges(c.x_cylinder("burner.intake", -1.49, -1.47, 0.165,
                        m["shaded"], y=AXIS_Y), enabled=False)
    for i, z in enumerate((-0.48, 0.48)):
        c.box(f"door.hinge.{i}", (0.08, 0.22, 0.085), m["white"], (-1.02, AXIS_Y, z))

    # A real open bore, rather than a cap painted dark: this stays a stack
    # under the runtime's white unlit finish as well as Workbench shading.
    ring("stack", 1.39, 2.12, 0.235, 0.18, m["white"], position=(0.88, 0, 0))
    c.edges(ring("stack.lip", 2.105, 2.16, 0.25, 0.18,
                 m["white"], position=(0.88, 0, 0)), 40)
    c.nozzle("steam", (-0.30, 1.43, 0), PORTS["steam"], m["white"])
    c.nozzle("feed", (0.38, c.PIPE_Y, 0.12), PORTS["feed"], m["white"])
    c.box("control.box", (0.40, 0.40, 0.22), m["white"], (-0.10, 1.00, 0.66))
    c.box("control.door", (0.34, 0.34, 0.025), m["white"], (-0.10, 1.00, 0.78))
    c.edges(c.box("control.window", (0.22, 0.11, 0.012), m["shaded"],
                  (-0.10, 1.075, 0.80)), enabled=False)
    c.check(kind="floor", footprint=(3, 2), height=2.2, ports=PORTS, anim={})


if __name__ == "__main__":
    hd.run_part(build, "boiler")
