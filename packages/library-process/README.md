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
| `process:valve-control` | Valves | `position` 0-100 %, `fault`, `color` | stem `anim.stem` rises 0.08 at 100 % (`travel`) |
| `process:motor` | Rotating equipment | `running`, `speed` 0-100 %, `fault`, `color` | shaft `anim.shaft` spins about X while `running` (`spin`) |
| `process:heat-exchanger-shell-tube` | Heat transfer | `tubeInTemp`, `tubeOutTemp`, `shellInTemp`, `shellOutTemp` (°C) | none (readings for labels) |
| `process:transmitter` | Instruments | `value` (reading), `unit`, `alarm`, `color` | none |
| `process:cabinet` | Electrical | `fault`, `color` | none |

State colour: every part with an `hd.accent` piece (lever, actuator cap, motor
band, display bezel, beacon lens) declares `alarmParam` (`fault`, or `alarm`
on the transmitter), which tints it with the theme's alarm colour while true,
and a `color` param that takes a bound colour (for example a `threshold`
transform from a status word). Precedence is alarm, then `color`, then the
placement colour, then the model's own accent.

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
`PROCESS_MODELS` is each GLB's node contract (kind, envelope, `port.*` and
`anim.*` positions, state-colour piece), mirrored from its Blender script, and
`processModelPath(slug)` its asset path. Studio bundles the GLBs with Vite
`?url` imports (`apps/studio/src/host/process-package.ts`).

## Editor contract used

- `origin: 'pipe-axis'` on inline parts: the GLB origin is on the pipe axis and
  E2 renders it at `pipeWorldY()`. `inlineLength` is the face-to-face length.
  Inline parts declare coincident `in` / `out` grid ports at their centre, so
  a drawn pipe snaps to them.
- `animNodes[param].settings`: per-part settings for the built-in animators
  `turn`, `travel` and `spin` (with `enableParam` gating a spin on a boolean).
- `alarmParam`: the boolean param that tints `hd.accent`.

Grid ports are only declared where a pipe leaving a grid node meets the GLB
nozzle; the heat exchanger's nozzles are off the grid, so it has none yet (see
the catalogue's Package section).

## Adding parts from a new Blender batch

1. The batch adds `blender/parts/process/<slug>.py` and
   `assets/models/<slug>.glb`. The tests now fail: every GLB needs a contract
   and a definition.
2. Add `<slug>` to `src/models.json`, copying the script's final
   `c.check(...)` (kind, footprint, height, `y_min`, length, ports, anim) and
   whether it uses `hd.accent`.
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
