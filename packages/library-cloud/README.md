# @holodeck/library-cloud

`holodeck.cloud` provides twenty-six vendor-neutral cloud archetypes and two
`holodeck.iso.theme` contributions, `arcentry-light` and `arcentry-dark`.
ESM only, Node 26+, with the SDK as its only runtime dependency. Part definitions
are data-only: the E2 editor supplies the model, logo and colour renderer.

| Part ID | Shape |
| --- | --- |
| `cloud:server` | Three-bay server tower |
| `cloud:database` | Three cylindrical storage platters |
| `cloud:cache` | Memory chip with perimeter pins |
| `cloud:queue` | Stacked messages with envelope folds |
| `cloud:load-balancer` | Raised hub branching into three outputs |
| `cloud:gateway` | Open portal with a through arrow |
| `cloud:function` | Hexagonal function module |
| `cloud:container` | Corrugated container with end doors |
| `cloud:bucket` | Tapered storage bucket with a flat lid |
| `cloud:user` | Faceted head and shoulders |
| `cloud:generic-block` | Wide rounded block |
| `cloud:generic-cube` | Rounded cube |
| `cloud:generic-flat` | Thin rounded tile |
| `cloud:broker` | Octagonal hub with four satellite nodes |
| `cloud:cdn` | Faceted globe with edge nodes on a ring |
| `cloud:registry` | Open shelves of banded package crates |
| `cloud:disk` | Single platter with a read arm |
| `cloud:warehouse` | Low hall with a clerestory roof and roller door |
| `cloud:stream` | Chevron channels around a raised island |
| `cloud:firewall` | Staggered brick wall with a broad cap |
| `cloud:vault` | Safe with a spoked locking wheel |
| `cloud:identity` | Upright badge with a portrait |
| `cloud:monitoring` | Console with a bold signal trace |
| `cloud:mobile` | Upright handset on a dock |
| `cloud:pc` | Monitor on a stand with a keyboard |
| `cloud:billboard` | Upright sign with a front-facing logo (see below) |

## Install into a host

Serve the package's `assets/` directory at a browser-accessible URL. The host
resolves models and logos through `assetUrl`; no bundler-specific imports or
absolute filesystem paths are embedded in the library.

```ts
import { HolodeckHost } from '@holodeck/sdk';
import { isoEngine } from '@holodeck/editor-2.5d-react';
import manifest from '@holodeck/library-cloud/holodeck.package.json' with { type: 'json' };
import cloudPackage from '@holodeck/library-cloud/holodeck-package';

const host = new HolodeckHost({ name: 'studio' });
host.registerEngine(isoEngine);
await host.installPackage(manifest, cloudPackage, {
  assetBase: 'https://cdn.example.com/holodeck/cloud/assets/',
});
```

Alternatively pass `manifestUrl` pointing at the served `holodeck.package.json`;
the SDK resolves its `assets` directory. Installing before the iso engine is
supported: contributions remain pending until the engine registers its kinds.
Select `arcentry-light` or `arcentry-dark` with the editor's theme selection.
Theme tokens include E2 connectors, icons, metadata, text and area walls.

## Reuse an archetype

`CLOUD_PART_DEFINITIONS` holds the raw asset-relative definitions;
`createCloudParts(assetUrl)` returns independent definitions with resolved URLs.
Other packs can clone one, assign their own ID, replace `logo.url`, and set
`colors.body`, `colors.accent` and `colors.edge`. The built-in cloud symbol is an
original, vendor-neutral SVG covered by this package's MIT licence.

All parts have a 2×2 routing footprint, `instanced: false`, and empty `params`.
Every part is a routing obstacle (`floor: false`) except `cloud:billboard`, which
is `floor: true` like E2's own billboard-mode `image`: a sign annotates a diagram
and never blocks a route. No React `component` or instanced renderer is needed.
The muted blue accent is the default; body and edge colours inherit the selected
theme. A placement's `color` overrides the part accent, as specified by E2.

Every model uses Y-up coordinates, rests at Y=0, and is centered in X/Z.
Only `hd.white` and `hd.accent` materials are used. One empty named `logo` marks
the center of a flat, unobstructed top surface; its X/Z scale specifies the safe
square logo size. Omit `logo.size` to use it. The renderer applies the small depth
offset and letterboxes the image. See the [E2 object contract](../editor-2.5d-react/docs/objects.md)
and [Blender contract](../../blender/README.md).

**Billboard contract difference.** `cloud:billboard` is the one archetype whose
`logo` empty is not on the top face: it is centered on the sign's front (+Z) face,
rotated so the empty's local +Y is the face normal (local −Z is the image top).
Its local X/Z scale is still the square edge. E2's `logoAnchorFromModel` reads
only the empty's position and scale and lays every logo flat, so until E2 honours
the empty's orientation (holodeck#138) the billboard logo renders horizontally inside the panel.
The GLB tests pin the authored orientation so the E2 change has a fixed target.

## Build and verify

Run from `packages/library-cloud` with Node 26 and pnpm 10.33.2. Build the sibling
`holodeck-sdk/ts` first, then install with `pnpm install --frozen-lockfile`.

```sh
pnpm parts:build                     # all 26 scripts -> assets/models/*.glb
pnpm parts:build server database     # selected archetypes
pnpm parts:preview                   # also render /tmp/a1-previews/<name>.png
node scripts/build-parts.mjs --out-dir /tmp/cloud-models --preview-dir /tmp/cloud-previews
pnpm type-check
pnpm exec vitest run
pnpm build
pnpm smoke
```

The build uses `$BLENDER`, `/Applications/Blender.app/Contents/MacOS/Blender`, or
`blender` on PATH, in that order. It executes each script under
`blender/parts/cloud/` with `--factory-startup` and `--python-exit-code 1`.
The shared `run_part` exports before adding the preview camera. Previews use
Workbench lighting; runtime materials and the logo overlay are applied by E2.

Tests load every GLB with Three.js, check materials, finite geometry, triangle
budgets, ground/footprint bounds, and raycast the logo square onto its face (the
top face, or the billboard's front face).
They validate manifest installation and themes against SDK and E2 contracts.
If Blender is installed, all scripts are rebuilt to temporary files and compared
byte-for-byte with the assets. CI tests the checked-in GLBs without requiring
Blender; the rebuild checks explicitly skip when Blender is absent.
The package smoke check verifies built ESM exports, installation, asset URLs and
the contents of `npm pack`.

On some sandboxed macOS sessions, Blender 5.2.2 crashes in Metal device detection
before executing Python. Its upstream tracker identifies this as a missing-device
case ([Blender source, issue 163272](https://github.com/blender/blender/blob/main/source/blender/gpu/metal/mtl_backend.mm)).
Run the build in a session where Blender can start, then rerun the tests. A failed
export never counts as a successful build, and missing assets fail the contract tests.
