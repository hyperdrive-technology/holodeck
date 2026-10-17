"""Thin rounded tile: 1.75 × 0.24 × 1.75; logo 1.28 at Y=0.24."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("base", (1.75, 0.09, 1.75), accent,
          (0, 0.045, 0), radius=0.025)
    c.box("tile", (1.75, 0.17, 1.75), white,
          (0, 0.155, 0), radius=0.045)
    c.logo(0.24, 1.28)


if __name__ == "__main__":
    c.hd.run_part(build, "generic-flat")
