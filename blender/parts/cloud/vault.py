"""Safe with a locking wheel: 1.60 × 1.56 × 1.52; logo 0.98 at Y=1.56."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("plinth", (1.60, 0.12, 1.50), accent, (0, 0.06, 0), radius=0.035)
    c.box("body", (1.50, 1.40, 1.36), white, (0, 0.80, 0), radius=0.060)
    c.box("roof", (1.56, 0.10, 1.42), white, (0, 1.51, 0), radius=0.030)
    # A proud door inside an accent seal, hinged on the left, with the
    # spoked wheel that makes a safe readable at any size.
    c.box("door-seal", (1.30, 1.22, 0.03), accent, (0.06, 0.78, 0.685), radius=0.008)
    c.box("door", (1.16, 1.10, 0.10), white, (0.06, 0.78, 0.71), radius=0.030)
    for i, y in enumerate((0.46, 0.78, 1.10)):
        c.box(f"hinge.{i}", (0.10, 0.18, 0.12), accent, (-0.62, y, 0.74), radius=0.012)
    c.ring("wheel", 0.24, 0.045, 6, 16, accent, (0.20, 0.78, 0.80))
    c.place(c.plate("wheel-hub", c.polygon(8, 0.08, math.pi / 8), 0.06, accent, 0),
            (0.20, 0.78, 0.80))
    for i in range(2):
        c.box(f"spoke.{i}", (0.46, 0.06, 0.05), accent, (0.20, 0.78, 0.79),
              radius=0.008, rotation=(0, 0, i * math.pi / 2))
    c.place(c.plate("dial", c.polygon(8, 0.07, math.pi / 8), 0.04, accent, 0),
            (-0.26, 0.78, 0.78))
    c.logo(1.56, 0.98)


if __name__ == "__main__":
    c.hd.run_part(build, "vault")
