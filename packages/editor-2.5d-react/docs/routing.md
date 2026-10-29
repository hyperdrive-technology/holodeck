# Auto pipe routing

Pure modules in `src/routing/` (no React, no three). The editor wires them in `src/editor/routing.ts` (`planRoute`, `routeToPlacements`).

## Pipeline

`buildOccupancy(scene, registry, { exclude, margin })` -> `resolveRouteEnd(scene, registry, cell)` -> `routePipe(from, to, occ, opts)` -> `pathToPlacements(cells, existing, nextId)`.

- Draw-pipe: first click resolves to a part port (or bare cell); the hovered cell is routed live (ghost, once per animation frame); the second click commits pipes + elbows as one undo step and keeps chaining from the end cell.
- Reroute (`R`, or the "Reroute" button; edit mode, pipe or elbow selected): finds the connected pipe/elbow run and plans between its two ends with the run excluded from obstacles. The run (`routing/run.ts`) stops at tees and at single-node parts (valve, cap, any 1x1 part) on a joint, so inline valves stay connected; a vessel centred on a joint is an obstacle, not an end. A part drawn on the middle of one long pipe carries `onPipe` (see Inline parts below) and is re-seated on the new route. A successful, nonempty replacement commits as one undo step. A failed plan, invalid resolved port, empty replacement or closed loop keeps the original placements, selection and history, with "Could not reroute — original run kept".
- No route: the ghost turns red; a draw-pipe click can draw the old manhattan L and show "No clear route — drew a straight L". When no replacement geometry is produced, the click changes no scene or history and shows "No route drawn — no replacement geometry"; chaining stays at its previous start. Incomplete occupancy (any `occ.skipped` obstacle) is also a routing failure: `routePipe` returns null, and the editor sets `fallback=true` / `noRoute=true`, including for half-cell clicks. Half-cell clicks with complete occupancy skip the router (not a pipe node) and draw the L without the notice.

## Inline parts on a pipe (`inline.ts`, holodeck#22)

A valve drawn on the middle of one long pipe (as in `tests/scene.json`) is not a run end, and geometry alone cannot tell it from an obstacle dropped across the pipe (which reroute must route around). So such a part records the pipe it sits on: `onPipe: <pipe id>` and `at: <0..1>` from the pipe's `(x, y)` end to its `(toX, toY)` end. The part's own `x, y` stays what is drawn; `at` is informational, geometry wins.

- Set automatically when a single-node part (`isInlinePart`) is placed inside a pipe or dragged (`withAttachment`); cleared when it is dragged off; stripped from dependents when the pipe is deleted (`detachFrom`). Hand-authored scenes add the two fields; scenes without them parse and behave as before. Parse only checks the types (`onPipe` string, `at` in [0, 1]); a dangling id is allowed.
- Drag-start snapshots the entire placement, including `onPipe`/`at`. Undo restores that snapshot even after detaching or switching pipes; a drag out and back restores it without committing a history step.
- `hostPipeOf` honours the attachment only while the part really lies strictly inside that pipe's segment (within 1e-3). A stale `onPipe` (part or pipe moved since) is ignored, never "teleports" the part. A part at a joint (`at` 0 or 1) is a run END (run.ts), not a hosted part.
- Reroute (`rerouteSelected`): hosted parts of the run's pipes are removed from the obstacles, but every retained placement's ID remains reserved for route allocation. `carryHostedParts` allocates positions jointly in their original geometric order, preferring each part's fraction of the old run length (`chainFrom` orders the old pipes start to end; the new pipes are already in travel order). Bodies are 0.6 grid units long with a 0.1-unit margin: centres stay at least 0.7 apart, and 0.4 from straight ends beyond any `ELBOW_RADIUS` trim. Straights too short for that clearance are skipped. A backward pass reserves room for later parts before the forward pass chooses positions. If all parts cannot fit, reroute leaves the scene and history unchanged and shows "No clear route — inline parts do not fit". Rotation changes by the difference between the old and new pipe axes, so yawed extension parts keep their orientation relative to the pipe. `onPipe`/`at` are rewritten for the new pipe. A successful reroute is one undo step.
- Retained branches pin hosted parts in place. Reroute splits the run at those parts and preserves each section's endpoint headings. Any fallback in a run with fixed parts or a section with a required endpoint heading rejects the entire reroute, including previously staged sections, with "Reroute rejected — could not verify retained connections". This conservatively rejects even a potentially safe fallback: the Manhattan L has no heading or obstacle guarantees, and half-cell endpoints skip A* without setting `noRoute`.
- Route flag audit: `fallback` controls acceptance for constrained reroutes. The remaining `noRoute` checks control the drawing ghost colour, new-pipe notice, and unconstrained reroute notice; they intentionally distinguish an unsuccessful A* search from half-cell drawing. `planRoute` defines that distinction and `routeToPlacements` forwards both flags. Unconstrained reroutes keep the same fallback behavior as new-pipe drawing.
- Not done: dragging a pipe does not drag its hosted parts (they detach geometrically); an unattached part on a pipe is still treated as an obstacle by Reroute (follow-on-drag infers riders, see below).
- Why not split the pipe at the valve (valve becomes a joint, `findRun` already handles it)? It rewrites authored scenes (one pipe id becomes two; hosts bind tags and animation to placement ids), needs band/colour copying, and adds a joint to pipe-cutaway / flange rendering. `onPipe` is additive metadata.

