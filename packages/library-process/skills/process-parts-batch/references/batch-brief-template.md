# Brief: process parts, <wave / batch name> (Blender first pass)

Fill in the angle-bracket parts and send this to the generator. It is the brief
that produced the 28 shipped parts, made generic.

---

You are generating one batch of Holodeck's industrial process library. Your
work is Blender Python part scripts and the GLBs they build. Nothing else.
Make only the parts in the table below.

## Where you work

- Worktree (already created, branch `<branch>`): `<absolute path>`. Work only
  inside it. Do not create worktrees or branches.
- Do **not** run `git add`, `git commit`, `git push`, `git stash`,
  `git checkout` or `git clean`. Leave files in the working tree; the
  integrator commits them.
- Touch only your own files: `blender/parts/process/<slug>.py`,
  `packages/library-process/assets/models/<slug>.glb` and
  `<preview dir>/<slug>*.png`. Files you did not create are not yours to edit,
  move or delete.
- **Do not edit** `blender/parts/process/_common.py` or `blender/holodeck_bpy.py`.
  If two or more of your parts share geometry `_common.py` lacks, put it in one
  batch-private module `blender/parts/process/_<name>.py` imported like
  `_common`. List in your report what should move into `_common.py` later.
- Do not start subagents. Do not edit TypeScript, JSON, workflows or docs.

## Read first

1. `docs/assets/process-catalog.md`, section **Authoring rules for process
   GLBs**. Binding.
2. `blender/README.md`: the part contract.
3. `blender/parts/process/_common.py`: your vocabulary.
4. `packages/library-process/skills/process-part-add/SKILL.md` and its
   `references/style-guide.md`, then these shipped parts, whose look, weight,
   docstring style and file shape you must match: `<closest siblings>`.
5. `packages/editor-2.5d-react/assets/process/pipe-math.ts`,
   `valve-geometry.ts`, `style.ts`, `apply-style.ts`: real pipe and flange
   dimensions, and how outlines come from facet creases.

## Rules that apply to every part

- Header docstring like the shipped parts: what it is and the state it is
  modelled in, layout sketch, origin, overall size, ports (positions and
  facing), anim nodes (pivot, axis, range), state colour. End with
  `hd.run_part(build, "<slug>")`.
- Each `build()` ends with `c.check(...)` declaring kind, footprint, height,
  `y_min`, ports (with positions) and anim nodes (with positions). **Never
  loosen a check to make a part pass; fix the part.**
- Kinds: **inline** = origin on the pipe axis, axis along X, `port.in` at -X and
  `port.out` at +X, length a multiple of 0.5, `y_min` the negative body
  radius. **floor** = origin on the floor at the footprint centre, whole-cell
  footprint, pipe connections at Y = 0.32 unless the table says otherwise.
  **mounted** = origin at the mounting point (Y = 0).
- Materials only from `c.materials()`; `hd.accent` only on the piece named in
  the table.
- Moving geometry is parented to its `anim.<name>` empty, pivot on the real
  axis of motion, with real clearance around it.
- Read clearly at small size in isometric view from above: strong silhouette,
  few large forms, no fine detail. Suppress outline noise on thin or
  many-sided pieces with `c.edges(...)`.
- Each GLB under 60 KB and 3 000 triangles; most under 1 000.

## Batch table

| Slug | Kind | What it is | Ports | Anim nodes | `hd.accent` |
| --- | --- | --- | --- | --- | --- |
| `<slug>` | <inline length N / floor W x D / mounted ~W x H> | <one sentence of shape, plus the dimensions that matter> | <name (position, facing)> | <name: motion about which axis, range; children> | <piece> |

## Build and check

For each part, from the worktree root:

```sh
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
mkdir -p packages/library-process/assets/models <preview dir>
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  --python blender/parts/process/<slug>.py -- \
  --out packages/library-process/assets/models/<slug>.glb \
  --preview <preview dir>/<slug>.png
```

- **Look at every preview** and iterate until the part reads as what it is. It
  is Workbench shading, not the final outline style: judge silhouette,
  proportion and scale. At least two rounds per part. Check a 160 px downscale
  (`sips -Z 160 <png> --out <slug>-small.png`).
- Compare with the shipped previews so the family looks like one hand drew it.
- Build each part twice and confirm the GLBs are byte-identical (`cmp`).
- Sample each anim node at both ends of its range; moving meshes must not pass
  through fixed geometry.
- If Blender crashes, retry once without `--preview`. If it still crashes,
  keep writing scripts, stop building and say so.

## Limits

<Add your own usage-limit gate here, for example a command the generator runs
before each part and what to do when it fails. Prefer finishing and verifying a
few parts over starting all of them.>

## Report

End with one table: slug, GLB size, triangle count, bounding box (three.js
space), ports with positions, anim nodes with pivot, axis and range, suggested
footprint, suggested bindable params and which anim node or material each
drives. Then list what is weak or unfinished in each part, any helper that
belongs in `_common.py`, and anything in the contract that got in your way.
State plainly which builds and checks ran and which did not.
