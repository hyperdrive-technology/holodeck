"""Three storage platters: 1.60 × 1.75 × 1.60; logo 1.00 at Y=1.75."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.disc("base", 0.76, 0, 0.12, accent, edge=0.025)
    for i, bottom in enumerate((0.10, 0.65, 1.20)):
        c.disc(f"platter.{i}", 0.80, bottom, bottom + 0.55, white, edge=0.045)
        # Recessed collars separate three broad cylinders; the top remains a
        # single uninterrupted disc for brand overlays.
        if i < 2:
            c.disc(f"collar.{i}", 0.772, bottom + 0.485, bottom + 0.575,
                   accent, edge=0.010)
    c.logo(1.75, 1.00)


if __name__ == "__main__":
    c.hd.run_part(build, "database")
