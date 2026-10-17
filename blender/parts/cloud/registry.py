"""Open shelving of package crates: 1.70 × 1.60 × 1.20; logo 0.92 at Y=1.60."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("plinth", (1.70, 0.12, 1.20), accent, (0, 0.06, 0), radius=0.035)
    c.box("back", (1.52, 1.40, 0.08), accent, (0, 0.80, -0.52), radius=0.015)
    for side in (-1, 1):
        c.box(f"side.{side}", (0.10, 1.45, 1.12), white,
              (side * 0.75, 0.825, 0), radius=0.025)
    for i, y in enumerate((0.16, 0.86)):
        c.box(f"shelf.{i}", (1.56, 0.08, 1.12), white, (0, y, 0), radius=0.018)
    c.box("top", (1.70, 0.10, 1.20), white, (0, 1.55, 0), radius=0.028)
    # Banded crates on open shelves: the open front is what separates a
    # registry from the closed server cabinet and the sealed container.
    crates = (((-0.46, 0.20, 0.12), 0.44), ((0, 0.20, 0.12), 0.44),
              ((0.46, 0.20, 0.12), 0.44), ((-0.34, 0.90, 0.12), 0.44),
              ((0.30, 0.90, 0.16), 0.36))
    for i, ((x, y, z), size) in enumerate(crates):
        c.box(f"crate.{i}", (size, size, size), white,
              (x, y + size / 2, z), radius=0.028)
        c.box(f"crate-band.{i}", (size + 0.03, 0.08, size + 0.03), accent,
              (x, y + size / 2, z), radius=0.010)
    c.logo(1.60, 0.92)


if __name__ == "__main__":
    c.hd.run_part(build, "registry")
