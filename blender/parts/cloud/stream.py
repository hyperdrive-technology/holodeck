"""Chevron channels around an island: 1.84 × 0.50 × 1.64; logo 0.66 at Y=0.50."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c

CHEVRON = [(-0.17, -0.13), (-0.05, -0.13), (0.17, 0),
           (-0.05, 0.13), (-0.17, 0.13), (0.05, 0)]


def build():
    white, accent = c.materials()
    c.box("base", (1.84, 0.10, 1.64), accent, (0, 0.05, 0), radius=0.030)
    c.box("bed", (1.84, 0.20, 1.64), white, (0, 0.18, 0), radius=0.045)
    # Two banked channels of flow chevrons pass either side of a raised
    # island, which carries the logo above everything else.
    for side in (-1, 1):
        c.box(f"bank.{side}", (1.84, 0.14, 0.14), white,
              (0, 0.34, side * 0.75), radius=0.030)
        for i, x in enumerate((-0.52, 0, 0.52)):
            chevron = c.plate(f"chevron.{side}.{i}", CHEVRON, 0.03, accent, 0)
            c.place(chevron, (x, 0.295, side * 0.54), (math.pi / 2, 0, 0))
    c.box("island", (0.78, 0.24, 0.78), white, (0, 0.38, 0), radius=0.045)
    c.logo(0.50, 0.66)


if __name__ == "__main__":
    c.hd.run_part(build, "stream")
