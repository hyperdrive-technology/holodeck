"""
Agitated mixing vessel, Arcentry-style cutaway -> assets/models/mixer.glb

Reference: the central mixer in packages/editor-2.5d-react/tests/snapshots/
reference.jpg: a slim tall bottle with vertical facet panel lines on body and
dome, latitude rings on the rounded shoulder/dome, a squat cylindrical motor
housing on the apex, a needle shaft with a flat cross paddle high up and a
3-blade propeller low in the liquid, a wide cutaway (about 100 deg) whose
arched top runs up into the shoulder, the inner back wall with facet lines and
horizontal rings, and a translucent light-blue liquid with a dished bottom
whose radial facet lines show through.

Three.js space, Y up, origin = floor centre under the axis. R 0.45, 2.01 tall.
Flat base (reference has no legs; `SUPPORT = "pads"` adds the two small side
pads the reference tanks have). Wall 0..1.45 with a rounded heel (r 0.10),
elliptical head 1.45..1.75 (shaft hole at the apex), motor housing 1.68..1.98,
lid to 2.01. The inner floor is a dish (rim 0.22, pole 0.06) so the liquid
bottom reads as the reference's U.

Facets: 18 segments rotated by THETA0 = -5 deg so the boundaries sit at -5,
15, ..., 95 deg: the window (-5..95 deg, i.e. 100 deg centred on the iso
camera at 45 deg) lands exactly on facets. Built from blender/primitives.py:
`cutaway_shell` (three closed thick-walled solids: upper 360 deg, band
keep-arc with planar cut faces following the shoulder curve, lower 360 deg),
`interior_rings`, `impeller`, `nozzle_with_flange`, `liquid_volume`.

Empties
  port.in        (0, 1.20, -0.58)  -Z upper side nozzle (back-right in iso)
  port.out       (-0.58, 0.25, 0)  -X low side nozzle (back-left in iso);
                                   the base is flat so a downward nozzle has no room
  anim.agitator  (0, 1.75, 0)      spins about Y. Children: shaft (inside the
                                   housing down into the hub), paddle (flat cross
                                   bar at y 1.30), impeller.hub + impeller.blade.0..2
                                   (pitched 3-blade propeller at y 0.40, tip-to-tip 0.44)
  anim.liquid    (0, 0.06, 0)      liquid origin = dish pole (inner floor bottom)
Liquid convention (brewery.py): child mesh `liquid` spans local y 0..1.39 when
full; runtime sets anim.liquid.scale.y = fill 0..1. Material `hd.liquid`: the
runtime's translucent finish (style.ts liquidFinish: opacity 0.62, depthWrite
off, colour from the style, edges drawn), so the back wall, the paddle and the
impeller read through it. It is a FULL revolution inside the wall (not the
opaque vessels' outset sight-window slice).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402
import primitives as pr  # noqa: E402

# --- facets / window ------------------------------------------------------------
SEG = 18  # 20 deg panels: the reference body shows ~9 meridians across its front half
THETA0 = math.radians(-5.0)
WINDOW = (math.radians(-5.0), math.radians(95.0))  # 100 deg, centred on the camera
# --- shell ------------------------------------------------------------------------
R = 0.45  # outer wall radius (slim: ~2.2 tall per diameter like the reference)
T = 0.06  # wall thickness; reads as the light cut faces either side of the window
R_IN = R - T
HEEL = 0.10  # outer bottom corner radius
Y_WALL1 = 1.45  # top of the straight wall = head equator
DOME_H = 0.30  # elliptical head height (reference: ~0.3 D from wall top to housing)
DOME_STEPS = 4  # 22.5 deg latitude steps -> the reference's ~3 rings on shoulder + dome
Y_APEX = Y_WALL1 + DOME_H  # 1.75
HOLE_R = 0.06  # shaft hole through the apex (hidden under the housing)
DISH_RIM_Y, DISH_DEPTH = 0.22, 0.16  # inner floor dish; pole = inner floor bottom
Y_FLOOR = DISH_RIM_Y - DISH_DEPTH  # 0.06 (= T, so the base is T thick on the axis)
Y_W0, Y_W1 = 0.08, 1.65  # window sill (into the heel) and arched top (into the head)
RING_YS = (0.35, 0.55, 0.75, 0.95, 1.15, 1.35)  # inner back-wall ring lines
# --- motor housing on the apex ---------------------------------------------------
HOUSING_R, HOUSING_H, HOUSING_SEG = 0.24, 0.30, 12
HOUSING_Y0 = Y_APEX - 0.07  # sunk into the head so its rim meets the curve
LID_R, LID_H = 0.255, 0.03
Y_TOP = HOUSING_Y0 + HOUSING_H + LID_H  # 2.01
# --- liquid -----------------------------------------------------------------------
R_LIQ = R_IN - 0.01
LIQ_H = Y_WALL1 - Y_FLOOR  # 1.39, full = up to the head equator
# --- agitator ---------------------------------------------------------------------
SHAFT_R = 0.025
Y_IMP = 0.40  # impeller hub centre, above the dish rim so the blades clear the floor
Y_PADDLE = 1.30  # flat cross bar near the top (reference shows one across the window)
PADDLE_SIZE = (0.72, 0.025, 0.04)  # along X: nearly the inner diameter; thin like the reference bar
# --- ports ------------------------------------------------------------------------
NOZZLE_R, NOZZLE_LEN = 0.05, 0.15
PORT_IN_Y, PORT_OUT_Y = 1.20, 0.25
# --- optional support -------------------------------------------------------------
SUPPORT = "none"  # "none" (reference mixer) | "pads" (two side pads like the tanks)
PAD_SIZE = (0.12, 0.26, 0.12)
# Dev-only: HD_MIXER_PREVIEW_FILL=0.52 scales anim.liquid so the parts page /
# preview shows a part-filled vessel (the reference is ~52%). It is baked into
# the GLB, so never commit one built with it set (mixer-glb.test.ts checks the
# pivot is unscaled).
PREVIEW_FILL = float(os.environ.get("HD_MIXER_PREVIEW_FILL", "1"))


def build() -> None:
    flask = hd.material("hd.flask")
    white = hd.material("hd.white")
    liquid_mat = hd.material("hd.liquid", "#18bae6", alpha=0.62)  # preview tint; runtime uses the style

    # Full outer / inner surface profiles, TOP -> BOTTOM.
    outer = (pr.ellipse_head(R, Y_WALL1, DOME_H, HOLE_R, DOME_STEPS)
             + [(R, HEEL)] + pr.round_corner(R, HEEL, 0.0, 3)[1:] + [(0.0, 0.0)])
    inner = (pr.ellipse_head(R_IN, Y_WALL1, DOME_H - T, HOLE_R, DOME_STEPS)
             + pr.interior_rings(R_IN, RING_YS)
             + pr.dish(R_IN, DISH_RIM_Y, DISH_DEPTH, 3))
    pr.cutaway_shell("shell", outer, inner, WINDOW, (Y_W0, Y_W1), SEG, flask, theta0=THETA0)

    # Motor housing: squat 12-gon on the apex, vertex-on to the camera, with a lid rim.
    yaw = math.pi / HOUSING_SEG
    hd.cylinder("housing", HOUSING_R, HOUSING_R, HOUSING_H, HOUSING_SEG, flask,
                position_t=(0, HOUSING_Y0 + HOUSING_H / 2, 0), rotation_t=(0, yaw, 0))
    hd.cylinder("housing.lid", LID_R, LID_R, LID_H, HOUSING_SEG, flask,
                position_t=(0, HOUSING_Y0 + HOUSING_H + LID_H / 2, 0), rotation_t=(0, yaw, 0))

    # Slim nozzles with flange rings, on the back quadrants so they never cross the window.
    hd.add_port("in", pr.nozzle_with_flange("inlet", (0, PORT_IN_Y, -R + 0.02), "-z", NOZZLE_LEN, white, radius=NOZZLE_R))
    hd.add_port("out", pr.nozzle_with_flange("outlet", (-R + 0.02, PORT_OUT_Y, 0), "-x", NOZZLE_LEN, white, radius=NOZZLE_R))

    # Agitator: shaft from inside the housing down to the impeller, all under one pivot.
    ag = hd.add_anim("agitator", (0, Y_APEX, 0))
    shaft_bot, shaft_top = Y_IMP - 0.04, HOUSING_Y0 + HOUSING_H / 2
    hd.cylinder("shaft", SHAFT_R, SHAFT_R, shaft_top - shaft_bot, 8, white,
                position_t=(0, (shaft_top + shaft_bot) / 2 - Y_APEX, 0), parent=ag)
    b.box("paddle", PADDLE_SIZE, white, position_t=(0, Y_PADDLE - Y_APEX, 0), parent=ag)
    # Blades are pitched 30 deg, so chord height (not length) is what shows through the liquid.
    pr.impeller("impeller", ag, Y_IMP - Y_APEX, white, blade_len=0.18, blade_h=0.10, blade_t=0.015)  # tip-to-tip 0.44

    if SUPPORT == "pads":
        # Screen-left / screen-right of the base in iso (theta 315 / 135 deg).
        for th in (math.radians(315.0), math.radians(135.0)):
            rr = R + PAD_SIZE[0] / 2 - 0.03
            b.box(f"pad.{int(math.degrees(th))}", PAD_SIZE, flask,
                  position_t=(rr * math.sin(th), PAD_SIZE[1] / 2, rr * math.cos(th)), rotation_t=(0, th, 0))

    # Liquid: full inner volume with the dished bottom (radial lines through the translucency).
    rim = DISH_RIM_Y - Y_FLOOR
    liq = [(0.0, LIQ_H), (R_LIQ, LIQ_H)] + pr.dish(R_LIQ, rim, rim, 3)
    pivot = pr.liquid_volume(liq, SEG, liquid_mat, Y_FLOOR, theta0=THETA0)
    if PREVIEW_FILL != 1:
        pivot.scale = (1.0, 1.0, PREVIEW_FILL)  # Blender Z = three Y


if __name__ == "__main__":
    hd.run_part(build, "mixer")
