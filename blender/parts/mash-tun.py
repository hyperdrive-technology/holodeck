"""
Mash tun: short wide vessel, domed lid, side manway, top-driven agitator
-> assets/models/mash-tun.glb

Three.js space, Y up, origin = floor centre. R 0.55, 1.78 tall to the motor top.
Legs 0..0.30, flat-ish bottom at 0.30, wall 0.30..0.90, lid dome 0.90..1.12,
agitator drive on top to 1.78.

Empties
  port.in       (0.70, 0.78, 0)   +X upper side (mash-in / sparge)
  port.out      (-0.70, 0.40, 0)  -X low side (wort run-off)
  anim.agitator (0, 1.12, 0)      spins about Y. Children: shaft (visible above
                                  the lid and down into the vessel), 2 paddles
                                  low inside, and a crossbar above the lid so
                                  the spin reads from outside (the shell is opaque).
  anim.liquid   (0, 0.32, 0)      liquid origin = inside bottom
Liquid: child mesh `liquid` spans local y 0..0.55 when full (hd.accent).
Runtime: anim.liquid.scale.y = fill 0..1.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

R = 0.55
Y_BOT, Y_WALL1, LID_H = 0.30, 0.90, 0.22
Y_LIQ0, Y_LIQ1 = 0.32, 0.87
Y_LID = Y_WALL1 + LID_H


def build() -> None:
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.accent", "#c68a3a")

    # Shallow dish bottom for the flat-ish base, wall, domed lid (3 steps -> faceted).
    shell = b.dome_top(R, Y_WALL1, LID_H) + b.dish_bottom(R, Y_BOT, 0.02, steps=1)
    b.lathe("shell", shell, b.SEG, white)

    # Side manway (+Z, faces the iso camera): door plate + hinge lug.
    hd.cylinder("manway", 0.12, 0.12, 0.05, 10, white, position_t=(0, 0.60, R + 0.0), rotation_t=(math.pi / 2, 0, 0))
    b.box("manway.hinge", (0.05, 0.14, 0.05), white, position_t=(0.14, 0.60, R + 0.02))

    hd.add_port("in", b.pipe_stub("inlet", (R - 0.02, 0.78, 0), "+x", 0.17, white))
    hd.add_port("out", b.pipe_stub("outlet", (-R + 0.02, 0.40, 0), "-x", 0.17, white))

    # Agitator drive: gearbox + motor on a short stand above the lid.
    b.box("drive.gearbox", (0.22, 0.14, 0.22), white, position_t=(0, Y_LID + 0.37, 0))
    hd.cylinder("drive.motor", 0.09, 0.09, 0.22, 10, white, position_t=(0, Y_LID + 0.55, 0))
    # Two posts instead of a solid stand so the spinning crossbar stays visible between them.
    for sx in (-1, 1):
        hd.cylinder(f"drive.post.{sx}", 0.02, 0.02, 0.30, 6, white, position_t=(sx * 0.17, Y_LID + 0.15, 0))

    ag = hd.add_anim("agitator", (0, Y_LID + 0.12, 0))
    shaft_len = 0.12 + (Y_LID - 0.40)  # from near-bottom up to just above the lid
    hd.cylinder("shaft", 0.03, 0.03, shaft_len, 8, white, position_t=(0, -shaft_len / 2 + 0.02, 0), parent=ag)
    # Visible crossbar above the lid, spins with the shaft.
    hd.set_props(b.box("crossbar", (0.26, 0.03, 0.05), white, position_t=(0, 0.0, 0), parent=ag), hd_edges=True)
    # Paddles near the bottom (inside the opaque shell, kept for the cutaway/see-through case).
    py = -(Y_LID + 0.12 - 0.45)
    b.box("paddle.0", (0.80, 0.05, 0.10), white, position_t=(0, py, 0), parent=ag)
    b.box("paddle.1", (0.10, 0.05, 0.80), white, position_t=(0, py + 0.12, 0), parent=ag)

    b.legs(4, 0.42, Y_BOT, white, leg_r=0.04)

    inner = [(0.0, Y_LIQ1), (R - 0.005, Y_LIQ1), (R - 0.005, Y_LIQ0), (0.0, Y_LIQ0)]
    b.liquid_window(inner, Y_LIQ0, liquid_mat)


if __name__ == "__main__":
    hd.run_part(build, "mash-tun")
