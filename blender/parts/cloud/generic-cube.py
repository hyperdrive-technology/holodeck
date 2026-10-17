"""Neutral cube: 1.50 × 1.50 × 1.50; floor origin; logo 1.08 at Y=1.50."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("base", (1.50, 0.12, 1.50), accent, (0, 0.06, 0), radius=0.035)
    c.box("body", (1.50, 1.40, 1.50), white, (0, 0.80, 0), radius=0.060)
    c.logo(1.50, 1.08)


if __name__ == "__main__":
    c.hd.run_part(build, "generic-cube")
