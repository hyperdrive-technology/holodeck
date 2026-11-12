"""Centrifugal blower with scroll casing, open inlet eye and top discharge.

Layout: -Z pedestal motor -- scroll on frame -- round inlet +Z;
the asymmetric scroll climbs to a rectangular +Y discharge at its +X side.
Origin = floor at footprint centre. Overall 1.60 X x 1.49 Y x 1.80 Z,
fitting a 2 x 2 footprint. Raised air connections require elevated routing.
Ports: in (-0.08, 0.73, 0.76), facing +Z;
out (0.445, 1.49, 0.23), facing +Y (rectangular duct).
anim.blades = (-0.08, 0.73, 0.69), continuous spin about Z (0..2*pi);
the five swept blades and hub are children. hd.accent is the motor band.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import _common as c
import _batch_b as b
from _common import hd

EYE = (-0.08, 0.73, 0.69)
PORTS = {"in": (-0.08, 0.73, 0.76), "out": (0.445, 1.49, 0.23)}


def build():
    m = c.materials()
    c.plinth("skid", 1.60, 1.80, 0.06, m["shaded"])
    for i, x in enumerate((-0.47, 0.36)):
        c.box(f"frame.leg.{i}", (0.11, 0.30, 0.42), m["white"], (x, 0.21, 0.20))
    c.box("motor.pedestal", (0.46, 0.46, 0.56), m["white"], (-0.08, 0.29, -0.58))
    b.motor("motor", m, (-0.08, 0.73, -0.55), scale=0.65, rotation=(0, -math.pi/2, 0))
    c.z_cylinder("drive.axle", -0.3355, -0.03, 0.045, m["shaded"], x=-0.08, y=0.73, segments=8)

    # The outline grows toward a tangential outlet instead of using a round
    # drum with an unrelated box on top. Its front is an annulus, leaving an
    # actual opening around the rotor; a solid cylinder would hide motion.
    outer = [(0.56, 0.73), (0.66, 1.10), (0.66, 1.43), (0.23, 1.43),
             (-0.39, 1.27), (-0.60, 1.03), (-0.69, 0.73), (-0.61, 0.42),
             (-0.37, 0.23), (-0.08, 0.18), (0.19, 0.27), (0.39, 0.46)]
    n = len(outer)
    inner = [(-0.08 + 0.25*math.cos(i*math.tau/n),
              0.73 + 0.25*math.sin(i*math.tau/n)) for i in range(n)]
    vertices = [(x, y, z) for z, contour in ((-0.02, outer), (0.51, outer),
                                          (-0.02, inner), (0.51, inner)) for x, y in contour]
    faces = []
    for i in range(n):
        j = (i+1) % n
        faces += [(i, j, n+j, n+i), (n+i, n+j, 3*n+j, 3*n+i),
                  (2*n+j, 2*n+i, 3*n+i, 3*n+j), (j, i, 2*n+i, 2*n+j)]
    c.edges(c.mesh("scroll", vertices, faces, m["white"]), 40)
    b.extrude("scroll.back", outer, -0.05, -0.02, m["white"])
    b.ring("inlet.neck", 0.50, 0.71, 0.29, 0.25, m["white"], axis="Z", position=(-0.08, 0.73, 0))
    b.ring("inlet.flange", 0.71, 0.76, 0.34, 0.26, m["white"], axis="Z", position=(-0.08, 0.73, 0))
    hd.add_port("in", PORTS["in"])
    # Four broad walls define the rectangular mating face without fine grille
    # bars. A shallow shaded floor makes the duct opening legible from above.
    c.box("out.throat", (0.43, 0.008, 0.42), m["shaded"], (0.445, 1.434, 0.23))
    # First build was 60,872 bytes. One hollow rim replaces four boxes and
    # their hidden end caps, preserving the silhouette under the 60 KB cap.
    outer_rim = [(0.20, -0.03), (0.69, -0.03), (0.69, 0.49), (0.20, 0.49)]
    inner_rim = [(0.23, 0), (0.66, 0), (0.66, 0.46), (0.23, 0.46)]
    vertices = [(x, y, z) for y, contour in ((1.39, outer_rim), (1.49, outer_rim),
                                           (1.39, inner_rim), (1.49, inner_rim))
                for x, z in contour]
    faces = []
    for i in range(4):
        j = (i + 1) % 4
        faces += [(i, j, 4+j, 4+i), (8+j, 8+i, 12+i, 12+j),
                  (j, i, 8+i, 8+j), (4+i, 4+j, 12+j, 12+i)]
    c.mesh("out.rim", vertices, faces, m["white"])
    hd.add_port("out", PORTS["out"])

    # Preview feedback: at Z=0.56 the deep inlet hid most of the blades in
    # the 160 px iso view. Keep the eye near the mouth, still recessed behind
    # Z=0.76; its swept radius stays inside the collar at every rotation.
    blades = hd.add_anim("blades", EYE)
    c.z_cylinder("impeller.hub", -0.035, 0.045, 0.075, m["shaded"], segments=8, parent=blades)
    blade = [(0.048, -0.022), (0.19, -0.070), (0.225, -0.025), (0.16, 0.020), (0.05, 0.027)]
    for i in range(5):
        a = i*math.tau/5
        outline = [(x*math.cos(a)-y*math.sin(a), x*math.sin(a)+y*math.cos(a)) for x, y in blade]
        c.edges(b.extrude(f"impeller.blade.{i}", outline, -0.018, 0.018,
                          m["white"], parent=blades), 50)
    c.check(kind="floor", footprint=(2, 2), height=1.50, ports=PORTS, anim={"blades": EYE})


if __name__ == "__main__":
    hd.run_part(build, "blower")