## Pipes follow a dragged part (drag-and-drop building)

Dragging (or arrow-nudging) a vessel takes the pipework with it. Modules: `routing/attach.ts` (what a pipe end is attached to), `editor/follow.ts` (what each attached run does), `editor/replan.ts` (the re-route itself, shared with Reroute), `editor/port-snap.ts` (ports snapping onto free pipe ends).

### How it worked before

- Move drag (`editor-state.ts` `drag-start` / `drag-move` / `drag-end`): the selection (and its groups) moved rigidly by the pointer delta (half-cell snap); inline parts re-derived `onPipe` against the moved pipes; the drop pushed one history step. Esc dropped the drag state but left the moved scene uncommitted on screen.
- Pipes stored only coordinates: `x, y` -> `toX, toY`. Ports (`IsoPartDefinition.ports`) were used once, when a pipe was drawn (`resolveRouteEnd` snaps a click to the nearest port and takes its outward heading), and on Reroute; nothing recorded which part an end belonged to.
- A* (`routePipe`) / Reroute (`findRun` + `carryHostedParts`) worked on an explicit selected run. Moving a vessel left every attached pipe where it was: disconnected, through or away from the vessel.

### Attachment model (`placement.attach`)

`attach: { from?: { object, port? }, to?: { object, port? } }` on a pipe (`from` = its `x, y` end, `to` = `toX, toY`). No `port` = the part's centre (a bottom outlet, an inline valve or end cap on the joint). Schema: `$defs/pipeAttach`; parse checks the shape only (dangling ids allowed, like `onPipe`).

- **Geometry wins.** A record counts only while the end lies on that port (along its outward axis, within `PORT_ATTACH_TOLERANCE` = 0.5) or centre; a stale record is ignored, never teleports anything.
- **Inferred when absent**, so older scenes need no migration: an end on a port's outward axis within 0.5 of the port point whose pipe leaves the port outward, or an end exactly on a part's centre. The tolerance absorbs hand-authored ends that stop at the wall surface (brewery kettle r = 0.65: port at 16.5, pipe end at 16.8). Elbows, floor annotations, connectors and run parts are never targets; later placements win ties.
- **Recorded** when a pipe is drawn from / to a port, on the new terminal pipes of a follow re-route, kept by Reroute (records are route-owned: middle segments never inherit them).
- **Copy / paste / duplicate** remap records to the pasted ids; records to parts left behind are dropped (the copy is pasted elsewhere). **Delete** frees the pipe end (geometry kept), like connector anchors.

### What a run does when one of its parts moves (`planFollow`, once per drag)

Every pipe end attached to a moving part belongs to a run (`findRun`). Then:

