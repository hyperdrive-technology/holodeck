"""Upright sign on two posts: 1.90 × 1.98 × 0.56; logo 1.00 on the +Z face at Y=1.36.

Contract difference: this is the one archetype whose `logo` empty is not on
the top face. It sits on the sign's front (+Z) face, rotated so its local
+Y is the face normal; its local X/Z scale is still the square edge. E2's
`logoAnchorFromModel` currently ignores the empty's rotation and always
lays the plane flat, so until E2 honours the orientation the billboard
logo renders inside the panel (holodeck#138).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    for side in (-1, 1):
        c.box(f"foot.{side}", (0.40, 0.10, 0.56), accent,
              (side * 0.62, 0.05, 0), radius=0.025)
        c.box(f"post.{side}", (0.14, 0.90, 0.14), accent,
              (side * 0.62, 0.50, 0), radius=0.018)
    c.box("brace", (1.40, 0.06, 0.18), accent, (0, 0.70, 0), radius=0.012)
    c.box("sign", (1.86, 1.14, 0.16), white, (0, 1.36, 0), radius=0.040)
    c.box("trim", (1.90, 0.06, 0.20), accent, (0, 1.95, 0), radius=0.012)
    c.logo(1.36, 1.00, z=0.08, rotation=(math.pi / 2, 0, 0))


if __name__ == "__main__":
    c.hd.run_part(build, "billboard")
