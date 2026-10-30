# Holodeck Blender parts

Python scripts, run headless in Blender, that model fixed-shape parts (valves,
pumps, mixers, motors, instruments) and export them as GLB for
`holodeck/packages/editor-2.5d-react/assets/models/`. Blender owns the **shape** only.
The runtime style layer applies white fill, iso shading and `#666` outlines by
material name.

## Commands

Run these from `holodeck/packages/editor-2.5d-react`:

```sh
pnpm run parts:build            # every parts/*.py -> assets/models/<part>.glb
pnpm run parts:build valve      # one part
pnpm run parts:watch [valve]    # rebuild when a part or holodeck_bpy.py changes
node scripts/build-parts.mjs --out-dir /tmp/x valve
npx vitest run src/models       # asset contract tests (rebuild check skips without Blender)
```

Cloud archetypes live in `parts/cloud/` and belong to `@holodeck/library-cloud`.
From `packages/library-cloud`, run `pnpm parts:build` for its GLBs or
`pnpm parts:preview` for GLBs plus `/tmp/a1-previews/<archetype>.png`. See the
[cloud library README](../packages/library-cloud/README.md) for its catalogue and tests.

Blender is found via `$BLENDER`, then `/Applications/Blender.app/Contents/MacOS/Blender`,
then `blender` on `PATH`. Tested with Blender 5.2.2 LTS. To render a preview
(Workbench, orthographic iso camera, not exported), run:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
  --python parts/valve.py -- --out /tmp/valve.glb --preview /tmp/valve.png
