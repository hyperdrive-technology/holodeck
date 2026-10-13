"""
Gasketed plate heat exchanger (wort chiller) -> assets/models/heat-exchanger.glb

Three.js space, Y up, origin = floor centre under the plate pack. Fixed head
plate faces +Z (all four nozzles on it, the usual PHE layout); the plate pack
and follower plate extend toward -Z. ~1.1 tall, 0.46 wide, 0.70 deep.

Empties (nozzle flange faces, all on the +Z head, pointing +Z)
  port.hot-in    (-0.13, 0.95, 0.39)
  port.hot-out   (-0.13, 0.22, 0.39)
  port.cold-in   ( 0.13, 0.22, 0.39)
  port.cold-out  ( 0.13, 0.95, 0.39)
No anim.* nodes (no moving parts, no liquid).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import brewery as b  # noqa: E402
import holodeck_bpy as hd  # noqa: E402

W, H = 0.46, 0.95  # plate width / height
Y0 = 0.15  # plate bottom above floor (frame foot clearance)
Z_HEAD = 0.30  # fixed head plate centre
HEAD_T = 0.06
N_PLATES = 10
PLATE_T, PLATE_GAP = 0.03, 0.012
NOZZLE_X, NOZZLE_Y_LO, NOZZLE_Y_HI = 0.13, 0.22, 0.95


def build() -> None:
    white = hd.material("hd.white")
    cy = Y0 + H / 2

    # Fixed head and follower (thicker) plates.
    b.box("head", (W, H, HEAD_T), white, position_t=(0, cy, Z_HEAD))
    z = Z_HEAD - HEAD_T / 2
    # Plate pack: individual thin plates so the silhouette shows the corrugation gaps.
    for i in range(N_PLATES):
        z -= PLATE_GAP + PLATE_T / 2
        b.box(f"plate.{i}", (W - 0.04, H - 0.04, PLATE_T), white, position_t=(0, cy, z))
        z -= PLATE_T / 2
    z -= PLATE_GAP + HEAD_T / 2
    b.box("follower", (W, H, HEAD_T), white, position_t=(0, cy, z))
    z_back = z - HEAD_T / 2

    # Carrying bar (top) and guide bar (bottom) through both plates, tie bolts at the corners.
    z_mid = (Z_HEAD + HEAD_T / 2 + z_back) / 2
    length = Z_HEAD + HEAD_T / 2 - z_back + 0.1
    z_mid -= 0.0
    b.box("bar.top", (0.05, 0.04, length), white, position_t=(0, Y0 + H + 0.02, z_mid))
    b.box("bar.bottom", (0.05, 0.04, length), white, position_t=(0, Y0 - 0.02, z_mid))
    for i, (sx, sy) in enumerate([(-1, -1), (1, -1), (-1, 1), (1, 1)]):
        hd.cylinder(f"bolt.{i}", 0.014, 0.014, Z_HEAD + HEAD_T / 2 - z_back, 6, white,
                    position_t=(sx * (W / 2 - 0.03), cy + sy * (H / 2 - 0.05), (Z_HEAD + HEAD_T / 2 + z_back) / 2),
                    rotation_t=(1.5707963267948966, 0, 0))
    # Support legs and a rear column.
    b.box("foot.front", (W + 0.08, 0.04, 0.10), white, position_t=(0, 0.02, Z_HEAD))
    b.box("foot.back", (W + 0.08, 0.04, 0.10), white, position_t=(0, 0.02, z_back + 0.05))
    b.box("rail.0", (0.05, Y0 - 0.04, 0.05), white, position_t=(-W / 2 + 0.03, (Y0 - 0.04) / 2 + 0.04, Z_HEAD))
    b.box("rail.1", (0.05, Y0 - 0.04, 0.05), white, position_t=(W / 2 - 0.03, (Y0 - 0.04) / 2 + 0.04, Z_HEAD))

    z_face = Z_HEAD + HEAD_T / 2
    for name, x, y in (("hot-in", -NOZZLE_X, NOZZLE_Y_HI), ("hot-out", -NOZZLE_X, NOZZLE_Y_LO),
                       ("cold-in", NOZZLE_X, NOZZLE_Y_LO), ("cold-out", NOZZLE_X, NOZZLE_Y_HI)):
        end = b.pipe_stub(f"nozzle.{name}", (x, y, z_face - 0.01), "+z", 0.07, white, radius=0.045)
        hd.add_port(name, end)


if __name__ == "__main__":
    hd.run_part(build, "heat-exchanger")
