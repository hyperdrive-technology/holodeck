"""
Cylindro-conical fermenter (CCV) on 4 legs -> assets/models/fermenter.glb

Three.js space, Y up, origin = floor centre under the vessel axis. ~2.08 tall.
From the floor up: legs 0..1.0, outlet nozzle 0.30..0.50, cone 0.50..1.04
(tip r 0.07), cylinder 1.04..1.75 (R 0.38), domed top 1.75..1.93, CIP/manway
arm; port.in flange face at 2.08. Glycol jacket band on the cylinder, sample valve on the cone.

Empties
  port.in      (0, 2.08, 0)      top CIP / inlet flange
  port.out     (0, 0.30, 0)      bottom of cone, flange facing down
  port.glycol  (0.515, 1.35, 0)   +X side, glycol jacket nozzle
  anim.liquid  (0, 0.50, 0)      liquid origin = cone tip (see below)
Liquid convention (details in brewery.py): anim.liquid origin is the BOTTOM of
the liquid; child mesh `liquid` spans local y 0..1.25 when full (cone tip to
cylinder top). Runtime: anim.liquid.scale.y = fill 0..1. Material hd.accent.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

R = 0.38
CONE_TIP_R = 0.07
Y_TIP, Y_JUNC, Y_TOP, DOME_H = 0.50, 1.04, 1.75, 0.18
GLYCOL_Y = 1.35
JACKET_R = R + 0.025


def build() -> None:
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.accent", "#e0a526")

    shell = b.dome_top(R, Y_TOP, DOME_H) + [(R, Y_JUNC), (CONE_TIP_R, Y_TIP)]
    shell = [shell[0]] + [p for i, p in enumerate(shell[1:], 1) if p != shell[i - 1]]
    b.lathe("shell", shell, b.SEG, white)

    # Glycol jacket: slightly fatter band, only the cylinder part.
    hd.cylinder("jacket", JACKET_R, JACKET_R, 0.55, b.SEG, white, position_t=(0, GLYCOL_Y, 0))
    gx = b.pipe_stub("glycol", (JACKET_R - 0.01, GLYCOL_Y, 0), "+x", 0.12, white, radius=0.045)
    hd.add_port("glycol", gx)

    # Top: manway/CIP arm off-centre, CIP inlet on the axis.
    hd.cylinder("manway", 0.09, 0.09, 0.08, 10, white, position_t=(-0.17, Y_TOP + DOME_H - 0.02, 0.05),
                rotation_t=(0.0, 0.0, 0.35))
    hd.cylinder("cip.arm", 0.045, 0.045, 0.14, 8, white, position_t=(0, Y_TOP + DOME_H + 0.05, 0))
    b.pipe_stub("cip.nozzle", (0, Y_TOP + DOME_H + 0.1, 0), "+y", 0.05, white, radius=0.045)
    hd.add_port("in", (0, Y_TOP + DOME_H + 0.15, 0))

    # Bottom outlet pointing down, flange at the port.
    end = b.pipe_stub("outlet", (0, Y_TIP, 0), "-y", 0.20, white)
    hd.add_port("out", end)

    # Side sample valve on the cone, +Z (faces the iso camera).
    r_at = lambda y: CONE_TIP_R + (R - CONE_TIP_R) * (y - Y_TIP) / (Y_JUNC - Y_TIP)  # noqa: E731
    b.pipe_stub("sample", (0, 0.80, r_at(0.80) - 0.02), "+z", 0.12, white, radius=0.025, flange=False)
    hd.cylinder("sample.handle", 0.035, 0.035, 0.03, 6, white, position_t=(0, 0.80, r_at(0.80) + 0.08),
                rotation_t=(math.pi / 2, 0, 0))

    b.legs(4, 0.30, Y_JUNC - 0.02, white, leg_r=0.035)
    # Bracing ring between the legs at mid height.
    hd.cylinder("brace", 0.31, 0.31, 0.025, 4, white, position_t=(0, 0.55, 0), rotation_t=(0, math.pi / 4, 0))

    inner = [(0.0, Y_TOP), (R - 0.005, Y_TOP), (R - 0.005, Y_JUNC), (CONE_TIP_R, Y_TIP), (0.0, Y_TIP)]
    b.liquid_window(inner, Y_TIP, liquid_mat)


if __name__ == "__main__":
    hd.run_part(build, "fermenter")
