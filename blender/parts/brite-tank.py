"""
Vertical dish-ended bright beer tank (BBT) on 4 legs -> assets/models/brite-tank.glb

Three.js space, Y up, origin = floor centre under the axis. ~1.75 tall, R 0.42.
Legs 0..0.45, bottom dish 0.35..0.50 (pole at y=0.35), cylinder 0.50..1.50,
top dish 1.50..1.65, top nozzle to 1.80.

Empties
  port.in      (0, 1.80, 0)   top nozzle
  port.out     (0.55, 0.60, 0)  low side outlet on +X
  anim.liquid  (0, 0.35, 0)   liquid origin = bottom dish pole
Liquid: child mesh `liquid` spans local y 0..1.15 when full (bottom pole to the
cylinder top, hd.accent). Runtime: anim.liquid.scale.y = fill 0..1.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

R = 0.42
Y_BOT, Y_CYL0, Y_CYL1, TOP_H, BOT_H = 0.35, 0.50, 1.50, 0.15, 0.15


def build() -> None:
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.accent", "#f2c14e")

    shell = b.dome_top(R, Y_CYL1, TOP_H) + b.dish_bottom(R, Y_CYL0, BOT_H)
    b.lathe("shell", shell, b.SEG, white)

    end = b.pipe_stub("inlet", (0, Y_CYL1 + TOP_H - 0.02, 0), "+y", 0.17, white)
    hd.add_port("in", end)
    out = b.pipe_stub("outlet", (R - 0.02, 0.60, 0), "+x", 0.15, white)
    hd.add_port("out", out)

    # Side manway (round door) facing +Z, and a pressure relief stub on top.
    hd.cylinder("manway", 0.11, 0.11, 0.05, 10, white, position_t=(0, 0.85, R + 0.0), rotation_t=(math.pi / 2, 0, 0))
    hd.cylinder("manway.hub", 0.03, 0.03, 0.04, 6, white, position_t=(0, 0.85, R + 0.04), rotation_t=(math.pi / 2, 0, 0))
    b.pipe_stub("relief", (-0.18, Y_CYL1 + TOP_H - 0.04, 0.05), "+y", 0.09, white, radius=0.03, flange=False)

    b.legs(4, 0.34, Y_CYL0 - 0.05, white, leg_r=0.035)

    inner = [(0.0, Y_CYL1)] + [(R - 0.005, Y_CYL1)] + [(r - 0.005 if r > 0 else 0.0, y) for r, y in b.dish_bottom(R, Y_CYL0, BOT_H)]
    b.liquid_window(inner, Y_BOT, liquid_mat)


if __name__ == "__main__":
    hd.run_part(build, "brite-tank")
