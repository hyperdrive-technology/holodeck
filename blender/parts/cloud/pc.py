"""Monitor on a stand with a keyboard: 1.70 × 1.56 × 1.14; logo 0.40 at Y=1.56."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c


def build():
    white, accent = c.materials()
    c.box("foot", (0.90, 0.10, 0.60), accent, (0, 0.05, 0), radius=0.030)
    c.box("neck", (0.28, 0.44, 0.18), white, (0, 0.30, 0), radius=0.020)
    # The monitor is deep enough for a logo along its top edge; it stays
    # centred on the anchor so the keyboard sits in front.
    c.box("monitor", (1.60, 1.08, 0.52), white, (0, 1.02, 0), radius=0.055)
    front = 0.26
    c.box("bezel", (1.42, 0.90, 0.03), accent, (0, 1.04, front + 0.015), radius=0.008)
    c.box("window", (0.96, 0.56, 0.02), white, (-0.06, 1.00, front + 0.04), radius=0.006)
    c.box("title-bar", (0.96, 0.09, 0.02), accent, (-0.06, 1.235, front + 0.05), radius=0.006)
    c.box("keyboard", (1.24, 0.10, 0.44), white, (-0.14, 0.05, 0.62), radius=0.025)
    for i, z in enumerate((0.50, 0.62, 0.74)):
        c.box(f"key-row.{i}", (1.08, 0.02, 0.08), accent, (-0.14, 0.11, z), radius=0.005)
    c.box("mouse", (0.18, 0.08, 0.26), white, (0.76, 0.04, 0.62), radius=0.030)
    c.logo(1.56, 0.40)


if __name__ == "__main__":
    c.hd.run_part(build, "pc")
