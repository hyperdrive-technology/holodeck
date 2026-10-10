"""
Globe valve with doughnut handwheel -> assets/models/valve.glb

Ported from holodeck/packages/editor-2.5d-react/assets/process/Valve.tsx
using DEFAULT_FITTING_PARAMS in fitting-params.ts (copy changes here by
hand when the tuner defaults move; the vitest GLB test pins the extents).

Origin = placement anchor: centre of the pipe axis through the body.
Pipe axis = three.js X. Handwheel on top (+Y), spinning about +Y.
All positions/rotations below are written in three.js space, exactly as
in the R3F component; holodeck_bpy converts to Blender Z-up.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import holodeck_bpy as hd  # noqa: E402  (needs the sys.path tweak above)

# --- DEFAULT_FITTING_PARAMS (valve*) ---------------------------------------
GLOBE_R = 0.2  # valveGlobe
GLOBE_W = 16  # valveGlobeW
GLOBE_H = 12  # valveGlobeH
BARREL_R = 0.08  # valveBarrelR
BARREL_LEN = 0.42  # valveBarrelLen
BARREL_SIDES = 10  # valveBarrelSides
STEM_R = 0.024  # valveStemR
STEM_H = 0.16  # valveStemH
STEM_Y = 0.27  # valveStemY
STEM_SIDES = 8  # hard-coded in Valve.tsx
WHEEL_R = 0.33  # valveWheelR
SPOKE_Y = 0.35  # valveSpokeY (handwheel plane height)
TORUS_TUBE = 0.07  # valveTorusTube
TORUS_RADIAL = 8  # valveTorusRadial
TORUS_TUBULAR = 24  # valveTorusTubular
SPOKE_R = 0.012  # valveSpokeR
SPOKE_COUNT = 4  # valveSpokeCount
SPOKE_SIDES = 6  # hard-coded in Valve.tsx
HANDWHEEL = "#c0392b"  # valveHandwheel (accent default)
# valveShowDisc defaults to false, valveShowWire false -> not modelled.


def build() -> None:
    white = hd.material("hd.white")
    accent = hd.material("hd.accent", HANDWHEEL)

    # Body: globe + barrel along X (three rotation [0, 0, pi/2] lays the
    # Y-axis cylinder along X).
    hd.uv_sphere("globe", GLOBE_R, GLOBE_W, GLOBE_H, white)
    hd.cylinder("barrel", BARREL_R, BARREL_R, BARREL_LEN, BARREL_SIDES, white, rotation_t=(0, 0, math.pi / 2))
    stem = hd.cylinder("stem", STEM_R, STEM_R, STEM_H, STEM_SIDES, white, position_t=(0, STEM_Y, 0))
    hd.set_props(stem, hd_edges=False)  # 8-sided pencil: outlines read as noise

    # Handwheel: pivot on the stem axis at the wheel plane; meshes are
    # local to it so the runtime can spin `anim.handwheel` about its Y.
    wheel = hd.add_anim("handwheel", (0, SPOKE_Y, 0))
    rim = hd.torus(
        "handwheel.rim", WHEEL_R, TORUS_TUBE, TORUS_RADIAL, TORUS_TUBULAR, accent,
        rotation_t=(math.pi / 2, 0, 0), parent=wheel,
    )
    # Same crease threshold the tuner uses for elbow tori; the default
    # would outline every one of the 8x24 tube facets.
    hd.set_props(rim, hd_edge_threshold=22.0)

    # Valve.tsx draws SPOKE_COUNT full-diameter bars at i*2pi/N. For even N,
    # bar i and bar i+N/2 are the same geometry (z-fighting duplicates), so
    # only the distinct angles in [0, pi) are emitted. Visually identical.
    angles = sorted({round((i * math.tau / SPOKE_COUNT) % math.pi, 9) for i in range(SPOKE_COUNT)})
    for k, a in enumerate(angles):
        spoke = hd.cylinder(
            f"handwheel.spoke.{k}", SPOKE_R, SPOKE_R, WHEEL_R * 2, SPOKE_SIDES, accent,
            rotation_t=(math.pi / 2, 0, a), parent=wheel,
        )
        hd.set_props(spoke, hd_edges=False)

    # Pipe connection points at the barrel ends, on the X axis.
    hd.add_port("in", (-BARREL_LEN / 2, 0, 0))
    hd.add_port("out", (BARREL_LEN / 2, 0, 0))


if __name__ == "__main__":
    hd.run_part(build, "valve")