```

## Seeing it in the real style

The Blender preview is Workbench shading, not the Holodeck look. The real check
is the parts page, which loads every `assets/models/*.glb` through
`HolodeckModel` (the GLB plus `applyHolodeckStyle`), next to its hand-coded R3F
twin where one exists:

```sh
pnpm run parts:watch            # terminal 1: rebuild GLBs on script save
pnpm run parts                  # terminal 2: vite page, full-reloads on GLB write
npx vitest run src/iso/parts-render.test.ts   # headless: artifacts/render/parts.png
```

The render test fails on any `applyHolodeckStyle` warning, for example a
material outside `hd.*`. Note that GLTFLoader removes `.` from node names
(`port.in` arrives as `portin`). The original name is kept in `userData.name`;
`findPorts` and `findAnimNodes` read it.

Vessels ship with a full liquid (the runtime scales `anim.liquid`). To judge a
part-filled look on the parts page, `parts/mixer.py` honours
`HD_MIXER_PREVIEW_FILL=0.52 pnpm run parts:build mixer`; rebuild without it
before committing (the GLB tests check the pivot is unscaled).

## Adding a part

1. Create `parts/<part>.py`. Copy the header of `parts/valve.py`, which adds the
   `sys.path` entry and imports `holodeck_bpy as hd`, then define `build()` and
   end with `hd.run_part(build, "<part>")`.
2. Build it with `hd.cylinder` / `hd.uv_sphere` / `hd.torus` / `hd.empty`. Every
   position and rotation is in **three.js space** (Y-up, R3F Euler `XYZ`), and the
   segment parametrisation matches three's geometries. You can port R3F code
   one-to-one, and facets line up with hand-coded parts. Vessel-level builders
   (`lathe`, `sweep`, `cutaway_shell`, `interior_rings`, `nozzle_with_flange`,
   `impeller`, `liquid_volume`, `ring` / `collar` / `stack_cylinders`) live in
   `primitives.py`; `brewery.py` adds the brewery vessels' shared conventions
   (sight-window liquid, legs, pipe stubs).
3. Run `pnpm run parts:build <part>`. Add `src/models/<part>-glb.test.ts`,
   modelled on `valve-glb.test.ts`.

## Contract

- Output is `assets/models/<part>.glb`, glTF Y-up, 1 unit = 1 three.js unit.
  The origin is the placement anchor (for an inline valve, the centre of the
  pipe axis through the body).
- Materials are matched **by name only**: `hd.white`, `hd.shaded`, `hd.vessel`,
  `hd.flask`, `hd.accent`, `hd.liquid`. Only `hd.accent`'s base colour is read (it is the
  default accent, e.g. handwheel `#c0392b`). `hd.liquid` is the translucent liquid
  finish (colour and opacity come from the style; `hd.material(..., alpha=)` only tints
  the Workbench preview). `hd.material()` rejects any other name.
- Optional node extras come from object custom properties, set with
  `hd.set_props(obj, ...)`: `hd_edge_threshold` (float, degrees) and
  `hd_edges` (`False` disables outlines).
- Empties:
  - `port.<name>` marks a pipe connection point (`hd.add_port`).
  - `anim.<name>` is the pivot of an animated sub-assembly (`hd.add_anim`). Its
    meshes are children positioned relative to it.
  - Cloud data-only parts have exactly one `logo` empty centered on a flat top
    face. Its X/Z scale is the safe logo-square edge length in three.js units;
    E2 supplies the depth offset. Their `hd.white` and `hd.accent` materials
    support per-part recolouring. See the [E2 contract](../packages/editor-2.5d-react/docs/objects.md).
    The logo face is always the model's highest surface, so nothing can hang
    over it (the disk's read arm sweeps below its raised hub, the bucket's
    bail is lowered). One exception: `cloud/billboard.py` puts the empty on
    the sign's front (+Z) face via `c.logo(..., rotation=(pi/2, 0, 0))`, so
    its local +Y is the face normal and local −Z the image top. E2 honours
    the empty's rotation, so the logo stands on the sign's front face.
- Geometry is low-poly and flat-shaded, with explicit segment counts. Don't use
  subdivision, textures or UVs. Cameras and lights are rejected on export.
  Modifiers are applied on export.

## Line termination rule

Every vertical / meridian line the runtime draws must end on a drawn horizontal
ring or on a window cut edge; no line may fade out part-way across a curved
band, and no cylinder may be sunk into another surface so its lines vanish
without a ring. The runtime draws an edge iff the dihedral angle between its two
faces is at least `HOLODECK_STYLE.edges.threshold` (15°), so for a revolved band
tilted `phi` from vertical with `seg` facets the meridians show only when
`acos(cos²(phi)·cos(2π/seg) + sin²(phi)) >= 15°`, and the ring between two bands
shows only when the profile turns by at least 15° there.

- `primitives.check_terminations(name, profile, seg)` proves the rule for a
  profile at build time (with a 2° safety margin, so a near-threshold angle is
  rejected instead of flipping on float error). `cutaway_shell`, `lathe(...,
  check=True)`, `sweep(..., check=True)` and `liquid_volume` run it.
- Sample curved bands (`ellipse_head`, `round_corner`, `dish`) by explicit
  interior angles rather than equal steps, so each band's facet angle and each
  ring's crease stay clear of the threshold.
- Cut a window on existing rings (`split_profile` at a profile point) so the cut
  adds no un-creased seam ring.
- Seat a collar ON the surface (`profile_y_at_r` at its inscribed radius) and
  stack drum / lid with `stack_cylinders` (caps touching), never sunk.
- `nozzle_with_flange(..., base_ring=True)` adds a ring on the wall so the
  stub's lines end there; end a shaft exactly on the hub it drives.
- `src/models/mixer-glb.test.ts` audits the exported GLB with the runtime's own
  `EdgesGeometry` extraction and fails on any meridian end that is not on a
  drawn non-meridian edge; copy that audit for new vessels.

## Exporter notes (Blender 5.2.2, verified by introspecting `export_scene.gltf`)

The flags are in `holodeck_bpy.GLTF_EXPORT_FLAGS`. Every flag the build relies
on is set explicitly:

- `export_format='GLB'`
- `export_yup=True`
- `export_apply=True`
- `export_extras=True`
- `export_texcoords=False`
- `export_cameras/lights/animations=False`

How the axes convert: Blender `(x, y, z)` becomes glTF `(x, z, -y)`.

Materials need `use_backface_culling=True`. Without it the exporter writes
`doubleSided: true`.

Builds use `--factory-startup` and start from an empty scene, so the output is
byte-stable. The vitest rebuild check enforces this.
