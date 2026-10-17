"""Console with a bold trace: 1.86 × 1.36 × 1.46; logo 0.66 at Y=1.36."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c

TRACE = [(-0.56, -0.08), (-0.36, 0.12), (-0.18, -0.14), (0.02, 0.16),
         (0.22, -0.04), (0.40, 0.10), (0.56, 0.02)]


def build():
    white, accent = c.materials()
    c.box("plinth", (1.86, 0.12, 1.46), accent, (0, 0.06, 0), radius=0.035)
    c.box("desk", (1.80, 0.50, 1.40), white, (0, 0.33, 0), radius=0.045)
    # A thick, centred screen block steps up from the desk; its flat top is
    # the logo face and its front carries the signal trace.
    c.box("screen-block", (1.56, 0.80, 0.80), white, (0, 0.96, 0), radius=0.050)
    front = 0.40
    c.box("bezel", (1.36, 0.60, 0.03), accent, (0, 0.96, front + 0.015), radius=0.008)
    c.box("screen", (1.26, 0.50, 0.02), white, (0, 0.96, front + 0.04), radius=0.006)
    c.place(c.plate("trace", c.stroke(TRACE, 0.06), 0.02, accent, 0),
            (0, 0.96, front + 0.06))
    for i, x in enumerate((-0.44, -0.22, 0, 0.22, 0.44)):
        c.box(f"key.{i}", (0.14, 0.05, 0.12), accent, (x, 0.605, 0.56), radius=0.012)
    c.logo(1.36, 0.66)


if __name__ == "__main__":
    c.hd.run_part(build, "monitoring")
