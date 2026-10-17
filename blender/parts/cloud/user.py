"""Faceted head and shoulders: 1.64 × 1.82 × 1.12; logo 0.36 at Y=1.82."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.disc("base", 0.82, 0, 0.13, accent, edge=0.025,
           scale_z=0.68)
    # A wide oval bust reads as shoulders from any isometric quadrant.
    c.lathe("shoulders", [(0.10, 0.72), (0.18, 0.78),
                          (0.46, 0.74), (0.70, 0.56),
                          (0.87, 0.31), (0.93, 0.23)], white,
            segments=16, scale_z=0.68)
    c.disc("collar", 0.235, 0.88, 1.09, accent,
           edge=0.025, segments=16)
    c.lathe("head", [(1.02, 0.20), (1.10, 0.33),
                     (1.25, 0.44), (1.49, 0.46),
                     (1.68, 0.40), (1.82, 0.30)], white, segments=16)
    # The small flat crown accommodates a logo without a floating billboard.
    c.logo(1.82, 0.36)


if __name__ == "__main__":
    c.hd.run_part(build, "user")