| case | behaviour |
| --- | --- |
| both run ends move (multi-select), or the far end is a free stub (no other pipe there; at most an end cap / valve nothing else connects to) | **translate** the run, its riders and the stub's fitting by the drag delta |
| one end moves, the other is fixed (a port, a valve on a joint, a tee) | **re-route** between the moved end and the fixed one (`replanRun` with given ends) |
| a run member, or a part riding on it, is itself selected | left alone: the user is moving it |
| any run member or rider on a locked / hidden layer | the move **refuses** with a notice (holodeck#122); Alt still moves the part alone |

Re-route details: port headings kept at both ends (port `dir`, else the old pipe's direction at a joint / tee); off-grid ends (brewery wall ends) are joined to the first grid node along their heading by a straight stub (`entryNode`), so authored offsets survive; riders are carried (`carryHostedParts`): `onPipe` parts plus, for hand-authored scenes, single-node parts and one-cell-wide parts lying along the pipe (`isPipeRider`: the brewery's 2x1 pump); a snapped position is preferred, continuous if only that fits; replacements reuse the run's pipe / elbow ids in run order and keep their own fields (hosts bind tags and flow animation to ids) and keep the run's slot in scene order. A branch teed into the MIDDLE of a run (cellar glycol header, no joint) pins that point: `splitAtMidTees` splits the pipe there first, so only the section between the moved port and the tee re-routes; every placement the split changes (pipes, riders re-attached to a new piece) must be editable, else the move refuses like a locked run. When the new route has fewer segments than the run, the surplus ids disappear: if such a segment carries its own data (`bindings`, `meta`, `extensions`, `animation`) or another placement points at it (connector anchor, `attach`, `onPipe`), that position is unroutable with a notice naming it, never a silent delete (Reroute instead merges all old data onto the first new segment).

### Frames, drop, undo

- `drag-move` recomputes from the scene at drag start (`drag.base`) every frame, so frames never build on each other. While pipes follow, the delta snaps to whole cells (routes live on grid nodes). A frame for the same snapped delta is a no-op; `ProcessEditor` coalesces pointer moves to one dispatch per animation frame.
- Interactive search budget: `FOLLOW_MAX_EXPANSIONS` (30k) per run and frame; more is reported as unroutable. Measured (`follow-brewery.test.ts`): brewhouse kettle frame ~0.4 ms median, 9x brewhouse (369 objects) ~1.3 ms median, a capped failing search ~13 ms.
- **Unroutable position:** the run keeps its old geometry in the preview and the route it would need is drawn as a translucent red tube over a dashed red floor line, with a notice ("No clear route ..." or "Valves / pumps ... do not fit ..."). **Drop there lands on the last position where every pipe could follow** (one undo step, notice). Why not "keep the last route but put the vessel where it was dropped": the pipe would end in mid-air at the old port, i.e. silently disconnected; why not "refuse and snap back": a long drag that ends one cell too far would lose the whole move. With no routable frame at all, nothing moves.
- **One undo step** for the whole move (parts + every re-routed run): the drop pushes `drag.base`.
- Only frames where the pipes followed (not Alt frames) become the drop fallback, so releasing Alt before a blocked drop never lands the detached position under a "followed" notice (#217).
- **Esc** mid-drag restores `drag.base` (nothing committed) and clears the drag's notice. **Alt** (held, or pressed mid-drag) moves the parts alone: pipes stay, explicit records naming the moved parts are dropped, nothing snaps.
- Arrow-key nudge uses the same plan / frame; an unroutable nudge is refused with a notice.

### Palette drag and port snapping

- Drag a part from the palette onto the canvas: pointer events (HTML5 drag and drop would stop the canvas pointer moves, so no live ghost); past 4 px the part is armed and the editor's ghost follows with grid snap; release over the editor's own canvas stamps one part and returns to the select tool with it selected, as one `palette-drop` action (so `onPlaced` fires); release elsewhere (another canvas on the page included) cancels. A plain click still arms click-to-place. Pipes only arm the pipe tool.
- Port snap (`port-snap.ts`): when a moving / placed part's port comes within one cell of a free pipe end whose pipe would leave that port outward (or a moving pipe's free end comes near such a port), the move is pulled so they coincide; inference then attaches the end. Alt disables the snap.

### Not done (follow-ups)

Align / distribute / rotate do not move attached pipes yet; dragging a pipe does not carry its hosted parts (holodeck#31); one-cell sideways offsets cannot be routed (two elbows need two cells, `minBendSpacing`), so they show as unroutable or take a detour; hand-authored off-grid cross-axis ends (cellar glycol at y = 3.2) cannot be re-routed and show as unroutable.

## Geometry conventions

- A placement's `(x, y)` is the CENTRE of its footprint. A part blocks every grid node in the closed box `[x-w/2, x+w/2] x [y-h/2, y+h/2]`: a 2x2 tank is a 3x3 block of nodes, edge nodes included, so a tube never grazes a vessel wall. 90/270 degree `rotation` swaps w and h.
- `area` and `label` never block. Pipes block every node of their run, ends included; elbows, valves and end caps block their node.
- Installed parts use `def.draw === 'run'` to select run geometry; endpoint fields alone never turn a vessel into a run. Missing parts infer runs from numeric `toX`/`toY`, otherwise they use a 1x1 footprint. Parsing, edit validation, occupancy and camera framing share this classification. `Occupancy.skipped` is optional for custom providers; `buildOccupancy` always populates it.
- Ports (`IsoPartDefinition.ports`) are part-local offsets from the centre plus an outward `dir`; both rotate with the placement. Compass: n = -y, e = +x, s = +y, w = -x. The built-in `tank` and `mixer` have `east` / `west` ports at floor level on the vessel edge; the east one sits in the window, so routing only uses west (see Vessel cutouts).
- Bounds: placement coordinates are limited to +-`MAX_GRID_COORD` (16384). Footprint nodes may extend beyond that to +-`MAX_CELL_COORD` (32767, the symmetric safe range of `cellKey`), so a normal tank centered at either scene boundary retains all nine blocked nodes. Clearance rings and router search boxes are clipped to the safe key range. The shared `validateSceneFile` helper in `iso/scene.ts`, used by the parser and editor, rejects non-finite or out-of-range `x`/`y`/`toX`/`toY`/`width`/`height`/`size`, requires finite rotation and screen-space offsets, and checks each obstacle's effective footprint after legacy migration, including `footprintOf` params and rotation, against the same node-range and area limits as occupancy. `area` and `label` remain non-obstacles. `footprintCells` / `runCells` throw `GeometryRangeError` rather than enumerate invalid geometry or over-`MAX_FOOTPRINT_CELLS` (65536 nodes) boxes. Changed definitions or invalid host-provided initial scenes can still fail these checks; `buildOccupancy` reports those placements in `occ.skipped`, and routing never reports a clear path through incomplete occupancy (holodeck#8, PR#19).
- Editor policy: **reject invalid geometry with an inline `Edit rejected: ...` notice**. Every scene-changing reducer action passes through the shared validator: place, pipe drawing, drag (including half-cell moves and translated run endpoints), resize, rotate, parameter edits, host patches, load, undo and redo. Rejection preserves the last valid scene, selection, revision and history. Drag/resize previews are validated too; release commits only the last accepted value and retains the rejection notice. Resize controls still snap/clamp to their param spec first; geometry limits then reject that proposed value instead of silently clamping it to a scene boundary.
- `RouteEnd.heading` is the port's OUTWARD direction: the first step leaves that way; at the end the last step arrives moving the opposite way.
- At an inline reroute endpoint without a declared port (including built-in valves and caps), `findRun` carries `startHeading` / `endHeading` from the terminal pipe: the direction from the joint towards that pipe's other end. This preserves the connected flange side on either end of the route, including rotated parts and reversed pipe coordinates. The existing connection is used rather than inferring a barrel axis from rotation: single-cell extension parts have no common local axis, and an axis alone cannot identify which side of the part was connected. Declared port headings take precedence. Diagonal or zero-length pipes supply no heading; rerouting preserves valid axis-aligned connections rather than repairing invalid attachments.

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
