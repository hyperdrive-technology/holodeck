"""Hexagonal function module: 1.82 × 1.15 × 1.58; logo 0.95 at Y=1.15."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    # A six-sided footprint separates functions from square compute parts.
    # The orientation puts a broad face beneath the front code pictogram.
    c.disc("hex-base", 0.91, 0, 0.14, accent, edge=0.025,
           segments=6, angle=math.pi / 6)
    c.disc("module", 0.87, 0.10, 1.15, white, edge=0.045,
           segments=6, angle=math.pi / 6)
    front = 0.87 * math.cos(math.pi / 6) + 0.008
    for sign in (-1, 1):
        c.plate(f"code-bracket.{sign}",
                [(sign * 0.12, 0.83), (sign * 0.31, 0.63),
                 (sign * 0.12, 0.43), (sign * 0.055, 0.49),
                 (sign * 0.19, 0.63), (sign * 0.055, 0.77)],
                0.025, accent, front)
    c.logo(1.15, 0.95)


if __name__ == "__main__":
    c.hd.run_part(build, "function")
