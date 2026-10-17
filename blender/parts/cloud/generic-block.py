"""Wide rounded block: 1.80 × 0.90 × 1.40; logo 1.00 at Y=0.90."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("base", (1.80, 0.12, 1.40), accent,
          (0, 0.06, 0), radius=0.035)
    c.box("body", (1.80, 0.80, 1.40), white,
          (0, 0.50, 0), radius=0.060)
    c.logo(0.90, 1.00)


if __name__ == "__main__":
    c.hd.run_part(build, "generic-block")
