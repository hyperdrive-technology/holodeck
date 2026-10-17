"""Corrugated container: 1.90 × 1.15 × 1.34; logo 0.96 at Y=1.15."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("underframe", (1.90, 0.13, 1.34), accent,
          (0, 0.065, 0), radius=0.035)
    c.box("shell", (1.72, 0.98, 1.20), white,
          (0, 0.59, 0), radius=0.035)
    # Five broad ribs on each long side suggest corrugation at small scale;
    # the roof stays uninterrupted so arbitrary service logos fit cleanly.
    for side in (-1, 1):
        for i, x in enumerate((-0.64, -0.32, 0, 0.32, 0.64)):
            c.box(f"rib.{side}.{i}", (0.09, 0.84, 0.075), white,
                  (x, 0.59, side * 0.6175), radius=0.014)
    c.box("door-frame", (0.035, 0.90, 1.14), accent,
          (0.8725, 0.59, 0), radius=0.015)
    for side in (-1, 1):
        c.box(f"door.{side}", (0.05, 0.83, 0.52), white,
              (0.90, 0.59, side * 0.285), radius=0.018)
        c.box(f"locking-bar.{side}", (0.025, 0.61, 0.045), accent,
              (0.9325, 0.59, side * 0.19), radius=0.008)
    c.box("roof", (1.90, 0.10, 1.34), white,
          (0, 1.10, 0), radius=0.028)
    c.logo(1.15, 0.96)


if __name__ == "__main__":
    c.hd.run_part(build, "container")
