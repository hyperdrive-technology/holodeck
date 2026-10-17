"""One hub and three outputs: 1.80 × 0.95 × 1.60; logo 0.72 at Y=0.95."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("board", (1.80, 0.20, 1.60), white, (0, 0.10, 0), radius=0.050)
    c.box("input", (0.30, 0.10, 0.31), accent, (0, 0.23, -0.625), radius=0.025)
    c.box("branch", (1.42, 0.075, 0.10), accent, (0, 0.2375, 0.475), radius=0.015)
    for i, x in enumerate((-0.59, 0, 0.59)):
        c.box(f"trace.{i}", (0.10, 0.075, 0.25), accent,
              (x, 0.2375, 0.57), radius=0.015)
        c.box(f"output.{i}", (0.34, 0.22, 0.28), white,
              (x, 0.31, 0.63), radius=0.026)
        c.box(f"output-cap.{i}", (0.28, 0.055, 0.22), accent,
              (x, 0.4475, 0.63), radius=0.016)
    c.box("hub-base", (1.06, 0.13, 1.00), accent, (0, 0.265, 0), radius=0.030)
    c.box("hub", (0.98, 0.63, 0.90), white, (0, 0.635, 0), radius=0.050)
    c.logo(0.95, 0.72)


if __name__ == "__main__":
    c.hd.run_part(build, "load-balancer")
