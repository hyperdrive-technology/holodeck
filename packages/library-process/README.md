# @holodeck/library-process

`holodeck.process` provides low-poly industrial process parts for the
`holodeck.iso` engine, built from Blender scripts. ESM only, Node 26+, with the
SDK as its only runtime dependency. Part definitions are data-only: the E2
editor's `DataPart` loads each GLB, applies the active theme, places inline
parts on the pipe axis and runs the animators. Nothing in the package knows
about PLCs; a host binds its signals to the part params through the normal
binding model.

Target catalogue, authoring rules and waves: [docs/assets/process-catalog.md](../../docs/assets/process-catalog.md).

| Part ID | Category | Params (bindable) | Moves |
| --- | --- | --- | --- |
| `process:valve-ball` | Valves | `open` (bool), `color` | lever `anim.handle` turns a quarter turn about Y (`turn`) |
| `process:valve-butterfly` | Valves | `open` 0..1, `color` | lever `anim.handle`, quarter turn about Y (`turn`) |
| `process:valve-control` | Valves | `position` 0-100 %, `fault`, `color` | stem `anim.stem` rises 0.08 at 100 % (`travel`) |
| `process:valve-actuated` | Valves | `open` 0..1, `fault`, `color` | indicator `anim.handle`, quarter turn about Y (`turn`) |
| `process:valve-solenoid` | Valves | `energised` (green coil), `fault`, `color` | none |
| `process:valve-three-way` | Valves | `position` 0-100 %, `fault`, `color` | stem `anim.stem` rises 0.06 at 100 % (`travel`); `branch` port on +Z |
| `process:valve-check` | Valves | `color` | none |
| `process:valve-relief` | Valves | `lifted` (alarm tint), `mountHeight`, `color` | lever `anim.handle` tilts 20° about Z (`turn`) |
| `process:motor` | Rotating equipment | `running` (green band), `speed` 0-100 %, `fault`, `color` | shaft `anim.shaft` spins about X while `running` (`spin`) |
| `process:pump-lobe` | Rotating equipment | `running`, `speed`, `fault`, `color` | shaft about X while `running` (`spin`) |
| `process:pump-inline` | Rotating equipment | `running`, `speed`, `fault`, `color` | shaft about Y while `running`; sits on a pipe |
| `process:pump-dosing` | Rotating equipment | `running`, `stroke` 0-100 %, `fault`, `color` | plunger `anim.stem` reciprocates 0.04 along +X while `running` (`travel`, `cycleHz`) |
| `process:blower` | Rotating equipment | `running`, `speed`, `fault`, `color` | impeller `anim.blades` about Z while `running` |
| `process:compressor` | Rotating equipment | `running`, `load` 0-100 %, `fault`, `color` | none; grid port `out` (east) |
| `process:heat-exchanger-shell-tube` | Heat transfer | `tubeInTemp`, `tubeOutTemp`, `shellInTemp`, `shellOutTemp` (°C) | none (readings for labels) |
| `process:boiler` | Heat transfer | `firing` (orange burner), `pressure` (reading), `unit`, `fault`, `color` | none |
| `process:cooling-tower` | Heat transfer | `running`, `speed`, `fault`, `color` | fan `anim.blades` about Y while `running`; grid port `out` (east) |
| `process:filter` | Separation | `blocked` (alarm tint), `dp` (reading), `unit`, `color` | none; grid port `out` (east) |
| `process:strainer-y` | Separation | `blocked`, `dp`, `unit`, `color` | none; sits on a pipe, basket toward +Z (1×2) |
| `process:cyclone` | Separation | `dp` (reading), `unit` | none (no state colour) |
| `process:transmitter` | Instruments | `value` (reading), `unit`, `alarm`, `mountHeight`, `color` | none |
| `process:gauge-pressure` | Instruments | `value` 0-100 %, `alarm`, `mountHeight`, `color` | needle `anim.needle` sweeps 270° clockwise (`turn` about Z) |
| `process:flowmeter-mag` | Instruments | `value` (reading), `unit`, `fault`, `color` | none |
| `process:level-radar` | Instruments | `value` (reading), `unit`, `fault`, `mountHeight` (default 0.2), `color` | none |
| `process:beacon` | Instruments | `red`, `amber`, `green`, `mountHeight`, `color` | none (one colour: the highest lit tier) |
| `process:cabinet` | Electrical | `fault`, `color` | none |
| `process:vfd` | Electrical | `running` (green bezel), `fault`, `mountHeight`, `color` | none |
| `process:junction-box` | Electrical | `mountHeight` | none (no state colour) |

State colour: every part with an `hd.accent` piece (lever, actuator cap, motor
band, display bezel, stack-light lenses) has a `color` param that takes a
bound colour (for example a `threshold` transform from a status word); most
also declare `alarmParam` (`fault`, `alarm`, or `lifted` on the relief valve),
which tints it with the theme's alarm colour while true, and some declare
`stateColors` (solenoid `energised`, drive `running`, stack-light tiers).
Precedence is alarm, then state colours, then `color`, then the placement
colour, then the model's own accent.

The stack light's three tiers share one `hd.accent` material, so it shows one
colour, the highest lit of red / amber / green; independent tier colours need
per-mesh accent materials at runtime (a follow-up in the style layer).

