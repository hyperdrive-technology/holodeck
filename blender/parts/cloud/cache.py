"""Memory chip with twelve pins: 1.68 × 0.85 × 1.68; logo 0.82 at Y=0.85."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("substrate", (1.42, 0.15, 1.42), accent, (0, 0.075, 0), radius=0.035)
    for i, offset in enumerate((-0.42, 0, 0.42)):
        for sign in (-1, 1):
            c.box(f"pin.x.{sign}.{i}", (0.28, 0.13, 0.18), white,
                  (sign * 0.70, 0.065, offset), radius=0.018)
            c.box(f"pin.z.{sign}.{i}", (0.18, 0.13, 0.28), white,
                  (offset, 0.065, sign * 0.70), radius=0.018)
    c.box("package", (1.18, 0.70, 1.18), white, (0, 0.50, 0), radius=0.065)
    c.logo(0.85, 0.82)


if __name__ == "__main__":
    c.hd.run_part(build, "cache")
