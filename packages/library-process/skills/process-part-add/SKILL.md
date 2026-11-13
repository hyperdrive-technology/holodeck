---
name: process-part-add
description: Add one new industrial process part (valve, pump, instrument, vessel accessory, electrical box, ...) to @holodeck/library-process in the same low-poly style as the existing 28 parts. Covers the Blender script, the GLB, the models.json and parts.json entries, the catalogue row and Studio registration. Use when asked to add, model, extend or fix a process part; not for cloud archetypes (library-cloud) or procedural parts (pipes, tanks).
---

# Add a process part

A process part is a Blender Python script that builds a GLB, plus two data
entries that describe it. Blender owns the **shape** only. White fill, iso
shading and outlines come from the runtime style layer, by material name.
Nothing here knows about PLCs; a host binds signals to the part's params.

Paths below are relative to the holodeck repo root. Run package commands from
`packages/library-process` with Node 26.13.0 and pnpm 12.16.1 (build the
sibling `holodeck-sdk/ts` first, then `pnpm install --frozen-lockfile`).

## 0. Read first (five minutes, always)

1. `docs/assets/process-catalog.md`: the catalogue row for your part (its
   params and family) and **Authoring rules for process GLBs** (binding).
2. `blender/parts/process/_common.py`: the vocabulary you build with.
3. The two or three existing parts closest to yours (see
   [references/style-guide.md](references/style-guide.md) for which). Match
   their radii, flanges, weight and docstring. A new valve must look like a
   sibling of `valve-ball`, not a new design.
4. `blender/README.md`: the part contract (three.js space, material names,
   `port.*` / `anim.*` empties).

## 1. Decide the kind

| Kind | Origin | Ports | Envelope |
| --- | --- | --- | --- |
| `inline` | on the pipe axis at the body centre (local Y=0; the runtime lifts it to world Y=0.32) | `port.in` at -X, `port.out` at +X on the flange faces | length a multiple of 0.5; `y_min` is the **negative** body radius (about -0.30 for a valve) |
| `floor` | on the floor at the footprint centre, resting on Y=0 | nozzles at Y=0.32 where it meets floor-level pipe runs | whole-cell footprint |
| `mounted` | at the connection or mounting point (Y=0) | `port.process` at the origin, or none | `y_min` below 0 only if it hangs through its mounting face (a radar horn) |

Scene scale (never use `scale` to fix it): 1 unit = 1 grid cell, pipe radius
0.2, pipe axis Y=0.32, flange radius 0.27 (`_common.PIPE_R`, `PIPE_Y`,
`FLANGE_R`).

## 2. Write the script

Copy [part-template.py](part-template.py) to `blender/parts/process/<slug>.py`
(slug is lower-case, hyphenated, family first: `valve-`, `pump-`, `heat-`...).
It is a working inline valve; replace the geometry. Rules:

- Docstring first: what it is and which state it is modelled in (open or
  closed), layout sketch, origin, overall size, ports with positions, anim
  nodes with pivot/axis/range, state colour. Future agents read this to
  write `models.json`.
- Build only with `_common` helpers (`box`, `cylinder`, `x_/y_/z_cylinder`,
  `lathe`, `nozzle`, `flange`, `plinth`, `feet`, `saddle`, `mesh`, `edges`,
  `materials`). Do not edit `_common.py` or `holodeck_bpy.py` in a part PR;
  if two parts need a new helper, put it in a `_<name>.py` module imported
  like `_common` (see `_batch_a.py`) and propose moving it later.
- Materials only from `c.materials()` (`hd.white`, `hd.shaded`, `hd.accent`).
  `hd.accent` goes on the **one** piece that carries state (lever, bezel,
  motor band, lens). It is recoloured at runtime.
- Ports: `c.nozzle(name, base, face, mat)` makes stub + flange + the
  `port.<name>` empty on the outward face. Name by function (`in`, `out`,
  `suction`, `discharge`, `drain`, `vent`, `branch`).
- Animation: `hd.add_anim("<name>", pivot)` on the real axis of motion;
  moving meshes are its children (positions relative to the pivot). Model
  the part in the state that makes the motion obvious to test.
- Look: strong silhouette, few large forms, no fine detail. 12 sides for
  main bodies, `c.SMALL_SEG` (8) for small pieces, `c.edges(obj, threshold,
  enabled=False)` to suppress outline noise on thin or many-sided pieces.
