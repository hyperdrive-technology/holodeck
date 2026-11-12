# Process asset catalog (`holodeck.process`)

What a full industrial-process part library looks like for Holodeck, what exists
today, and the order the rest is built in. Reviewed 2026-11-11 against `main`
at `f9ce1f1`.

The coverage guide is the automation set of the
[OpenBridge design system](https://www.openbridge.no/)
([components](https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents/tree/main/packages/openbridge-webcomponents/src/automation)).
OpenBridge is a 2D maritime HMI kit. It is used here only as a checklist of
equipment classes; no artwork, geometry or code is taken from it. Classes that
a land-based process plant needs and OpenBridge lacks (solids handling,
columns, compressors, actuator types) come from ISA-5.1 / ISO 10628 equipment
classes.

## What exists today

| Asset | Kind | Where | Placeable in Studio | Notes |
| --- | --- | --- | --- | --- |
| Tank (parametric top / bottom / stand, level, alarm) | code (R3F) | `editor-2.5d-react/assets/process/Tank.tsx` | yes | being reworked in #228 (draft) |
| Mixer (agitated vessel) | code | `Mixer.tsx`, `TankAgitator.tsx` | yes | `mixer.glb` variant in #227 / #228 (drafts) |
| Shaft | code | `Shaft.tsx` | yes | |
| Valve (handwheel, inline) | code | `Valve.tsx`, `valve-geometry.ts` | yes | `open` is a boolean with no visual state |
| Pipe, elbow, end cap | code | `Pipe.tsx`, `Elbow.tsx`, `EndCap.tsx` | yes | routed; no tee, cross, reducer |
| Label, area | code | `Label.tsx`, `Area.tsx` | yes | |
| `pump.glb` (end-suction centrifugal) | Blender | `blender/parts/pump.py` | no (core's brewery extension only) | authored at pipe radius 0.09, scene pipes are 0.2: needs `scale` |
| `heat-exchanger.glb` (plate) | Blender | `blender/parts/heat-exchanger.py` | no (brewery extension only) | no ports, no anim nodes |
| `valve.glb` (globe + doughnut wheel) | Blender | `blender/parts/valve.py` | no | older shape than the code valve; wheel dwarfs the body |
| `fermenter`, `brite-tank`, `kettle`, `mash-tun` `.glb` | Blender | `blender/parts/*.py` | no | unused: Tank presets replaced them |
| Pilot six plus wave-1 batches A (valves), B (rotating), C (heat transfer, separation) and D (instruments, electrical): 28 parts, see the status columns below | Blender | `blender/parts/process/*.py` → `@holodeck/library-process` | yes ("Process parts" in the palette) | animated levers, stems, shaft and gauge needle; `fault` / `alarm` / state colours tint `hd.accent`; sample `apps/studio/samples/process-line.holodeck.json` |
| 26 cloud archetypes, 54 AWS services | Blender + SVG | `library-cloud`, `assets-aws` | yes | not process assets; the packaging model to copy |

So a standalone Studio user can place thirty-seven process parts, two of which
are annotations: the nine above plus twenty-eight from `@holodeck/library-process`.
The end-suction centrifugal pump is still only the brewery's off-scale
`pump.glb`, and there is no solids handling and no vessel beyond Tank and Mixer.

## Package

Process parts ship as a library package, `@holodeck/library-process`
(`holodeck.process`), built the same way as `@holodeck/library-cloud`:

- Blender scripts in `blender/parts/process/<slug>.py`, shared vocabulary in
  `blender/parts/process/_common.py`.
- GLBs in `packages/library-process/assets/models/<slug>.glb`.
- Data-only part definitions (`src/parts.json`), ids `process:<slug>`, and
  `src/models.json`, a mirror of each script's final `c.check(...)` (kind,
  envelope, `port.*` and `anim.*` positions, whether it has `hd.accent`). Tests
  fail until every GLB has both, so each new Blender batch is a deliberate
  edit of the two files (a few lines per part).
- The existing brewery GLBs stay where they are until the package covers them.

How the definitions use the editor contract (`IsoPartDefinition`):

- Inline parts set `origin: 'pipe-axis'` (rendered at `pipeWorldY()`),
  `inlineLength` = face-to-face length, and coincident `in` / `out` ports at
  the body centre (`w` / `e`), so a drawn pipe snaps to the valve like the
  code valve.
- Animation: `animNodes` name a built-in animator plus per-part `settings`:
  `turn` (quarter-turn levers: `fromDeg: 90, toDeg: 0` on `open`; relief
  lever `axis: 'z'`, 0 to 20 on `lifted`; gauge needle `axis: 'z'`, 0 to
  -270 over 0..100 % on `value`), `travel` (stems: `distance: 0.08` / `0.06`,
  `scale: 100` on `position`; the dosing-pump plunger reciprocates with
  `axis: 'x', distance: 0.04, cycleHz: 1.5`, gated by `running`, on `stroke`),
  `spin` (shafts and fans, gated by `enableParam: 'running'`, on `speed`:
  motor and lobe pump about X, inline pump and cooling-tower fan about Y,
  blower impeller about Z). Damper louvres (`blades` moving together, not
  spinning) still need an animator.
- State colour: `alarmParam` (`fault`, `alarm`, or `lifted` on the relief
  valve) tints `hd.accent` with the theme's alarm colour; `stateColors` tint
  it while a boolean is on (solenoid `energised`, drive `running`); a `color`
  param takes a bound colour (a threshold transform) like the cloud parts.
- The stack light's three tiers share one `hd.accent` material, so it shows
  one colour: the highest lit of `red` / `amber` / `green`. Independent tier
  colours need per-mesh accent materials at runtime (follow-up).
- `src/models.json` records every nozzle's position, facing (`+x` ... `-z`),
  mouth (`rect` for the blower discharge and the cyclone inlet) and bore when
  not the standard pipe (dosing pump: 0.1); the GLB empties carry position
  only.
- Grid ports are declared only where a pipe leaving a grid node meets the
  GLB nozzle and faces its heading (a test checks both). The heat exchanger's nozzles are off the
  grid (`tube-in` at x = -1.10 on a 3 x 1 footprint) or elevated, so it has
  no grid ports yet: move `tube-in` to x = -1.0 (and consider a 3 x 2
  footprint so a face lands on a node) to make it routable.
- Mounted parts (transmitter, gauge, radar, relief valve, stack light, drive,
  junction box) have a `mountHeight` param (`heightParam`): the default stands
  them on the floor (0.2 for the radar, whose horn hangs below its flange);
  0.52 puts one on top of a floor pipe. They declare no grid ports.

Nothing in the package knows about PLCs or Hyperdrive. Hyperdrive binds tags to
the part params through the normal binding model.

## Authoring rules for process GLBs

These add to the contract in [`blender/README.md`](../../blender/README.md).

- **Scale.** 1 unit = 1 grid cell. Author at scene scale so no part needs
  `scale`: pipe radius `0.2`, pipe axis height `0.32` (`pipeWorldY()` =
  radius + 0.12 gap), flange radius `0.27`. The numbers live in
  `packages/editor-2.5d-react/assets/process/pipe-math.ts` and
  `valve-geometry.ts`.
- **Inline parts** (valves, strainers, inline meters): origin on the pipe axis
  at the body centre, pipe axis = X, `port.in` at -X and `port.out` at +X on
  the flange faces. Body length is a multiple of 0.5.
- **Floor parts** (pumps, motors, skids, cabinets): origin on the floor at the
  footprint centre, resting on Y = 0. Nozzle axes sit at 0.32 where the part
  connects to floor-level pipe runs. Fit a whole-cell footprint.
- **Ports.** One `port.<name>` empty per nozzle, on the flange face. Names say
  the function: `in`, `out`, `suction`, `discharge`, `shell-in`, `tube-out`,
  `drain`, `vent`.
- **Animation pivots.** `anim.<name>` empties, with the moving meshes as
  children, so the runtime can drive them from a param:
  - `anim.shaft`: continuous spin about the shaft axis (motor, pump, fan).
  - `anim.stem`: linear travel along local +Y, 0 to 1 = closed to open.
  - `anim.handle` / `anim.disc`: quarter turn, 0 to 1 = closed to open.
  - `anim.blades`: damper louvres.
  - `anim.needle`: gauge needle sweep.
- **State colour.** The part of the model that should carry state (actuator
  cap, position indicator, beacon lens, motor band) uses `hd.accent`. It is the
  one per-instance colour, so running / stopped / fault can tint it.
- **Look.** Low-poly, flat-shaded, facet creases as outlines, no bevels except
  small baked radii on boxes. 8 or 12 radial segments so facets line up with
  pipes (6 sides) and flanges. Suppress outline noise on thin parts with
  `hd_edges=False` or a higher `hd_edge_threshold`.
- **Budget.** Under 60 KB per GLB, under 3 000 triangles.

## Catalog

Status: **have** = on `main` and placeable; **partial** = exists but not
placeable or missing states; **wave 1 / 2 / 3** = planned; **code** = needs
routing or parametric code, not a GLB.

### Valves

| Part | OpenBridge class | Params (bindable) | Status |
| --- | --- | --- | --- |
| `valve-gate` handwheel | digital-valve (manual) | open | partial (code valve, no state visual) |
| `valve-ball` lever | digital-valve | open | have (`library-process`) |
| `valve-butterfly` lever | digital-valve | open | have (`library-process`) |
| `valve-control` globe + pneumatic diaphragm | analog-valve | position 0-100 %, fault | have (`library-process`) |
| `valve-actuated` ball + rotary actuator | digital-valve | open, fault | have (`library-process`) |
| `valve-solenoid` | digital-valve | energised | have (`library-process`) |
| `valve-three-way` actuated | analog / digital-threeway-valve | position, fault | have (`library-process`); `branch` port on +Z |
| `valve-check` swing | non-return-valve, hydraulic-check-valve | (none) | have (`library-process`) |
| `valve-relief` angle, spring bonnet | (none) | lifted | have (`library-process`); mounted, no grid ports (outlet at Y 0.30) |
| `valve-pressure-reducing` | pressure-reduction-valve | setpoint | wave 2 |
| `valve-pressure-sustaining` | pressure-sustain-valve | setpoint | wave 2 |
| `valve-diaphragm` hygienic | (none) | open | wave 2 |
| `valve-mixproof` hygienic double seat | (none) | upper, lower | wave 3 |
| `valve-directional` hydraulic 4/3, x/2 | hydraulic-valve-4-3, hydraulic-valve-x-2 | spool | wave 3 |
| `damper` duct louvre | damper | position | wave 2 |

### Pumps, motors and other rotating equipment

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| `pump-centrifugal` end suction | pump | running, speed, fault | partial (`pump.glb`, brewery only, off-scale) |
| `motor` foot-mounted | motor | running, speed, fault | have (`library-process`) |
| `pump-lobe` positive displacement | pump | running, speed | have (`library-process`) |
| `pump-inline` vertical inline | pump | running, speed | have (`library-process`) |
| `pump-dosing` diaphragm metering | pump | running, stroke | have (`library-process`); vertical small-bore ports, no grid ports |
| `blower` centrifugal fan | fan | running, speed | have (`library-process`); elevated round inlet, rectangular top duct |
| `compressor` screw package | (none) | running, load | have (`library-process`) |
| `fan-axial` duct fan | fan | running, speed | wave 2 |
| `pump-submersible` | pump | running | wave 2 |
| `pump-vacuum` liquid ring | pump | running | wave 2 |
| `gearbox` | (none) | (none) | wave 2 |
| `agitator-drive` top entry | (none) | running, speed | wave 2 (after #228) |
| `turbine`, `engine`, `generator` set | indicator-engine, gauge-generator | running, load | wave 3 |

### Heat transfer

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| `heat-exchanger-plate` | heat-exchanger | temperatures | partial (GLB, brewery only, no ports) |
| `heat-exchanger-shell-tube` | heat-exchanger | temperatures | have (`library-process`); no grid ports yet (see Package) |
| `boiler` | (none) | firing, pressure | have (`library-process`); feed nozzle off the grid, no grid ports |
| `cooling-tower` | (none) | fan running | have (`library-process`) |
| `chiller` / `heat-pump` | heat-pump | running | wave 2 |
| `air-cooler` fin fan | (none) | fan running | wave 2 |
| `heater-inline` electric | (none) | on | wave 2 |
| `burner` / `flare` | (none) | firing | wave 3 |

### Separation and solids

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| `filter` cartridge / bag housing | filter | differential pressure, blocked | have (`library-process`) |
| `strainer-y` inline | filter | blocked | have (`library-process`) |
| `cyclone` | (none) | (none) | have (`library-process`); elevated rectangular inlet, no grid ports |
| `separator` disc stack centrifuge | hydraulic-separator | running | wave 2 |
| `conveyor-belt` | (none) | running, speed | wave 2 |
| `conveyor-screw` | (none) | running | wave 2 |
| `rotary-valve` airlock | (none) | running | wave 2 |
| `hopper`, `silo` | (none) | level | wave 2 (after #228) |
| `bucket-elevator`, `mill`, `dryer` | (none) | running | wave 3 |

### Vessels

Vessel work waits for #228, which changes the tank primitives and line rules.

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| Tank, mixer | automation-tank | level, temperature, alarm | have |
| `tank-storage` flat bottom, cone roof | indicator-tank-atmospheric | level | wave 2 |
| `drum-horizontal` on saddles | specialty-tank | level, pressure | wave 2 |
| `column` tray / packed tower | (none) | levels | wave 2 |
| `reactor` jacketed | (none) | level, temperature, speed | wave 2 |
| `ibc-tote`, `drum-200l` | (none) | level | wave 2 |
| `sump` / pit | (none) | level | wave 3 |

### Instruments

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| Label with reading | automation-readout, automation-badge | value, alarm | have |
| `transmitter` head on a stem | transmitter, transmitter-stack | value, alarm | have (`library-process`) |
| `gauge-pressure` dial | gauge-* | value | have (`library-process`) |
| `flowmeter-mag` inline | transmitter | value | have (`library-process`) |
| `level-radar` top mount | transmitter | value | have (`library-process`) |
| `beacon` stack light | automation-badge (alarm) | state | have (`library-process`); one colour for all tiers (highest lit) |
| `flowmeter-coriolis` inline | transmitter | value | wave 2 |
| `level-switch`, `sight-glass` | transmitter | state | wave 2 |
| `analyser` probe (pH, conductivity) | transmitter | value | wave 2 |
| `load-cell`, `camera`, `e-stop` | (none) | state | wave 3 |

### Piping

Pipes are routed and drawn by code, so fittings belong to the routing lane,
not to Blender.

| Part | OpenBridge class | Status |
| --- | --- | --- |
| Pipe, elbow, end cap | horizontal-line, vertical-line, corner-line, end-point-line | have |
| Tee, cross | three-way-line, line-cross | code |
| Bridge (pipes that cross without joining) | line-overlap | code |
| Flow direction arrow / animated flow | direction-line | code |
| Reducer, expansion joint, hose | (none) | code |
| Medium colour (water, steam, product, air) | line medium types | code (theme) |

### Electrical and controls

| Part | OpenBridge class | Params | Status |
| --- | --- | --- | --- |
| `cabinet` control panel / MCC | (none) | fault | have (`library-process`) |
| `vfd` drive | converter | running, fault | have (`library-process`) |
| `junction-box` | (none) | (none) | have (`library-process`) |
| `transformer` | transformer | energised | wave 2 |
| `generator` | gauge-generator, indicator-generator | running, load | wave 2 |
| `battery` rack | electricity-battery, indicator-battery | charge | wave 2 |
| `switchgear` / breaker | switch, bus | closed | wave 2 |
| `plc-rack`, `hmi-panel`, `network-switch` | router | state | wave 2 |
| Circuit symbols (resistor, diode, transistor, logic gates) | resistor, capacitor, diodes, mosfet, logic | out of scope: 2D schematic symbols |

### Site and structure

| Part | Status |
| --- | --- |
| Area (floor, bund walls) | have |
| `skid` base frame, `platform` with stairs, `pipe-rack` | wave 3 |
| `building` shed, `tanker` truck, `forklift`, `pallet`, `operator` | wave 3 |

## Count

| | Parts |
| --- | --- |
| Placeable today (process) | 37 |
| Wave 1 (28 GLBs, 6 of them the pilot) | 28 |
| Wave 2 | about 30 |
| Wave 3 | about 15 |
| Code lane (fittings, flow, medium colours) | 6 items |

## Order of work

1. **Pilot** (Blender, first pass by Codex `gpt-6-astra`): `_common.py` plus
   `valve-ball`, `valve-control`, `motor`, `heat-exchanger-shell-tube`,
   `transmitter`, `cabinet`. One part per family, to settle scale, ports,
   animation pivots and the look before the rest is generated.
2. **Wave 1 remainder** (22 GLBs) in parallel batches on the settled vocabulary.
3. **Package lane** (code): `@holodeck/library-process` with definitions,
   animators for `stem` / `handle` / `needle`, state colour, GLB contract
   tests, Blender drift coverage, Studio install, a sample scene. Done for
   the pilot six; each wave-1 batch adds its entries to `parts.json` and
   `models.json`.
4. **Fix-ups of existing assets**: rescale `pump.glb`, add ports to
   `heat-exchanger.glb`, retire or restyle `valve.glb`, give the code valve an
   open / closed visual.
5. **Wave 2** after #228 lands (vessels build on its primitives).
