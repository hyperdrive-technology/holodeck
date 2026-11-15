"""Vessel-top radar level transmitter with a downward horn antenna.

Layout: horn below the mounting flange -> short neck -> round head above;
display faces +Z. Origin = flange's lower mating face, port.process (0, 0, 0)
faces -Y. The antenna intentionally hangs below the origin to Y=-0.20.
Overall about 0.30 X x 0.60 Y x 0.28 Z; mounting envelope 0.32 x 0.28.
No animation nodes. State colour: hd.accent on the display bezel ring only.
"""

import math
import os
import sys

# Blender --python does not put this script's directory on sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
from _common import hd
import _batch_d as d


def build():
    m = c.materials()
    # A small nozzle flange; the head deliberately keeps the pilot's family
    # proportions while the horn fits through a 0.20-diameter vessel opening.
    # The first build caught a 0.30-deep flange outside the 0.28 envelope.
    c.flange("mount.flange", (0, 0, 0), (0, -1, 0), m["white"], radius=0.14, thickness=0.03)
    c.y_cylinder("antenna.throat", -0.07, 0.01, 0.032, m["white"], segments=c.SMALL_SEG)
    c.lathe("antenna.horn", [(-0.18, 0.095),
                             (-0.065, 0.034), (-0.055, 0.032)], m["white"])
    # Review: the first face shared the horn's end plane and could z-fight.
    # An annular lip keeps Y=-0.20 while recessing the face clear of the cap.
    lip = d.ring("antenna.lip", -0.20, -0.18, 0.095, 0.078, m["white"])
    lip.matrix_basis = hd.three_matrix(rotation_t=(-math.pi / 2, 0, 0))
    c.edges(c.y_cylinder("antenna.face", -0.184, -0.179, 0.078, m["shaded"]), enabled=False)
    c.y_cylinder("neck.hex", 0.03, 0.085, 0.062, m["white"], segments=6)
    c.y_cylinder("neck", 0.075, 0.185, 0.045, m["white"], segments=c.SMALL_SEG)
    d.transmitter_head(m, y=0.27, scale=13 / 15)
    hd.add_port("process", (0, 0, 0))
    c.check(kind="mounted", footprint=(0.32, 0.28), y_min=-0.20, height=0.60,
            ports={"process": (0, 0, 0)}, anim={})


if __name__ == "__main__":
    hd.run_part(build, "level-radar")
