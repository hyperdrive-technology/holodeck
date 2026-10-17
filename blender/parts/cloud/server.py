"""Three-bay server tower: 1.50 × 2.00 × 1.50; logo 0.98 at Y=2.00."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("plinth", (1.50, 0.14, 1.50), accent, (0, 0.07, 0), radius=0.040)
    c.box("cabinet", (1.38, 1.76, 1.32), white, (0, 1.02, 0), radius=0.055)
    # Three deep rack bays remain legible at diagram scale. Broad slots and
    # one status block per bay carry the detail without tiny screw geometry.
    for i, y in enumerate((0.46, 1.00, 1.54)):
        c.box(f"bay.{i}", (1.18, 0.42, 0.095), white,
              (0, y, 0.674), radius=0.025)
        c.box(f"slot.{i}", (0.70, 0.075, 0.025), accent,
              (-0.105, y + 0.04, 0.728), radius=0.010)
        c.box(f"status.{i}", (0.105, 0.105, 0.025), accent,
              (0.435, y + 0.04, 0.728), radius=0.016)
    c.box("roof", (1.46, 0.10, 1.40), white, (0, 1.95, 0), radius=0.028)
    c.logo(2.00, 0.98)


if __name__ == "__main__":
    c.hd.run_part(build, "server")
