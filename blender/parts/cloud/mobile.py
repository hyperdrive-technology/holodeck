"""Upright handset on a dock: 1.04 × 1.64 × 0.74; logo 0.34 at Y=1.64."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("dock", (1.04, 0.14, 0.74), accent, (0, 0.07, 0), radius=0.035)
    for side in (-1, 1):
        c.box(f"cradle.{side}", (0.10, 0.16, 0.56), white,
              (side * 0.47, 0.22, 0), radius=0.020)
    # A chunky handset keeps a usable logo strip along its top edge.
    c.box("handset", (0.84, 1.52, 0.46), white, (0, 0.88, 0), radius=0.055)
    front = 0.23
    c.box("screen", (0.70, 1.08, 0.03), accent, (0, 0.90, front + 0.015), radius=0.008)
    c.box("speaker", (0.26, 0.04, 0.02), accent, (0, 1.52, front + 0.01), radius=0.006)
    c.place(c.plate("home", c.polygon(10, 0.07, math.pi / 10), 0.02, accent, 0),
            (0, 0.25, front + 0.01))
    c.box("side-key", (0.03, 0.18, 0.06), accent, (0.43, 1.10, 0), radius=0.006)
    c.logo(1.64, 0.34)


if __name__ == "__main__":
    c.hd.run_part(build, "mobile")
