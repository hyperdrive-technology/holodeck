# Auto pipe routing

Pure modules in `src/routing/` (no React, no three). The editor wires them in `src/editor/routing.ts` (`planRoute`, `routeToPlacements`).

## Pipeline

`buildOccupancy(scene, registry, { exclude, margin })` -> `resolveRouteEnd(scene, registry, cell)` -> `routePipe(from, to, occ, opts)` -> `pathToPlacements(cells, existing, nextId)`.

- Draw-pipe: first click resolves to a part port (or bare cell); the hovered cell is routed live (ghost, once per animation frame); the second click commits pipes + elbows as one undo step and keeps chaining from the end cell.
- Reroute (`R`, or the "Reroute" button; edit mode, pipe or elbow selected): finds the connected pipe/elbow run and plans between its two ends with the run excluded from obstacles. A successful, nonempty replacement commits as one undo step. A failed plan, invalid resolved port, empty replacement or closed loop keeps the original placements, selection and history, with "Could not reroute — original run kept".
- No route: the ghost turns red; a draw-pipe click can draw the old manhattan L and show "No clear route — drew a straight L". When no replacement geometry is produced, the click changes no scene or history and shows "No route drawn — no replacement geometry"; chaining stays at its previous start. Incomplete occupancy (any `occ.skipped` obstacle) is also a routing failure: `routePipe` returns null, and the editor sets `fallback=true` / `noRoute=true`, including for half-cell clicks. Half-cell clicks with complete occupancy skip the router (not a pipe node) and draw the L without the notice.

## Geometry conventions

- A placement's `(x, y)` is the CENTRE of its footprint. A part blocks every grid node in the closed box `[x-w/2, x+w/2] x [y-h/2, y+h/2]`: a 2x2 tank is a 3x3 block of nodes, edge nodes included, so a tube never grazes a vessel wall. 90/270 degree `rotation` swaps w and h.
- `area` and `label` never block. Pipes block every node of their run, ends included; elbows, valves and end caps block their node.
- Installed parts use `def.draw === 'run'` to select run geometry; endpoint fields alone never turn a vessel into a run. Missing parts infer runs from numeric `toX`/`toY`, otherwise they use a 1x1 footprint. Parsing, edit validation, occupancy and camera framing share this classification. `Occupancy.skipped` is optional for custom providers; `buildOccupancy` always populates it.
- Ports (`IsoPartDefinition.ports`) are part-local offsets from the centre plus an outward `dir`; both rotate with the placement. Compass: n = -y, e = +x, s = +y, w = -x. The built-in `tank` and `mixer` have `east` / `west` ports at floor level on the vessel edge; the east one sits in the window, so routing only uses west (see Vessel cutouts).
- Bounds: placement coordinates are limited to +-`MAX_GRID_COORD` (16384). Footprint nodes may extend beyond that to +-`MAX_CELL_COORD` (32767, the symmetric safe range of `cellKey`), so a normal tank centered at either scene boundary retains all nine blocked nodes. Clearance rings and router search boxes are clipped to the safe key range. The shared `validateSceneFile` helper in `iso/scene.ts`, used by the parser and editor, rejects non-finite or out-of-range `x`/`y`/`toX`/`toY`/`width`/`height`/`size`, requires finite rotation and screen-space offsets, and checks each obstacle's effective footprint after legacy migration, including `footprintOf` params and rotation, against the same node-range and area limits as occupancy. `area` and `label` remain non-obstacles. `footprintCells` / `runCells` throw `GeometryRangeError` rather than enumerate invalid geometry or over-`MAX_FOOTPRINT_CELLS` (65536 nodes) boxes. Changed definitions or invalid host-provided initial scenes can still fail these checks; `buildOccupancy` reports those placements in `occ.skipped`, and routing never reports a clear path through incomplete occupancy (holodeck#8, PR#19).
- Editor policy: **reject invalid geometry with an inline `Edit rejected: ...` notice**. Every scene-changing reducer action passes through the shared validator: place, pipe drawing, drag (including half-cell moves and translated run endpoints), resize, rotate, parameter edits, host patches, load, undo and redo. Rejection preserves the last valid scene, selection, revision and history. Drag/resize previews are validated too; release commits only the last accepted value and retains the rejection notice. Resize controls still snap/clamp to their param spec first; geometry limits then reject that proposed value instead of silently clamping it to a scene boundary.
- `RouteEnd.heading` is the port's OUTWARD direction: the first step leaves that way; at the end the last step arrives moving the opposite way.

## Elbows (`elbows.ts`)

An elbow's `rotation` is a true yaw about world +Y (like every other part). Its two arms (the directions its pipes leave the elbow cell in):

| rotation | arms |
| --- | --- |
| 0 | n + w |
| +pi/2 | s + w |
| pi | s + e |
| -pi/2 | n + e |

