"""Horizontal shell-and-tube exchanger on two cradling saddles.

Layout: -X channel head / tubesheet flange -- shell -- dished head +X.
Origin = floor at footprint centre; shell axis Y=0.62. Overall about
2.86 X x 1.20 Y x 1.0 Z, within a 3 x 1 footprint; saddle feet touch Y=0.
Ports (flange faces): tube-in (-1.10, 0.32, +0.50), tube-out
(-1.10, 0.84, -0.50), shell-in (-0.40, 1.20, 0), shell-out (0.72, 1.20, 0).
Only tube-in meets a floor-level pipe; other nozzles use elevated routing.
No animation nodes or state colour; temperatures are external readouts.
"""

import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd

AXIS_Y = 0.62
SHELL_R = 0.37
PORTS = {
    "tube-in": (-1.10, c.PIPE_Y, 0.50),
    "tube-out": (-1.10, 0.84, -0.50),
    "shell-in": (-0.40, 1.20, 0),
    "shell-out": (0.72, 1.20, 0),
}


def build():
    m = c.materials()
    for i, x in enumerate((-0.44, 0.75)):
        c.saddle(f"saddle.{i}", x, AXIS_Y, SHELL_R, m["white"])
    c.x_cylinder("shell", -0.83, 1.08, SHELL_R, m["white"], y=AXIS_Y)
    c.x_cylinder("tubesheet.flange", -0.88, -0.78, 0.41, m["white"], y=AXIS_Y)
    c.lathe("channel.head", [(-1.43, 0.27), (-1.38, SHELL_R),
                             (-0.87, SHELL_R)], m["white"], axis="X", position=(0, AXIS_Y, 0))
    c.x_cylinder("channel.cover", -1.405, -1.355, 0.385, m["white"], y=AXIS_Y)
    c.lathe("dished.head", [(1.075, SHELL_R), (1.20, 0.34),
                            (1.34, 0.24), (1.43, 0)], m["white"], axis="X", position=(0, AXIS_Y, 0))

    # Opposed channel connections leave room for two 0.4-diameter tubes in
    # the one-cell width. The low inlet aligns with the plant's floor run.
    c.nozzle("tube-in", (-1.10, c.PIPE_Y, 0.10), PORTS["tube-in"], m["white"])
    c.nozzle("tube-out", (-1.10, 0.84, -0.10), PORTS["tube-out"], m["white"])
    for name in ("shell-in", "shell-out"):
        x, top, z = PORTS[name]
        c.nozzle(name, (x, 0.91, z), (x, top, z), m["white"])
    c.check(kind="floor", footprint=(3, 1), height=1.22, ports=PORTS)


if __name__ == "__main__":
    hd.run_part(build, "heat-exchanger-shell-tube")
