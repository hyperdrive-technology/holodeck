"""Stacked messages: 1.60 × 1.55 × 1.50; logo 0.56 at Y=1.55."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("tray", (1.60, 0.14, 1.50), accent, (0, 0.07, 0), radius=0.040)
    # The staggered lower messages expose their edges; the top is centered
    # on the floor anchor, so logos line up with other archetypes.
    for i, (x, y, z) in enumerate(((-0.08, 0.355, -0.14),
                                  (0.08, 0.855, 0.14), (0, 1.345, 0))):
        c.box(f"message.{i}", (1.36, 0.41, 1.00), white,
              (x, y, z), radius=0.045)
        c.plate(f"envelope-fold.{i}",
                [(x - 0.49, y + 0.10), (x, y - 0.055), (x + 0.49, y + 0.10),
                 (x + 0.49, y + 0.035), (x, y - 0.12), (x - 0.49, y + 0.035)],
                0.018, accent, z + 0.505)
        if i < 2:
            c.box(f"separator.{i}", (1.16, 0.11, 0.78), accent,
                  (0, y + 0.25, 0), radius=0.020)
    c.logo(1.55, 0.56)


if __name__ == "__main__":
    c.hd.run_part(build, "queue")