- End `build()` with `c.check(kind=..., footprint=..., height=..., y_min=...,
  length=..., ports={name: pos}, anim={name: pivot})`. **Never loosen a check
  to make a part pass; fix the part.** `check` enforces the envelope, port
  and anim positions, hd.* materials, no modifiers, and < 3 000 triangles.
- Keep a GLB under 60 KB; most parts are under 1 000 triangles.

## 3. Build, look, iterate

From `packages/library-process`:

```sh
pnpm parts:build <slug>      # script -> assets/models/<slug>.glb
pnpm parts:preview           # also renders /tmp/process-previews/<slug>.png
```

(Both need the slug in `src/parts.json`; for a first build use Blender
directly, see [process-part-verify](../process-part-verify/SKILL.md).)
Look at every preview and iterate; plan on at least two rounds. Then follow
the **process-part-verify** skill before declaring the part done.

## 4. Register the part (all of these, in one PR)

1. `src/models.json`: add `<slug>` (mirror the script's final `c.check`: kind,
   footprint, height, `yMin`, length, each port's `at` and `facing`
   (`+x`...`-z`; `mouth: "rect"` for duct faces; `radius` when the bore is not 0.2), each
   `anim` pivot, `accent: true` if it uses `hd.accent`). Order matches
   `parts.json`.
2. `src/parts.json`: id `process:<slug>`, `label`, `category` (a catalogue
   family; each family is one contiguous run, families in catalogue order),
   `hint` (distinct from every other part's), whole-cell `footprint`,
   `params`, `model: "models/<slug>.glb"`, `animNodes`, and as needed
   `alarmParam`, `stateColors`, `heightParam`. Inline parts also set
   `origin: "pipe-axis"`, `inlineLength` and coincident `in` / `out` ports at
   0,0 (`w` / `e`). Copy the closest existing entry; see
   [references/style-guide.md](references/style-guide.md) for the param and
   animator conventions.
3. `docs/assets/process-catalog.md`: set the row's status to
   ``have (`library-process`)`` and update the "what exists today" counts. A
   test keeps the doc and `parts.json` in step.
4. `packages/library-process/README.md`: add the row to the part table.
5. `apps/studio/src/host/process-package.ts`: import the GLB with `?url` and
   add it to the asset map (`process-package.test.ts` fails if missing).
6. Slug lists in tests: `src/holodeck-package.test.ts`,
   `apps/studio/src/host/library.test.ts` and
   `apps/studio/e2e/process-sample.webgpu.spec.ts`; add the part to
   `apps/studio/samples/process-line.holodeck.json` if it belongs in the
   sample line.
7. A part-specific animation or state-colour test in `src/process-glb.test.ts`
   when it has an anim node (copy a neighbour: it asserts the end positions).

## 5. Check and ship

```sh
pnpm type-check
pnpm exec vitest run                      # from packages/library-process
pnpm --dir ../../apps/studio exec vitest run src/host    # Studio registration tests
```

With Blender installed the tests also rebuild every script and compare it
with the shipped GLB, so commit the GLB you built with the same Blender
(5.2.2). New GLBs and a changed `models.json` / `parts.json` are a normal
minor PR; a change to `_common.py`, `holodeck_bpy.py` or the editor's
animator contract is a **major** one (it can move every shipped GLB).

## Gotchas learned the hard way

- An inline `y_min` of 0 fails: the body hangs below the axis. Use about -0.30.
- `_common.cylinder` rejects diagonal axes on purpose, so ports stay on
  axis-aligned faces. Build diagonal pieces with `c.lathe(...)` plus a
  rotation or with `c.mesh`; keep every **port** on an axis-aligned face.
- Rotation `Z=+pi/2` points local +Y toward **-X**; use `c.AXIS_ROTATION`.
- GLTFLoader strips `.` from node names (`port.in` becomes `portin`); read
  `userData.name`. Tests already do.
- Grid ports are declared only where a pipe from a grid node really meets the
  GLB nozzle and faces it (`parts.test.ts` checks). Nozzles off the grid
  (x = -1.10 on a 3-cell part) mean no grid port yet; prefer grid-aligned
  nozzles when you design a part.
- Output is byte-stable only from `--factory-startup` with an empty scene
  (the build script does this). Never randomise, never read the clock.
