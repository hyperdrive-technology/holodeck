"""Brick wall with a broad cap: 1.92 × 1.60 × 0.78; logo 0.64 at Y=1.60."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("plinth", (1.92, 0.12, 0.78), accent, (0, 0.06, 0), radius=0.035)
    # The accent core shows through as mortar between proud white bricks.
    c.box("core", (1.80, 1.36, 0.56), accent, (0, 0.78, 0), radius=0.020)
    for row, y in enumerate((0.30, 0.72, 1.14)):
        xs = (-0.66, -0.22, 0.22, 0.66) if row % 2 == 0 else (-0.44, 0, 0.44)
        for side in (-1, 1):
            for i, x in enumerate(xs):
                c.box(f"brick.{side}.{row}.{i}", (0.40, 0.34, 0.10), white,
                      (x, y, side * 0.30), radius=0.014)
            if row % 2:
                for end in (-1, 1):
                    c.box(f"half-brick.{side}.{row}.{end}", (0.18, 0.34, 0.10),
                          white, (end * 0.77, y, side * 0.30), radius=0.014)
        for end in (-1, 1):
            if row % 2 == 0:
                c.box(f"end-brick.{end}.{row}", (0.10, 0.34, 0.44), white,
                      (end * 0.90, y, 0), radius=0.014)
            else:
                for side in (-1, 1):
                    c.box(f"end-half.{end}.{row}.{side}", (0.10, 0.34, 0.19),
                          white, (end * 0.90, y, side * 0.155), radius=0.014)
    c.box("cap", (1.92, 0.14, 0.78), white, (0, 1.53, 0), radius=0.040)
    c.logo(1.60, 0.64)


if __name__ == "__main__":
    c.hd.run_part(build, "firewall")
