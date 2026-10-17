"""Open portal: 1.60 × 1.70 × 1.25; logo 0.60 at Y=1.70."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("threshold", (1.60, 0.14, 1.25), white, (0, 0.07, 0), radius=0.040)
    for side in (-1, 1):
        c.box(f"pillar.{side}", (0.32, 1.32, 0.88), white,
              (side * 0.57, 0.80, 0), radius=0.045)
        c.box(f"inner-jamb.{side}", (0.07, 1.13, 0.79), accent,
              (side * 0.405, 0.735, 0), radius=0.018)
    c.box("lintel", (1.46, 0.30, 0.96), white, (0, 1.55, 0), radius=0.055)
    # A simple arrow lies on the threshold and passes through the opening.
    arrow = c.plate("through-arrow", [(-0.12, -0.49), (0.12, -0.49),
                    (0.12, 0.12), (0.28, 0.12), (0, 0.49),
                    (-0.28, 0.12), (-0.12, 0.12)], 0.045, accent, 0)
    arrow.matrix_basis = c.hd.three_matrix((0, 0.168, 0), (1.5707963267948966, 0, 0))
    c.logo(1.70, 0.60)


if __name__ == "__main__":
    c.hd.run_part(build, "gateway")
