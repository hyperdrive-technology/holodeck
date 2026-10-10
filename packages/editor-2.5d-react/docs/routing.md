# Auto pipe routing

Pure modules in `src/routing/` (no React, no three). The editor wires them in `src/editor/routing.ts` (`planRoute`, `routeToPlacements`).

## Pipeline

`buildOccupancy(scene, registry, { exclude, margin })` -> `resolveRouteEnd(scene, registry, cell)` -> `routePipe(from, to, occ, opts)` -> `pathToPlacements(cells, existing, nextId)`.

- Draw-pipe: first click resolves to a part port (or bare cell); the hovered cell is routed live (ghost, once per animation frame); the second click commits pipes + elbows as one undo step and keeps chaining from the end cell.
- Reroute (`R`, or the "Reroute" button; edit mode, pipe or elbow selected): finds the connected pipe/elbow run, deletes it, routes between its two ends with the run excluded from the obstacles. One undo step.
- No route: the ghost turns red; the click draws the old manhattan L and shows "No clear route — drew a straight L". Half-cell clicks skip the router (not a pipe node) and also draw the L, without the notice.

## Geometry conventions

- A placement's `(x, y)` is the CENTRE of its footprint. A part blocks every grid node in the closed box `[x-w/2, x+w/2] x [y-h/2, y+h/2]`: a 2x2 tank is a 3x3 block of nodes, edge nodes included, so a tube never grazes a vessel wall. 90/270 degree `rotation` swaps w and h.
- `area` and `label` never block. Pipes block every node of their run, ends included; elbows, valves and end caps block their node.
- Ports (`IsoPartDefinition.ports`) are part-local offsets from the centre plus an outward `dir`; both rotate with the placement. Compass: n = -y, e = +x, s = +y, w = -x. The built-in `tank` and `mixer` have `east` / `west` ports at floor level on the vessel edge.
- `RouteEnd.heading` is the port's OUTWARD direction: the first step leaves that way; at the end the last step arrives moving the opposite way.

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
