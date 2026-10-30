"""
Agitated mixing vessel, Arcentry-style cutaway -> assets/models/mixer.glb

Reference: the central mixer in packages/editor-2.5d-react/tests/snapshots/
reference.jpg: a slim tall bottle with vertical facet panel lines on body and
dome, latitude rings on the rounded shoulder/dome, a squat cylindrical motor
housing (collar band + drum + lid rim) on the apex, a needle shaft with a
3-blade propeller low in the liquid, a wide cutaway (about 100 deg) whose
arched top runs up into the shoulder, the inner back wall with facet lines
and horizontal rings, and a translucent light-blue liquid with a dished
bottom whose radial facet lines show through. (The reference also shows a
flat bar across the top of the window; round 5 dropped it, Des: it read as a
stray diagonal above the liquid. Only the impeller shows in the liquid.)

Three.js space, Y up, origin = floor centre under the axis. R 0.45, ~2.02 tall.
Flat base (reference has no legs; `SUPPORT = "pads"` adds the two small side
pads the reference tanks have). Wall 0..1.45 with a rounded heel (r 0.10),
elliptical head 1.45..1.75 (shaft hole at the apex), motor housing on it:
collar seated on the head (~1.69..1.75), drum to ~1.99, lid rim to ~2.02. The
inner floor is a dish (rim 0.22, pole 0.06) so the liquid bottom reads as the
reference's U.

Facets: 18 segments rotated by THETA0 = -5 deg so the boundaries sit at -5,
15, ..., 95 deg: the window (-5..95 deg, i.e. 100 deg centred on the iso
camera at 45 deg) lands exactly on facets, and the nozzles sit on facet
CENTRES (theta 185 and 265 deg) so their base rings seat flat on a panel.
Built from blender/primitives.py (cutaway_shell, interior_rings, dish,
stack_cylinders, nozzle_with_flange, impeller, liquid_volume).

Line termination rule (primitives.check_terminations, run at build time):
every meridian line ends on a drawn ring. Head, heel and dish bands are
sampled by explicit tilt angles so facet angles and ring creases stay >= 2 deg
clear of the 15 deg edge threshold; collar, drum and lid are stacked with
touching caps (never sunk); nozzles carry a base ring on the wall; the shaft
ends exactly on the hub. The window is cut ON RINGS OF BOTH PROFILES so no
seam ring appears and no ring is left as an open arc (round 5, Des: the
inner floor rim read as a stray C when the sill sliced through the dish):
  sill  outer = the heel's top ring (0.45, 0.10), inner = the dish rim
        (0.39, 0.22): the sill is a conical bevel between them, the whole
        dish (rim ring + radial rim band) lives in shell.lower as a full
        360 deg surface, and the inner wall's vertical cut edge ends on it;
  top   outer = the head's first ring (0.369, 1.622), inner = the inner
        head's first ring (0.320, 1.588): the arch cap is the cone between.

Empties
  port.in        (-0.052, 1.20, -0.598)  theta 185 deg, r 0.60: upper side nozzle (back-right in iso)
  port.out       (-0.598, 0.25, -0.052)  theta 265 deg, r 0.60: low side nozzle (back-left in iso);
                                         the base is flat so a downward nozzle has no room
  anim.agitator  (0, 1.75, 0)      spins about Y. Children: shaft (inside the
                                   housing down onto the hub), impeller.hub +
                                   impeller.blade.0..2 (pitched 3-blade propeller
                                   at y 0.40, tip-to-tip 0.44). Nothing but the
                                   slim shaft rises above the impeller (no
                                   cross paddle since round 5).
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
WALL_FACE = 0.45 * math.cos(math.pi / SEG)  # distance from the axis to a facet's flat middle
# --- shell ------------------------------------------------------------------------
R = 0.45  # outer wall radius (slim: ~2.2 tall per diameter like the reference)
T = 0.06  # wall thickness; reads as the light cut faces either side of the window
R_IN = R - T
HEEL = 0.10  # outer bottom corner radius
HEEL_ANGLES = (40, 70)  # corner bands: 20 / 55 / 80 deg tilts -> wall lines end on the 0.036 ring
Y_WALL1 = 1.45  # top of the straight wall = head equator
DOME_H = 0.30  # elliptical head height (reference: ~0.3 D from wall top to housing)
# Head bands by ellipse angle: tilts ~25 / 59 / 77 deg (outer). Meridians draw
# on band 1 (facets 18 deg) and stop on the 33 deg ring at band 1/2; the
# junction ring at the wall turns 25 deg; see check_terminations.
HEAD_ANGLES = (35, 60)
HOLE_R = 0.06  # shaft hole through the apex (hidden under the housing)
DISH_RIM_Y, DISH_DEPTH = 0.22, 0.16  # inner floor dish; pole = inner floor bottom
DISH_ANGLES = (22, 50)  # tilts ~25 / 60 / 81 deg: radial lines on the rim band, ending on the 35 deg ring
Y_FLOOR = DISH_RIM_Y - DISH_DEPTH  # 0.06 (= T, so the base is T thick on the axis)
RING_YS = (0.35, 0.55, 0.75, 0.95, 1.15, 1.35)  # inner back-wall ring lines
# --- motor housing on the apex ---------------------------------------------------
HOUSING_SEG = 12
DRUM_R, DRUM_H = 0.24, 0.24
COLLAR_SCALE, COLLAR_H = 1.08, 0.06  # base band r 0.26, seated on the head at its inscribed radius
LID_R, LID_H = 0.255, 0.03
# --- liquid -----------------------------------------------------------------------
R_LIQ = R_IN - 0.01
LIQ_H = Y_WALL1 - Y_FLOOR  # 1.39, full = up to the head equator
# --- agitator ---------------------------------------------------------------------
SHAFT_R = 0.025
Y_IMP = 0.40  # impeller hub centre, above the dish rim so the blades clear the floor
# --- ports ------------------------------------------------------------------------
NOZZLE_R, PORT_RADIUS = 0.05, 0.60  # stubs run from the wall face (0.443) to the port at 0.60 from the axis
NOZZLE_LEN = PORT_RADIUS - WALL_FACE
PORT_IN_THETA, PORT_IN_Y = math.radians(185.0), 1.20  # facet centres: theta0 + 10 + 20k
PORT_OUT_THETA, PORT_OUT_Y = math.radians(265.0), 0.25
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
    head = pr.ellipse_head(R, Y_WALL1, DOME_H, HOLE_R, HEAD_ANGLES)
    outer = head + [(R, HEEL)] + pr.round_corner(R, HEEL, 0.0, HEEL_ANGLES)[1:] + [(0.0, 0.0)]
    inner = (pr.ellipse_head(R_IN, Y_WALL1, DOME_H - T, HOLE_R, HEAD_ANGLES)
             + pr.interior_rings(R_IN, RING_YS)
             + pr.dish(R_IN, DISH_RIM_Y, DISH_DEPTH, DISH_ANGLES))
    # Every cut lands on a ring of ITS profile (no seam rings, no open arcs). Sill: outer on the
    # heel's top ring, inner on the dish rim, joined by a conical bevel, so the dish stays whole
    # behind the window. Top: the outer and inner heads' first rings (the arch cap is the cone
    # between them). cutaway_shell rejects a sill that is not at the bottom of a wall band.
    y_w1 = head[-2][1]
    y_w1_inner = inner[len(head) - 2][1]  # ellipse_head(R_IN, ...) has the same point count as `head`
    pr.cutaway_shell("shell", outer, inner, WINDOW, ((HEEL, DISH_RIM_Y), (y_w1, y_w1_inner)), SEG, flask,
                     theta0=THETA0)

    # Motor housing: collar seated on the head at its inscribed radius (the 12-gon's
    # flats touch the head; its vertices sit a hair above), then drum and lid rim,
    # caps touching so every drum line ends on a ring. Vertex-on to the camera.
    yaw = math.pi / HOUSING_SEG
    collar_r = DRUM_R * COLLAR_SCALE
    y_collar = pr.profile_y_at_r(head, collar_r * math.cos(math.pi / HOUSING_SEG))
    pr.stack_cylinders([("housing.collar", collar_r, COLLAR_H), ("housing", DRUM_R, DRUM_H), ("housing.lid", LID_R, LID_H)],
                       y_collar, flask, seg=HOUSING_SEG, yaw=yaw)
    housing_mid = y_collar + COLLAR_H + DRUM_H / 2

    # Slim nozzles with flange rings at both ends, on facet centres of the back quadrants.
    for name, th, y in (("inlet", PORT_IN_THETA, PORT_IN_Y), ("outlet", PORT_OUT_THETA, PORT_OUT_Y)):
        start = (WALL_FACE * math.sin(th), y, WALL_FACE * math.cos(th))
        end = pr.nozzle_with_flange(name, start, th, NOZZLE_LEN, white, radius=NOZZLE_R, base_ring=True)
        hd.add_port("in" if name == "inlet" else "out", end)

    # Agitator: shaft from inside the housing down onto the hub, all under one pivot.
    ag = hd.add_anim("agitator", (0, Y_WALL1 + DOME_H, 0))
    y_ag = Y_WALL1 + DOME_H
    # Blades are pitched 30 deg, so chord height (not length) is what shows through the liquid.
    hub_top = pr.impeller("impeller", ag, Y_IMP - y_ag, white, blade_len=0.18, blade_h=0.10, blade_t=0.015) + y_ag
    hd.cylinder("shaft", SHAFT_R, SHAFT_R, housing_mid - hub_top, 8, white,
                position_t=(0, (housing_mid + hub_top) / 2 - y_ag, 0), parent=ag)

    if SUPPORT == "pads":
        # Screen-left / screen-right of the base in iso (theta 315 / 135 deg).
        for th in (math.radians(315.0), math.radians(135.0)):
            rr = R + PAD_SIZE[0] / 2 - 0.03
            b.box(f"pad.{int(math.degrees(th))}", PAD_SIZE, flask,
                  position_t=(rr * math.sin(th), PAD_SIZE[1] / 2, rr * math.cos(th)), rotation_t=(0, th, 0))

    # Liquid: full inner volume with the dished bottom (radial lines through the translucency).
    rim = DISH_RIM_Y - Y_FLOOR
    liq = [(0.0, LIQ_H), (R_LIQ, LIQ_H)] + pr.dish(R_LIQ, rim, rim, DISH_ANGLES)
    pivot = pr.liquid_volume(liq, SEG, liquid_mat, Y_FLOOR, theta0=THETA0)
    if PREVIEW_FILL != 1:
        pivot.scale = (1.0, 1.0, PREVIEW_FILL)  # Blender Z = three Y


if __name__ == "__main__":
    hd.run_part(build, "mixer")
