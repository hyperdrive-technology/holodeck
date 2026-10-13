"""
End-suction centrifugal pump with close-coupled motor on a baseplate
-> assets/models/pump.glb

Arcentry iso style: faceted low-poly white solids, outlines on facet
creases, no bevels. Everything below is in three.js space (Y up, pipe axis
X); holodeck_bpy converts to Blender Z-up on the way in.

Layout along X (suction end is +X, motor is -X):

      +X  suction flange | volute | bearing frame | coupling | motor | fan cowl  -X
                          ^ origin: floor level under the volute centre

Shaft axis height SHAFT_Y. Overall ~1.4 long x 0.7 tall x 0.6 deep.
Empties: port.suction (+X flange face), port.discharge (top flange face),
anim.shaft (shaft axis at the coupling; the coupling and fan hub are its
children so the runtime can spin them about X).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import holodeck_bpy as hd  # noqa: E402  (needs the sys.path tweak above)

# A cylinder built along +Y is laid along X by this three.js rotation.
ALONG_X = (0, 0, math.pi / 2)

SHAFT_Y = 0.32  # shaft / pipe axis height above the floor
PIPE_R = 0.09  # matches the scene pipe radius (~0.08-0.1)
FLANGE_R = 0.135
FLANGE_T = 0.035
SEG = 12  # radial segments on every round part so facets line up

# --- volute / pump end ------------------------------------------------------
VOLUTE_R = 0.27
VOLUTE_W = 0.22  # casing width along X, centred on x=0
SUCTION_X0 = VOLUTE_W / 2  # nozzle starts at the casing face
SUCTION_LEN = 0.14
DISCHARGE_TOP = 0.72  # flange face height (model top)
# --- bearing frame + coupling ----------------------------------------------
FRAME_R = 0.13
FRAME_X0, FRAME_X1 = -VOLUTE_W / 2, -0.40
COUPLING_X = -0.47  # anim.shaft pivot
COUPLING_R = 0.07
COUPLING_LEN = 0.12
# --- motor -------------------------------------------------------------------
MOTOR_R = 0.21
MOTOR_X0, MOTOR_X1 = -0.54, -0.96
FIN_XS = (-0.64, -0.72, -0.80, -0.88)
COWL_X0, COWL_X1 = MOTOR_X1, -1.10
# --- baseplate ---------------------------------------------------------------
BASE_X0, BASE_X1 = 0.24, -1.14
BASE_Z = 0.30  # half depth
BASE_H = 0.05
MOTOR_BLUE = "#2e6fb7"


def box(name, size_t, mat, position_t=(0, 0, 0), rotation_t=(0, 0, 0), parent=None):
    """Axis-aligned box (three.js BoxGeometry, no segments). holodeck_bpy has
    no box builder, so this is implemented locally on its mesh helper."""
    hx, hy, hz = (s / 2.0 for s in size_t)
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    # CCW seen from outside: +Z, -Z, +X, -X, +Y, -Y.
    faces = [(4, 5, 6, 7), (1, 0, 3, 2), (5, 1, 2, 6), (0, 4, 7, 3), (3, 7, 6, 2), (0, 1, 5, 4)]
    return hd._mesh_object(name, verts, faces, mat, position_t, rotation_t, parent)


def x_cylinder(name, radius, x0, x1, mat, y=SHAFT_Y, r_end=None, segments=SEG, parent=None):
    """Cylinder along X from x0 to x1 on the shaft axis. `r_end` tapers the
    x1 end (cylinder +Y maps to +X under ALONG_X, so radius_top is at x1)."""
    length = abs(x1 - x0)
    r1 = radius if r_end is None else r_end
    r_top, r_bot = (r1, radius) if x1 > x0 else (radius, r1)
    return hd.cylinder(name, r_top, r_bot, length, segments, mat,
                       position_t=((x0 + x1) / 2, y, 0), rotation_t=ALONG_X, parent=parent)


def build() -> None:
    white = hd.material("hd.white")
    band_mat = hd.material("hd.accent", MOTOR_BLUE)  # one flat band, like Arcentry pipe bands

    # Baseplate: a slab on the floor with a lip; origin sits on its top face
    # under the volute. Pedestals carry the pump and motor down to it.
    box("base", (BASE_X0 - BASE_X1, BASE_H, BASE_Z * 2), white,
        position_t=((BASE_X0 + BASE_X1) / 2, BASE_H / 2, 0))

    # Volute casing: a fat 12-sided drum on the shaft axis. The discharge
    # throat is a box rising off the top so the drum reads as a snail shell.
    x_cylinder("volute", VOLUTE_R, VOLUTE_W / 2, -VOLUTE_W / 2, white)
    box("volute.throat", (0.2, 0.18, 0.2), white, position_t=(0, SHAFT_Y + VOLUTE_R - 0.05, 0))
    box("volute.foot", (0.22, SHAFT_Y - VOLUTE_R + 0.08, 0.26), white,
        position_t=(0, (SHAFT_Y - VOLUTE_R + 0.08) / 2 + BASE_H - 0.02, 0))

    # Suction nozzle (+X, axial) with a raised flange at the end.
    x_cylinder("suction", PIPE_R, SUCTION_X0, SUCTION_X0 + SUCTION_LEN, white)
    sx = SUCTION_X0 + SUCTION_LEN
    x_cylinder("suction.flange", FLANGE_R, sx - FLANGE_T, sx, white)
    hd.add_port("suction", (sx, SHAFT_Y, 0))

    # Discharge nozzle straight up from the throat, flange on top.
    throat_top = SHAFT_Y + VOLUTE_R + 0.04
    hd.cylinder("discharge", PIPE_R, PIPE_R, DISCHARGE_TOP - throat_top, SEG, white,
                position_t=(0, (throat_top + DISCHARGE_TOP) / 2, 0))
    hd.cylinder("discharge.flange", FLANGE_R, FLANGE_R, FLANGE_T, SEG, white,
                position_t=(0, DISCHARGE_TOP - FLANGE_T / 2, 0))
    hd.add_port("discharge", (0, DISCHARGE_TOP, 0))

    # Bearing frame between volute and coupling, on a pedestal.
    x_cylinder("frame", FRAME_R, FRAME_X0, FRAME_X1, white)
    box("frame.pedestal", (0.16, SHAFT_Y - FRAME_R + 0.04, 0.3), white,
        position_t=((FRAME_X0 + FRAME_X1) / 2, (SHAFT_Y - FRAME_R + 0.04) / 2 + BASE_H, 0))

    # Coupling: spins about X. The guard is an open-bottomed hood over it so
    # the coupling stays visible underneath (and the hood reads as a guard).
    shaft = hd.add_anim("shaft", (COUPLING_X, SHAFT_Y, 0))
    coupling = hd.cylinder("coupling", COUPLING_R, COUPLING_R, COUPLING_LEN, 8, white,
                           rotation_t=ALONG_X, parent=shaft)
    hd.set_props(coupling, hd_edges=False)
    box("coupling.guard", (0.14, 0.14, 0.26), white, position_t=(COUPLING_X, SHAFT_Y + 0.06, 0))

    # Motor: drum with a few flat fin rings, feet, a terminal box on top and
    # a tapered fan cowl at the -X end.
    x_cylinder("motor", MOTOR_R, MOTOR_X0, MOTOR_X1, white)
    for i, fx in enumerate(FIN_XS):
        fin = x_cylinder(f"motor.fin.{i}", MOTOR_R + 0.02, fx - 0.012, fx + 0.012, white)
        # Only the fin's cap creases should draw, not its 12 thin side facets.
        hd.set_props(fin, hd_edge_threshold=45.0)
    # Flush blue band at the drive end: flat colour stripe, no creases
    # (a protruding coloured ring read as a thick painted arc at iso).
    band = x_cylinder("motor.band", MOTOR_R + 0.002, MOTOR_X0 - 0.03, MOTOR_X0 - 0.07, band_mat)
    hd.set_props(band, hd_edges=False)
    box("motor.feet", (0.3, SHAFT_Y - MOTOR_R + 0.06, 0.34), white,
        position_t=((MOTOR_X0 + MOTOR_X1) / 2, (SHAFT_Y - MOTOR_R + 0.06) / 2 + BASE_H, 0))
    box("motor.terminal", (0.16, 0.1, 0.16), white,
        position_t=((MOTOR_X0 + MOTOR_X1) / 2 + 0.04, SHAFT_Y + MOTOR_R - 0.01, 0))
    x_cylinder("motor.cowl", MOTOR_R + 0.01, COWL_X0, COWL_X1, white, r_end=MOTOR_R - 0.03)
    # Fan hub poking out of the cowl, spins with the shaft.
    hub = hd.cylinder("fan.hub", 0.05, 0.05, 0.03, 8, white,
                      position_t=(COWL_X1 - 0.015 - COUPLING_X, 0, 0), rotation_t=ALONG_X, parent=shaft)
    hd.set_props(hub, hd_edges=False)


if __name__ == "__main__":
    hd.run_part(build, "pump")