Mounted parts declare `heightParam: 'mountHeight'`: a per-placement lift whose
default stands the part on the floor (0.2 for the radar, whose horn hangs below
its flange). `0.52` puts it on top of a floor-level pipe.

## Install into a host

Serve the package's `assets/` directory at a browser-accessible URL and install
through the manifest, exactly like `@holodeck/library-cloud`:

```ts
import { HolodeckHost } from '@holodeck/sdk';
import { isoEngine } from '@holodeck/editor-2.5d-react';
import manifest from '@holodeck/library-process/holodeck.package.json' with { type: 'json' };
import processPackage from '@holodeck/library-process/holodeck-package';

const host = new HolodeckHost({ name: 'studio' });
host.registerEngine(isoEngine);
await host.installPackage(manifest, processPackage, {
  assetBase: 'https://cdn.example.com/holodeck/process/assets/',
});
```

`PROCESS_PART_DEFINITIONS` holds the raw, asset-relative definitions;
`createProcessParts(assetUrl)` returns independent copies with resolved URLs.
`PROCESS_MODELS` is each GLB's node contract (kind, envelope, `port.*`
nozzles with position, facing, mouth shape and bore, `anim.*` pivots,
state-colour piece), mirrored from its Blender script, and
`processModelPath(slug)` its asset path. Studio bundles the GLBs with Vite
`?url` imports (`apps/studio/src/host/process-package.ts`).

## Editor contract used

- `origin: 'pipe-axis'` on inline parts: the GLB origin is on the pipe axis and
  E2 renders it at `pipeWorldY()`. `inlineLength` is the face-to-face length.
  Inline parts declare coincident `in` / `out` grid ports at their centre, so
  a drawn pipe snaps to them.
- `animNodes[param].settings`: per-part settings for the built-in animators
  `turn`, `travel` and `spin` (with `enableParam` gating a spin on a boolean).
- `alarmParam`: the boolean param that tints `hd.accent` with the alarm colour;
  `stateColors`: booleans that tint it with their own colour.
- `heightParam`: the number param that lifts a mounted part per placement.

Grid ports are only declared where a pipe leaving a grid node meets the GLB
nozzle; the heat exchanger's nozzles are off the grid, so it has none yet (see
the catalogue's Package section).

## Agent skills

The package ships three skills (`skills/`, published with the package) so an
agent can extend the library in the same style without re-deriving the rules:

| Skill | Use it to |
| --- | --- |
| [`process-part-add`](skills/process-part-add/SKILL.md) | add one part: script template, kinds, registration checklist, style guide |
| [`process-part-verify`](skills/process-part-verify/SKILL.md) | verify a part (previews, byte-stable rebuild, motion, tests, Studio) or review one |
| [`process-parts-batch`](skills/process-parts-batch/SKILL.md) | run a wave of parts through a 3D-generating model, with a brief template |

In this repository they are linked from `.claude/skills/`, so Claude Code finds
them; other agents can read the `SKILL.md` files directly. `src/skills.test.ts`
fails when a skill names a `_common` helper, part or file that no longer exists.

## Adding parts from a new Blender batch

1. The batch adds `blender/parts/process/<slug>.py` and
   `assets/models/<slug>.glb`. The tests now fail: every GLB needs a contract
   and a definition.
2. Add `<slug>` to `src/models.json`, copying the script's final
   `c.check(...)` (kind, footprint, height, `y_min`, length, anim) and each
   port's position plus, from the docstring, its facing, mouth (`rect` ducts)
   and bore radius when not 0.2, and whether it uses `hd.accent`.
3. Add the definition to `src/parts.json`: id `process:<slug>`, label,
   catalogue family as `category`, hint, whole-cell footprint, params (the
   catalogue's "Params" column), and for inline parts `origin`,
   `inlineLength` and the `in` / `out` ports; bind each `anim.*` node to a
   built-in animator with its settings.
4. Update the part's status in the catalogue to `have (`library-process`)`
   (a test keeps the doc and `parts.json` in step), and add the GLB to
   Studio's `process-package.ts` asset map.

## Build and verify

Run from `packages/library-process` with Node 26.13.0 and pnpm 12.16.1. Build
the sibling `holodeck-sdk/ts` first, then `pnpm install --frozen-lockfile`.

```sh
pnpm parts:build                 # every part script -> assets/models/*.glb
pnpm parts:build motor cabinet   # selected parts
pnpm parts:preview               # also render /tmp/process-previews/<slug>.png
pnpm type-check
pnpm exec vitest run
pnpm build
pnpm smoke
```

The build runs `blender/parts/process/<slug>.py` headless (`$BLENDER`, the
macOS app bundle, or `blender` on PATH) with `--factory-startup` and
`--python-exit-code 1`; `_common.py` and other `_*.py` files are shared
helpers, never parts. The GLB tests load every model with Three.js and check
the budget (< 60 KB, < 3 000 triangles), `hd.*` materials, the envelope, the
`port.*` / `anim.*` empties, and drive each anim node with the part's real
animator. With Blender installed they also rebuild every script and compare
the result with the shipped GLB (BIN chunk byte-identical, JSON within 1e-6);
`.github/workflows/blender-drift.yml` runs that with `HOLODECK_REQUIRE_BLENDER=1`.
