---
name: process-part-verify
description: Verify a new or changed @holodeck/library-process part before it is called done - first Blender build, preview review at small size, byte-stable rebuild, anim end-position sampling, contact sheet, tests, and a look at it in Studio's real outline style. Use after writing or editing a process part script, and when reviewing someone else's part PR.
---

# Verify a process part

"It built" is not "it is right". The Blender preview is Workbench shading, not
the runtime look, so a part is verified in layers, cheapest first. Report what
you ran and what you did not.

Paths are relative to the holodeck repo root. `$BLENDER` defaults to
`/Applications/Blender.app/Contents/MacOS/Blender` (tested with 5.2.2).

## 1. First build (script only, before the part is registered)

```sh
mkdir -p /tmp/process-shots
"$BLENDER" -b --factory-startup --python-exit-code 1 \
  --python blender/parts/process/<slug>.py -- \
  --out packages/library-process/assets/models/<slug>.glb \
  --preview /tmp/process-shots/<slug>.png
```

`c.check(...)` runs inside the build and fails on a wrong envelope, port or
anim position, material, modifier or triangle count. Read its error; fix the
**part**, never the check. If Blender crashes (Metal has done this inside
sandboxes), retry once without `--preview`; if it still crashes, stop and say
so rather than shipping an unbuilt GLB.

## 2. Look at it (always, at two sizes)

1. Open the preview. Does it read as what it is? Silhouette, proportion and
   scale beside a sibling part (`valve-ball`, `motor`, ...) matter more than
   detail.
2. Downscale and look again: `sips -Z 160 <slug>.png --out <slug>-small.png`.
   Anything you cannot see at 160 px is noise at runtime.
3. Put it next to its neighbours:
   `montage /tmp/process-shots/{valve-ball,<slug>,motor}.png -tile 3x1 -geometry +4+4 sheet.png`.
4. Plan at least **two rounds**; the first pass is rarely right. Note what you
   changed between rounds in the part's script comments only when it explains a
   non-obvious shape.

## 3. Determinism

Build twice to different paths and `cmp` them: they must be byte-identical.
A difference means randomness, the clock, or a non-empty scene.

## 4. Motion

For each `anim.<name>`: sample both ends of its range (pivot rotated or moved
by the param's full range, per the animator settings in `parts.json`) and
confirm moving meshes do not pass through fixed geometry and stay inside the
envelope. `src/process-glb.test.ts` drives every node with the real animator
and checks the envelope; add a part-specific case there (copy a neighbour) that
asserts the end positions.

## 5. Contract and tests

After registering the part ([process-part-add](../process-part-add/SKILL.md) step 4):

```sh
cd packages/library-process
pnpm type-check
pnpm exec vitest run          # contracts, budgets, rebuild-vs-shipped when Blender is present
pnpm build && pnpm smoke      # package entry and manifest
pnpm --dir ../../apps/studio exec vitest run src/host
```

Budgets: < 60 KB and < 3 000 triangles per GLB. If the rebuild comparison
fails on a GLB you did not touch, you have a different Blender version: use
5.2.2.

## 6. See it in the real style

The outline look (runtime style layer) is the only look that counts. From
`apps/studio`:

```sh
pnpm dev                       # then place the part from "Process parts" in the palette
```

or load `apps/studio/samples/process-line.holodeck.json`, which places every
part. Check: outlines at creases without clutter, `hd.accent` takes the state
colour (toggle the part's `fault` / `running` params), moving nodes move the
right way, an inline part snaps to a drawn pipe, a mounted part sits at the
right `mountHeight`. The WebGPU e2e (`pnpm --dir apps/studio e2e`, needs
Chromium) renders the sample with every part; run it once per PR on the final
head, and say so if you could not.

## 7. Report

One table per part: slug, GLB size, triangles, bounds, ports, anim nodes
(pivot, axis, range), accent piece. Then **weak points** you can see, and
exactly which of steps 1 to 6 ran. An unchecked step is stated as unchecked.

## Reviewing someone else's part

Check in this order: (1) `c.check` untouched and strict; (2) previews at both
sizes beside a sibling; (3) `models.json` equals the script's final check
(positions, facing, accent); (4) `parts.json` params and animator settings
agree with the script's docstring (axis, range, modelled state); (5) catalogue
row and README table updated; (6) Studio registration and slug lists; (7) GLB
committed from Blender 5.2.2, not hand-edited. File each P2/P3 as an issue.
