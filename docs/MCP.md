# Holodeck MCP server

`@holodeck/mcp` (`packages/mcp`) lets agents build Holodeck scenes through MCP
only. Each workaround an agent needs points to a product gap. Plan:
`~/dev/hyperdrive/.agents/plans/mcp-dogfood.md`. Package README: tools,
configuration, guarantees.

## Design

- **One host, the studio's rules.** The server installs the same engine and
  packages as the studio (`src/host.ts`). It validates with the studio's own
  modules, bundled from `apps/studio/src` (`src/studio.ts`): document checks,
  credential rules, library model, starter scene. `src/studio-shared.test.ts`
  fails if one of those modules starts importing React, browser storage or
  bundler-only assets. CI runs the package in the `studio` job, so any change
  to the studio or the packages it consumes also runs the MCP tests.
- **Edits are editor actions.** `SceneEditor` (`src/scene-editor.ts`) drives
  `editorReducer`, the reducer the canvas runs, which
  `@holodeck/editor-2.5d-react` exports for headless hosts. Placing stamps the
  palette defaults, pipes are routed (A*) and record their ports, moved
  vessels drag their pipes, deletes free pipe ends. If the reducer rejects
  any step (an `Edit rejected:` notice), the whole call fails.
- **Documents on disk.** There is one workspace root. Only `.holodeck.json`
  documents are read or written (and `.components.csv` exports). Writes are
  atomic and guarded by etags.

## Rendering

`scene_render` (`src/render.ts`) drives the studio's production build, so
the picture is exactly the studio's:

1. A loopback static server serves `apps/studio/dist`.
2. Chromium (`playwright-core`, with the studio e2e's WebGPU flags) opens
   `/render`. That route (`apps/studio/src/render/`) reads one document from
   `window.__HOLODECK_RENDER__`, validates it as an import, and draws it in run
   mode with no chrome.
3. The capture waits on `data-render-state`.

`unsupported`, invalid input, a timeout and a flat image are all errors. CI
runs the real-build test in the studio job, after the studio build, on
SwiftShader WebGPU.

## Playground bridge

With `pnpm playground` running, an agent edits the scene open in the user's
browser tab and sees the result live. The path `@playground` stands for that
tab in the scene tools (`scene_get`, `scene_add_object` … `scene_bind`) and in
`provider_connect` / `provider_browse`.

```
MCP server ──ws (agent token, no Origin)──▶ bridge ◀──ws (session token, studio Origin)── playground tab
 packages/mcp/src/playground.ts        apps/studio/bridge/        apps/studio/src/playground/mcp-bridge-*.ts
```

- **Where it runs.** `mcpBridgePlugin` (`apps/studio/bridge/vite-plugin.ts`)
  starts the bridge inside `vite` / `vite preview` in mode `playground`, or
  when `HOLODECK_MCP_BRIDGE=1` (`=0` turns it off). Production builds never
  include it: only dev and preview servers run plugin server hooks. The
  bridge writes `.holodeck-mcp.json` (the WebSocket URL and the agent token,
  mode 0600, gitignored) at the holodeck repo root, or at
  `HOLODECK_MCP_BRIDGE_FILE`, and prints the token. The MCP server reads the
  file again on every call, so a restarted dev server (with a new port and
  token) is picked up without restarting the MCP server.
- **Security** (`apps/studio/bridge/mcp-bridge.ts`):
  - It listens on 127.0.0.1 only, even under `vite --host`.
  - `Host` must be loopback, which stops DNS rebinding.
  - There are two random 256-bit tokens, compared in constant time. The page
    gets the session token from `/__holodeck/mcp-bridge`. That endpoint
    answers loopback clients with a loopback `Host` only and sends no CORS
    headers.
  - Session sockets must carry the studio's own `Origin`. Agent sockets must
    carry none, so no web page can act as the agent even if it learns the
    token.
  - The MCP server sends the token only to a `ws://127.0.0.1:<port>/` URL,
    whatever the file says.
  - Messages are capped at 32 MB. A tab has 30 s to answer.
- **Edits are one undo step.** The MCP server reads the tab's working copy
  (`state`, with an etag), runs the same `SceneEditor` reducer steps it uses
  for files on a copy, and sends the resulting scene (`apply`). The tab
  dry-runs the editor's `apply-scene` action (pure reducer). Then it
  dispatches the action, which the editor commits as one history entry, so
  Mod+Z undoes the whole tool call. The session then autosaves it like any
  user edit.
- **Refusals.** The tab refuses `apply` in these cases:
  - the etag is stale: the user edited meanwhile (`conflict`, so read again);
  - the Viewer tab is active (`viewer`);
  - a gesture is in progress, the canvas is not ready, or a dialog is open
    (reset, save conflict, rebuild) (`busy`);
  - the reducer refuses the scene (`invalid_edit`, with the `Edit rejected:`
    notice).
- **Read back.** `playground_state` returns the working copy, saved or not,
  plus the active tab, save status, selection, connection states and bounded
  live values. `playground_screenshot` is the canvas's own PNG export, so it
  shows live values and the current camera. Without WebGPU it is an error,
  never a blank image.
- **Providers.** `provider_connect` applies the studio's credential rules
  (`src/connections/credentials.ts`) on both ends. Secrets are never sent:
  the result names the ones the user must enter in the Connections tab. On
  `@playground`, `provider_browse` uses the tab's live provider session. On a
  file it runs only the offline simulator (`holodeck.sim`) in-process.
  Anything that needs the network or secrets answers `needs_playground`.
- **No tab.** File paths work as before. `playground_status` never fails: it
  says whether a bridge runs and which tabs are connected (the newest tab is
  the one `@playground` edits). Tools given `@playground` answer `no_bridge`
  / `no_session`, with hints to run `pnpm playground` or to pass a document
  path.
- **Tests.** `apps/studio/bridge/mcp-bridge.test.ts` covers tokens, Origin,
  Host and limits. `src/playground/mcp-bridge-{client,session}.test.ts` covers
  the tab side with fakes. `packages/mcp/src/playground.test.ts` covers the
  server side against a real bridge. `packages/mcp/src/bridge-e2e.test.ts`
  runs the whole chain: studio build under `vite preview` with the bridge,
  Chromium on `/playground`, then `scene_add_object` lands in the page as one
  undo step, a stale etag is a `conflict`, and the screenshot fails without
  WebGPU. It is skipped without the build or a Chromium.

## Blender parts (Phase 1)

An agent writes a new fixed-shape part as a `holodeck_bpy` script, builds it
in Blender headless, checks it against the part contract
([`blender/README.md`](../blender/README.md)), looks at it in the real
Holodeck style and installs it into the library. One Blender start per build
(a few seconds); no daemon.

```
blender_status ─▶ blender_build_part ─▶ part_validate ─▶ blender_preview ─▶ part_install
 found? gate?      parts/<name>.py,       contract check     Workbench PNG +    assets/models/<name>.glb
                   GLB + Workbench PNG    (one line per      styled render      + model map (index.ts)
                   in a scratch folder     problem)          (studio /render)
```

- **Gate.** `blender_build_part`, `blender_preview` and `part_install` need
  tier `exec` **and** `HOLODECK_MCP_ALLOW_BLENDER=1` in the server's
  environment: Blender runs arbitrary Python, so the tier alone is not
  enough. Below either, the tools stay listed and refuse with the reason
  (`tier` / `blender_disabled`). `blender_status` and `part_validate` are
  `read` and always work; `blender_status` says what is missing (it runs
  only `blender --version`, once per binary).
- **Blender.** `$BLENDER`, then `/Applications/Blender.app/Contents/MacOS/Blender`,
  then `blender` on PATH, the order of `build-parts.mjs` (a `$BLENDER` that
  does not exist is "not found", never a silent fall-through). The command
  line is the one `build-parts.mjs` runs, so a part built here is
  byte-identical to `pnpm parts:build` (`src/blender.test.ts` fails if the two
  drift): `-b --factory-startup --python-exit-code 1 --python
  blender/parts/<name>.py -- --out <scratch>.glb [--preview <scratch>.png]`,
  cwd `blender/`.
- **What it may touch** (`src/part-files.ts`). `blender_build_part` writes only
  `blender/parts/<name>.py`. The GLB and PNG go to a per-server scratch folder
  (`$TMPDIR/holodeck-mcp-parts-*`, removed when the server closes), never
  `assets/models`. `part_install` writes only
  `packages/editor-2.5d-react/assets/models/<name>.glb` and that folder's
  `index.ts`. `<name>` is lower-case words joined by `-` (like `brite-tank`),
  at most 48 characters, so it can never be a path, a hidden file or `..`;
  `cloud`, `index`, `brewery` and `holodeck-bpy` are reserved. Writes are a
  temp file plus a rename, never through a symlink, and only into folders
  whose real path is inside the repo. The repo is the one the package sits
  in, or `HOLODECK_MCP_REPO`.
- **Overwrites.** A name whose script or model already exists (a shipped
  part) needs `overwrite: true` (`destructiveHint`; git keeps the original).
  Scripts the same server session wrote rebuild freely, which is how the
  agent iterates. A failed build keeps its script and says so.
- **Running Blender** (`src/blender.ts`). Wall-clock timeout (default 120 s,
  5–600 s per call); on timeout or server shutdown the whole process group
  is killed with SIGKILL, so nothing a script forked survives. Output is kept
  to the last 64 KB; a result carries the last 60 lines, a failure the Python
  traceback. Blender gets a minimal environment (PATH, HOME, TMPDIR, locale,
  `PYTHONNOUSERSITE=1`): none of the server's tokens, and Blender ignores
  `PYTHON*` variables without `--python-use-system-env`. One Blender runs at a
  time; an install never overlaps a build. We never ask Blender for the
  network, but its Python could open sockets: that is what the env gate is
  for.
- **Contract check** (`src/glb.ts`, `part_validate`). Reads the GLB container
  and JSON chunk (no BIN decoding; bounds from the POSITION accessors'
  mandatory min/max through each node's world matrix), the approach of
  editor-2.5d-react's `src/models/glb-json.ts`. Problems: materials not
  `hd.*` (the style layer's own `finishForMaterialName`), primitives without a
  material, no `port.*` empty, `port.*` / `anim.*` that are meshes, ports with
  children, duplicate names, cameras, lights, animations, skins, textures,
  required extensions, non-triangle primitives, more than 5000 triangles
  (shipped parts use 520–840; `maxTriangles` per call), size outside
  0.05–5 units, anything below y = −1, nothing above the floor (exported
  Z-up?), and an origin (the placement anchor) more than 10 % of the part's
  size outside its box. Warnings: double-sided materials, optional
  extensions. Every shipped GLB passes (`src/glb.test.ts`). A failing build
  is still a successful `blender_build_part` (the problems are the point);
  `part_install` refuses it.
- **Styled preview.** `blender_preview` renders the GLB through the same
  path as `scene_render`: the studio build's `/render` route in headless
  Chromium. The route takes a model input
  (`{format: "holodeck.render-model.v1", url, footprint, height}`) and draws
  the GLB as a data-only part (`DataPart` + `applyHolodeckStyle`, default
  theme) in a one-object scene on a fresh registry (editor built-ins plus that
  part), fitted by the footprint and height the contract check measured. The
  page fetches the GLB from a fixed same-origin path that the capture answers
  from memory (`page.route`); the route refuses any other URL. No WebGPU, a
  timeout or a flat capture is an explicit error, never a blank image;
  `styled: false` returns the Workbench image alone. For an installed part
  the Workbench image is re-rendered from its script into scratch.
- **Install and registration.** The library's built-in GLBs are an explicit
  import map, `assets/models/index.ts` (`BUILTIN_MODEL_URLS`, kept explicit
  for tsup, holodeck#7). `part_install` regenerates it with
  `modelIndexSource` (`src/part-files.ts`), whose test pins that it
  reproduces the checked-in file byte for byte; if the file has hand edits
  the generator would drop, the install is refused before anything is
  copied. The parts page (`pnpm parts`) globs the folder and shows the part
  at once. `index.test.ts` in editor-2.5d-react now requires the shipped
  parts plus any new ones, instead of an exact list. An install also needs
  a build from this session whose script is unchanged since (else
  `conflict`: rebuild), and a clean contract check. Commit the script, the GLB
  and `index.ts` together; the asset contract test
  (`src/models/models-contract.test.ts`) fails while a script has no GLB or
  the reverse, so a build that is never installed should be deleted or
  installed before committing.
- **Tests.** `src/part-tools.test.ts` drives all five tools over MCP with a
  fake Blender (`src/test-glb.ts`: a Node script that copies a fixture GLB,
  fails with a traceback, hangs with a forked grandchild, or floods its
  output) in a throwaway repo: gates, names, overwrites, timeouts, failures,
  preview (with a fake renderer, including `unsupported`), install and the
  regenerated map. `src/blender.test.ts` covers discovery, the environment,
  log bounds and process-group kills; `src/glb.test.ts` the contract check on
  hand-built GLBs (one per violation). `src/blender-real.test.ts` builds,
  breaks, rebuilds (byte-identical), installs and previews a tiny part with
  the real Blender; it is skipped without Blender (CI has none) and its
  styled step without the studio build or a Chromium.

### Phase 2 (design only): a persistent Blender daemon

Only if Phase 1 latency hurts (each build pays Blender's ~2–7 s start).

- `blender -b --factory-startup --python blender/holodeck_daemon.py` stays up
  and listens on a loopback socket (127.0.0.1, random port), announced in a
  0600 file next to `.holodeck-mcp.json` with a random 256-bit token, the
  same scheme as the playground bridge (token compared in constant time, no
  `Origin`, loopback `Host`).
- Requests are framed JSON, one at a time: `run_part {name, source}` →
  `{glb (base64), preview?, log}`; `reset`; `inspect {object?}` (names,
  transforms, materials, bounds from `bpy`); `undo` / `redo`. The daemon
  executes the source with `holodeck_bpy` already imported and
  `reset_scene()` before each `run_part`, so builds stay byte-stable.
- Multi-step modelling: `begin_part` / `step {source}` / `commit` keep a
  scene alive across calls, with Blender's undo stack as history, so an
  agent can add one sub-assembly at a time and inspect the result.
- Gated behind `HOLODECK_MCP_BLENDER_DAEMON=1` on top of the Phase 1 gate. The
  MCP server starts it on first use, kills its process group on idle (as the
  render browser) and on shutdown, restarts it after a crash, and falls back
  to Phase 1 when it is off. Same per-request timeout: a hung request kills
  and restarts the daemon.
- The same `part_validate` / `part_install` and scratch rules apply; only the
  build transport changes. Risk to manage: state leaking between parts (a
  stale material or object), hence the forced `reset_scene()` and a
  byte-identity test against a cold `pnpm parts:build`.

### Phase 3 (design only): the "Holodeck Live" Blender add-on

For a person modelling in the Blender GUI who wants to see the real style
live.

- A Blender add-on (`blender/addons/holodeck_live/`) with a sidebar panel:
  part name, "Push" button, "Push on save" toggle. On push it runs
  `holodeck_bpy`'s checks (the `hd.*` material rule, no cameras or lights,
  the export flags) and exports the GLB to memory.
- It sends the GLB to the playground over the existing bridge as a new
  `preview-model` message (agent-side token from `.holodeck-mcp.json`;
  loopback only). The playground shows it styled in a "Live part" panel next
  to the scene, and can drop it into the scene as a temporary data-only part
  (never saved into a document until it is installed).
- The add-on never writes `assets/models`; installing stays `part_install`
  (or `pnpm parts:build`) so the contract check, the model map and git stay
  the single path into the library.
- Shared code: the add-on imports `holodeck_bpy` for validation and export
  flags, so GUI and headless builds produce the same bytes.

## Tiers

| Tier | Allows |
|---|---|
| `read` | library and scene inspection |
| `author` (default) | creating and editing documents under the root |
| `exec` | also running Blender: `blender_build_part`, `blender_preview`, `part_install`, which **also** need `HOLODECK_MCP_ALLOW_BLENDER=1` (see [Blender parts](#blender-parts-phase-1)) |

## Status

| Group | Tools | State |
|---|---|---|
| 1. Library + scenes | `parts_*`, `scene_*`, `holodeck_info` | done |
| 2. Headless render | `scene_render` | done |
| 3. Playground bridge | `playground_*`, `provider_*`, `@playground` path | done |
| 4. Blender Phase 1 | `blender_status`, `blender_build_part`, `part_validate`, `blender_preview`, `part_install` | done |
| 4b. Blender Phase 2 / 3 | daemon, "Holodeck Live" add-on | design only (above) |

Known gaps in group 1:

- Arcentry connectors (`connector` part, `draw-connector` tool) cannot be
  drawn yet: `scene_connect` draws pipes only.
- Layers, groups, copy and paste are not exposed. Grouped objects move and
  delete as a group.
