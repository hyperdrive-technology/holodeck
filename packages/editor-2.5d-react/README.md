# @holodeck/editor-2.5d-react

Orthographic 2.5D process editor and viewer (React Three Fiber + WebGPU) for live,
animated process scenes in the Arcentry look. Parts come from a contribution registry
(built-ins plus Blender-built GLBs in `assets/models/`); the look comes from one style
layer (`assets/process/style.ts`).

```tsx
import { ProcessEditor } from '@holodeck/editor-2.5d-react';

<ProcessEditor scene={scene} onChange={setScene} mode="edit" onRendered={(rev) => {}} />;
```

Give the editor a box with a definite size; it fills it, never grows past it, and fits
the scene to it on load.

## Rendered signal

`ProcessEditor` (on `[data-testid="process-editor"]`) and `IsoCanvas` (on its container)
expose:

| attribute | meaning |
|---|---|
| `data-holodeck-revision` | current revision; increases on any change to the picture |
| `data-holodeck-rendered` | last revision a presented frame showed |
| `data-render-state` | `ready` when the two match, else `pending`; `unsupported` without WebGPU |

A revision counts as rendered only when every GLB part has loaded, no camera animation is
running, the editor has fitted the scene, and two settled frames have passed. Tests and
screenshot loops wait on `data-render-state="ready"`, never on a timeout
(`src/test-support/render-harness.ts` has `waitForRendered`). `onRendered(revision)` fires
at the same moment.

## Tests

```bash
pnpm type-check
pnpm exec vitest run      # unit + *-render browser tests (render tests need a local WebGPU Chromium; CI skips them)
pnpm build && pnpm smoke
```

Browser tests write review output to `artifacts/` (gitignored), not to the tracked tree.

## Arcentry fidelity loop (agents)

`src/iso/scene-render.test.ts` renders `tests/scene.json` with a fixed setup (760x540
viewport, DPR 1, `REFERENCE_ZOOM` and the frozen look-at, frozen metrics), waits for the
rendered signal, and measures the render against the Arcentry target
`tests/snapshots/reference-canvas.png` (the process pane of `reference.jpg`; regenerate
it with `pnpm visual:reference` only if `reference.jpg` changes). Five consecutive runs
on macOS produced byte-identical renders, so every score change is a real change.

**Score.** `fidelity` = share of the relevant pixels that pixelmatch (threshold 0.1,
anti-aliasing ignored) calls equal, where relevant = drawn in either image (darker than the
floor grid's `#EEE`) or different. Arcentry's toolbar, baked into the reference, is
ignored. `rmse` (0..255) is reported too: it moves on shading changes too small to cross
the pixelmatch threshold. Current record (darwin): **fidelity 0.283, rmse 25.34**.

**Gate.** `tests/visual/reference-fidelity.json` holds the best score per platform. A run
fails when fidelity drops more than `epsilon` (0.0005) below it. The record only goes up:
`pnpm visual:record` raises it when a run beats it and never lowers it. Lowering it (a
deliberate trade-off) is a hand edit of the JSON with the reason in the PR.

**Loop.**

1. `pnpm visual` (about 5 s).
2. Read `artifacts/visual/reference-metrics.json`: `verdict`, `metrics.fidelity`,
   `metrics.rmse`, `darkerPixels` (extra ink: lines too thick, shading too dark) vs
   `lighterPixels` (missing ink), and `metrics.worstCells` (the 4x3 grid cells with the
   most difference, with pixel rectangles).
3. Look at the images in `artifacts/visual/`: `reference-heatmap.png` (colour distance,
   blue to yellow to red), `reference-diff.png` (red = missing ink, blue = extra ink),
   `reference-overlay.png` (50/50 blend, shows misalignment), and `reference-render.png`
   next to `tests/snapshots/reference.jpg`.
4. Change one thing: a style token in `assets/process/style.ts`, a part's geometry or
   Blender script, lights in `IsoCanvas.tsx`. Use `pnpm tuner` for interactive tank
   tuning against the reference.
5. Re-run. Keep the change if `fidelity` rises (or holds while `rmse` falls); otherwise
   revert it. A misaligned overlay means a placement or camera problem, not a style one:
   fix that first, because it swamps everything else.
6. When `verdict` is `improved`, run `pnpm visual:record` and commit the JSON with the
   change. The PR states the before/after score and attaches the heatmap.

Set `HOLODECK_ARTIFACTS_DIR` to keep runs apart (e.g. one directory per iteration).
Scores are per platform because GPU paths and font rasterisation differ; a platform with
no record reports `unrecorded` and passes until someone records it.
