"""
Brew kettle / boil kettle with steam stack -> assets/models/kettle.glb

Three.js space, Y up, origin = floor centre. R 0.42; body+cap 2.32, steam cluster reaches 2.61.
Legs 0..0.40, dished bottom 0.30..0.40, wall 0.40..1.50, dome 1.50..1.75
(flat-topped at r 0.12), stack 1.75..2.20, rain-cap cone to 2.32.

Empties
  port.in      (0.57, 1.20, 0)    +X side
  port.out     (-0.57, 0.50, 0)   -X side, low (whirlpool/run-off)
  anim.steam   (0, 2.32, 0)       cluster of 4 white spheres (children) above
                                  the cap; runtime may scale (puff) and
                                  translate Y (rise) the pivot. Spheres are
                                  built within +-0.15 of the pivot.
  anim.liquid  (0, 0.30, 0)       origin = bottom dish pole
Liquid: child mesh `liquid` spans local y 0..1.20 when full (hd.accent).
Runtime: anim.liquid.scale.y = fill 0..1.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

R = 0.42
Y_BOT, Y_CYL0, Y_CYL1, BOT_H = 0.30, 0.40, 1.50, 0.10
DOME_H, TOP_R = 0.25, 0.12
STACK_R, Y_STACK1 = 0.09, 2.20


def build() -> None:
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.accent", "#d9b45a")

    # Dome truncated by a flat stack collar at r TOP_R: sample the ellipse and
    # stop at the first ring inside TOP_R, then close with a flat cap (n-gon).
    dome = [(r, y) for r, y in b.dome_top(R, Y_CYL1, DOME_H, steps=4) if r >= TOP_R - 1e-9]
    dome = [(r if r > 1e-9 else TOP_R, y) for r, y in dome]
    shell = dome + b.dish_bottom(R, Y_CYL0, BOT_H)
    b.lathe("shell", shell, b.SEG, white)

    top_y = dome[0][1]
    hd.cylinder("stack", STACK_R, STACK_R, Y_STACK1 - top_y, 8, white, position_t=(0, (top_y + Y_STACK1) / 2, 0))
    hd.cylinder("stack.cap", 0.01, 0.17, 0.12, 8, white, position_t=(0, Y_STACK1 + 0.06, 0))

    hd.add_port("in", b.pipe_stub("inlet", (R - 0.02, 1.20, 0), "+x", 0.17, white))
    hd.add_port("out", b.pipe_stub("outlet", (-R + 0.02, 0.50, 0), "-x", 0.17, white))

    # Sight glass boss (+Z) and a manway hatch on the dome.
    hd.cylinder("sight", 0.07, 0.07, 0.05, 8, white, position_t=(0, 0.95, R), rotation_t=(math.pi / 2, 0, 0))
    hd.cylinder("hatch", 0.09, 0.09, 0.04, 8, white, position_t=(0.0, Y_CYL1 + 0.12, 0.27), rotation_t=(0.9, 0, 0))

    steam = hd.add_anim("steam", (0, Y_STACK1 + 0.12, 0))
    for i, (x, y, z, r) in enumerate([(0.0, 0.0, 0.0, 0.07), (0.06, 0.09, 0.03, 0.06),
                                      (-0.05, 0.16, -0.04, 0.055), (0.03, 0.24, 0.05, 0.045)]):
        s = hd.uv_sphere(f"steam.{i}", r, 6, 4, white, position_t=(x, y, z), parent=steam)
        # Outlined, not edge-less: unlit white puffs vanish against the white scene when steam shows.
        hd.set_props(s, hd_edges=True)

    b.legs(4, 0.32, Y_CYL0, white, leg_r=0.04)

    inner = [(0.0, Y_CYL1), (R - 0.005, Y_CYL1)] + [(r - 0.005 if r > 0 else 0.0, y) for r, y in b.dish_bottom(R, Y_CYL0, BOT_H)]
    b.liquid_window(inner, Y_BOT, liquid_mat)


if __name__ == "__main__":
    hd.run_part(build, "kettle")
