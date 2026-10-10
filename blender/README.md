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
npx vitest run src/iso/parts-render.test.ts   # headless: tests/snapshots/parts.png
```

The render test fails on any `applyHolodeckStyle` warning, for example a
material outside `hd.*`. Note that GLTFLoader removes `.` from node names
(`port.in` arrives as `portin`). The original name is kept in `userData.name`;
`findPorts` and `findAnimNodes` read it.

## Adding a part

1. Create `parts/<part>.py`. Copy the header of `parts/valve.py`, which adds the
   `sys.path` entry and imports `holodeck_bpy as hd`, then define `build()` and
   end with `hd.run_part(build, "<part>")`.
2. Build it with `hd.cylinder` / `hd.uv_sphere` / `hd.torus` / `hd.empty`. Every
   position and rotation is in **three.js space** (Y-up, R3F Euler `XYZ`), and the
   segment parametrisation matches three's geometries. You can port R3F code
   one-to-one, and facets line up with hand-coded parts.
3. Run `pnpm run parts:build <part>`. Add `src/models/<part>-glb.test.ts`,
   modelled on `valve-glb.test.ts`.

## Contract

- Output is `assets/models/<part>.glb`, glTF Y-up, 1 unit = 1 three.js unit.
  The origin is the placement anchor (for an inline valve, the centre of the
  pipe axis through the body).
- Materials are matched **by name only**: `hd.white`, `hd.shaded`, `hd.vessel`,
  `hd.flask`, `hd.accent`. Only `hd.accent`'s base colour is read (it is the
  default accent, e.g. handwheel `#c0392b`). `hd.material()` rejects any other name.
- Optional node extras come from object custom properties, set with
  `hd.set_props(obj, ...)`: `hd_edge_threshold` (float, degrees) and
  `hd_edges` (`False` disables outlines).
- Empties:
  - `port.<name>` marks a pipe connection point (`hd.add_port`).
  - `anim.<name>` is the pivot of an animated sub-assembly (`hd.add_anim`). Its
    meshes are children positioned relative to it.
- Geometry is low-poly and flat-shaded, with explicit segment counts. Don't use
  subdivision, textures or UVs. Cameras and lights are rejected on export.
  Modifiers are applied on export.

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
