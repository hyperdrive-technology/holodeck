# Process part style guide

What makes the 28 shipped parts read as one family, and the data conventions
that go with them. Source of truth for numbers is `_common.py`; for the rules,
`docs/assets/process-catalog.md`.

## Visual rules

- **Read at small size, from above, in isometric.** Strong silhouette, a few
  large forms. Judge every preview at 160 px as well as full size. Detail that
  is not visible at 160 px becomes outline noise at runtime: remove it.
- **Fat and faceted.** Parts sit next to six-sided pipes and low-poly tanks.
  Main bodies use `c.SEG` (12) sides, small pieces `c.SMALL_SEG` (8). No
  bevels, subdivision, textures or UVs. Small baked radii on boxes only.
- **Outlines come from facet creases.** `c.edges(obj, threshold)` sets the
  crease angle; `enabled=False` turns an object's outline off. Thin collars,
  stems and many-sided rings usually want `enabled=False` or a higher
  threshold (40 to 45). Main casings keep 15.
- **Daylight beats volume.** An open yoke, a visible coupling, a gap around a
  moving rod say "this moves" better than a filled block. Leave real clearance
  around anything that animates.
- **One accent piece.** `hd.accent` is the single per-instance colour (running,
  fault, position). Put it on a flush band, bezel, lens, lever or cap, never
  on a large area. The stack light is the one part with three accent meshes.
- **No lettering.** Displays are blank faces with a bezel; labels are the
  host's job.
- **Hang detail off the fixed envelope.** Declare the footprint first, then fit
  the part inside it; whole cells for floor parts.

## Family proportions (reuse them)

| Thing | Value | Where |
| --- | --- | --- |
| Pipe radius, axis height | 0.2, 0.32 | `_common.PIPE_R`, `PIPE_Y` |
| Equipment flange | radius 0.27, 0.05 thick | `_common.FLANGE_R`, `FLANGE_T` |
| Valve face-to-face | 1.0 (0.5 for wafer / solenoid) | inline length rule |
| Valve body | lathe radius about 0.285 (0.29 globe), nozzle from x = 0.23 to 0.5 | `valve-ball.py`, `valve-control.py` |
| Neck / stem | neck r 0.095, 8-sided packing nut and stem | `valve-ball.py` |
| Motor | shaft axis Y=0.32 on feet, fan cowl, flush accent band | `motor.py`, `_batch_b.motor()` |
| Field instrument head | round housing, blank display, accent bezel | `transmitter.py`, `_batch_d.transmitter_head()` |
| Small-bore lines | port `radius: 0.1` in `models.json` | `pump-dosing.py` |

## Pick a reference part

| You are adding | Start from | Why |
| --- | --- | --- |
| Inline valve, manual | `valve-ball`, `valve-butterfly` | handle on `anim.handle`, quarter turn |
| Inline valve, actuated or control | `valve-control`, `valve-actuated`, `valve-three-way` | stem on `anim.stem`, yoke and actuator |
| Inline instrument (flow, analyser) | `flowmeter-mag` | spool plus transmitter head |
| Floor rotating equipment | `motor`, `pump-lobe`, `blower`, `compressor` | baseplate, shaft spin, grid port `out` |
| Vertical vessel-like equipment | `filter`, `cyclone`, `cooling-tower` | legs or frame, tall footprint |
| Horizontal shell equipment | `heat-exchanger-shell-tube`, `boiler` | `c.saddle` supports |
| Mounted instrument | `transmitter`, `gauge-pressure`, `level-radar`, `beacon` | origin at the connection, `mountHeight` |
| Electrical enclosure | `cabinet`, `vfd`, `junction-box` | plain boxes, one bezel accent |
| Anything diagonal | `strainer-y`, `cyclone` | `c.lathe` plus rotation, ports stay axis-aligned |

## Data conventions (`parts.json`)

| Part has | Param | Wiring |
| --- | --- | --- |
| open/closed lever or indicator | `open` (boolean, default true when modelled open) | `animNodes.open`: animator `turn`, `axis`, `fromDeg` / `toDeg` |
| analogue stem or damper position | `position` 0..100 `%` | animator `travel`, `axis`, `distance`, `scale: 100` |
| spinning shaft, impeller, fan | `running` (boolean) + `speed` 0..100 `%` | animator `spin`, `axis`, `rpmScale`, `enableParam: "running"` on `speed` |
| needle | `value` 0..100 `%` | animator `turn`, `axis: "z"`, `toDeg` negative for clockwise |
| fault / alarm tint | `fault` or `alarm` (boolean) | `alarmParam` names it; tints `hd.accent` |
| coloured state | a boolean | `stateColors: [{ param, color }]` |
| bound colour | `color` (type `color`, default `""`) | tints `hd.accent` from a bound colour |
| a reading shown by a label | `value` (`reading: true`) + `unit` (string) | none |
| mounted on pipes or vessels | `mountHeight` (number, 0..10 `cells`) | `heightParam: "mountHeight"` |

Precedence on `hd.accent`: alarm, then state colours, then `color`, then the
placement colour, then the model's own accent. A part with no `hd.accent`
piece declares no `color`, `alarmParam` or `stateColors`; a part with one
declares `color` exactly (type `color`, default `""`). A test enforces both.

Mounted parts set `floor: true` and `heightParam`; floor parts set neither.
Neither declares grid ports unless a pipe from a grid node really meets a nozzle.
Inline parts set `origin: "pipe-axis"`, `inlineLength`, and `in` (`dir: "w"`)
/ `out` (`dir: "e"`) ports at `x: 0, y: 0`.

Built-in animators today: `turn`, `travel`, `spin`. A motion that none of
them covers (damper louvres moving together, a reciprocating stroke with a
different shape) needs an animator in the editor first: that is a **major**
change, so file it instead of working around it with extra geometry.
