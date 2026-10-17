"""Upright badge with a portrait: 1.36 × 1.60 × 0.90; logo 0.46 at Y=1.60."""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("stand", (1.20, 0.12, 0.90), accent, (0, 0.06, 0), radius=0.035)
    # Thick enough for a logo along its top edge, yet still a card on end.
    c.box("badge", (1.36, 1.50, 0.60), white, (0, 0.85, 0), radius=0.060)
    front = 0.30
    c.box("lanyard-strip", (1.36, 0.14, 0.03), accent, (0, 1.42, front + 0.015), radius=0.008)
    c.box("slot", (0.34, 0.06, 0.02), white, (0, 1.42, front + 0.04), radius=0.006)
    # Portrait on the left, text lines on the right: the badge pictogram.
    c.place(c.plate("head", c.polygon(10, 0.15, math.pi / 10), 0.03, accent, 0),
            (-0.36, 0.98, front + 0.015))
    c.place(c.plate("shoulders", [(-0.30, -0.14), (0.30, -0.14), (0.30, -0.02),
                                  (0.19, 0.12), (-0.19, 0.12), (-0.30, -0.02)],
                    0.03, accent, 0), (-0.36, 0.60, front + 0.015))
    for i, y in enumerate((1.02, 0.84, 0.66)):
        c.box(f"line.{i}", (0.44 if i == 2 else 0.56, 0.07, 0.03), accent,
              (0.30, y, front + 0.015), radius=0.008)
    c.logo(1.60, 0.46)


if __name__ == "__main__":
    c.hd.run_part(build, "identity")