`elbowRotationForArms(a, b)` / `elbowArms(rotation)` convert; `collapsePath` uses them for routed bends. Both renderers pose the torus the same way (Elbow.tsx: yawed group around a flat mesh; InstancedElbows: `elbowInstancePose`, Euler order `YXZ`). The pooled elbows used order `XYZ`, which applied the yaw before laying the torus flat: +-pi/2 bends stood on end and pi bends were mirrored out of the corner.

Hand-authored scenes need not type rotations: `"params": {"bend": "auto"}` on an elbow takes the rotation from the two pipe ENDS on its cell (`inferElbowRotation`; resolved once in `SceneGraph` by `resolveAutoElbows`). A cell that is not a clean L (no / one pipe, straight joint, tee, diagonal pipe) leaves the elbow without a rotation, so it draws as a knuckle, and `checkElbows(objects)` reports it. Elbows with a numeric `rotation` and `bend` absent or `"manual"` are unchanged; no rotation and not auto is still the knuckle collar. `checkElbows` also flags numeric rotations that disagree with their pipes.

## Vessel cutouts (`vessel-ports.ts`, `iso/pipe-runs.ts`)

Vessels show their liquid through a cut-away window. Pipes may connect through it, but then the pipe is cut away too: it stops at the wall surface and its end is an open cut section (tube-wall ring + bore, `PipeEndStyle` `cut` in `pipe-geometry.ts`) instead of a flange. Wall angle theta follows Tank's CylinderGeometry: `(x, z) = (sin theta, cos theta)`, so on the grid s = 0, e = 90, n = 180, w = 270 degrees; placement yaw adds to theta. The window is `[windowYaw - windowDeg/2, windowYaw + windowDeg/2]`, read from the placement's resolved `windowYaw` (or `windowYawDeg`) and `windowDeg` params, else from `IsoPartDefinition.cutout`. The default tank window (45, 91) is `[-0.5, 90.5]`: the e and s sides are open, n and w are solid. The window only spans the straight wall; `IsoPartDefinition.wallSpan` (brewery vessels: `tankWallSpan(tankLayout(...))`) gives its world Y range so floor-level pipes under a vessel on legs are not treated as window entries.

`clipPipeEnd(end, other, vesselWall, { pipeRadius, pipeY })` classifies one pipe end within R + rp of a vessel centre:

| contact | when | drawn |
| --- | --- | --- |
| `window` | the pipe band theta +- asin(rp/R) overlaps the window and the pipe overlaps the wall height | end moved to t = a0 + sqrt(R^2 - max(0, b - rp)^2) along the pipe (trim, or extension if authored short of the wall), `cut` end |
| `wall` | solid wall at the wall height | unchanged |
| `under` | below a raised wall, near the rim | trimmed back to the rim if inside, flanged |
| `outlet` | below a raised wall, deeper than R - rp (cone / bottom branch) | unchanged |

(a0 = axial position of the vessel centre's foot on the pipe axis, b = its lateral distance.) `resolvePipeClips(objects, registry)` runs it for every pipe; `resolvePipeRuns` (`iso/pipe-runs.ts`) combines it with elbow trimming into one `PipeRunSpec` per pipe, computed once in `SceneGraph` and read by both `InstancedPipes` and the unique-mesh `PipePart`; valves, caps and elbows centred inside a cut-away vessel are not drawn. Route snapping uses every declared port (window ports included). `findWindowConnections(scene, registry)` lists the window entries (informational). The brewery scenes are pinned by `hyperdrive-ui/app/hmi/iso/brewery-piping.test.ts`; `src/editor/pipe-cutaway-render.test.ts` renders close-ups.

## Cost model (A* over `(cell, heading, run)`)

| Term | Default | Knob |
| --- | --- | --- |
| step | 1 | |
| bend | 4 | `bendPenalty` |
| node in a vessel's clearance ring | 2 | `clearancePenalty`; ring width is `buildOccupancy({ margin })` (default 1, cost only) |
| blocked node (parts, pipes, elbows...) | impassable, except the exact start/end cells (join a pipe end, enter a port) | |
| straight cells between two bends | 2 | `minBendSpacing` |
| search box | bbox(from, to, obstacles) + 6 | `margin` |

`minBendSpacing` is computed, not hard-coded: each bend trims `ELBOW_RADIUS` (0.58) off its neighbouring run (`trimRun`), so a run between two bends needs more than `2 * 0.58 = 1.16` cells, i.e. 2 on the integer grid (`defaultMinBendSpacing`). Closer bends would leave a run untrimmed. The first and last runs are not constrained.

Heuristic is Manhattan distance. Ties break on `(f, h, insertion order)` with neighbours expanded n, e, s, w, so equal input gives identical output. `maxExpansions` (200k) is a safety valve; an empty 200x200 grid with a far target expands under 5k nodes in a few milliseconds (pinned in `astar.test.ts`).

A path that would re-enter one of its own cells (only possible in tight heading-constrained spots) is rejected as "no route".

## Why hand-written

React Flow ships no obstacle-avoiding router; react-flow-smart-edge wraps pathfinding.js (unmaintained since about 2016); libavoid-js is LGPL WASM aimed at free-form diagrams. The grid is native and we need domain costs generic libraries do not expose.
