# @holodeck/mcp

An [MCP](https://modelcontextprotocol.io) server for Holodeck. Agents browse
the part library and build scenes (`holodeck.document.v1` files,
`.holodeck.json`) with the same rules the studio applies. Every edit runs
through the editor's own reducer and is validated as a studio save would be.
An invalid edit is refused, every problem is listed, and nothing is written.

No PLC or Hyperdrive code: this is a plain Holodeck host.

## Run it

```sh
cd packages/mcp && CI=true pnpm install && pnpm build
HOLODECK_MCP_ROOT=~/screens node dist/cli.js      # stdio server
```

To register it for a client (`.mcp.json`, project scope):

```json
{
  "mcpServers": {
    "holodeck": {
      "command": "node",
      "args": ["/abs/path/holodeck/packages/mcp/dist/cli.js"],
      "env": { "HOLODECK_MCP_ROOT": "/abs/path/screens", "HOLODECK_MCP_TIER": "author" }
    }
  }
}
```

| Variable | Default | Meaning |
|---|---|---|
| `HOLODECK_MCP_ROOT` | current directory | The only folder documents are read from or written to |
| `HOLODECK_MCP_TIER` | `author` | `read`, `author` or `exec` (see below). Any other value fails at startup |
| `HOLODECK_CHROMIUM` | macOS Chrome, then Playwright's Chromium | Browser for `scene_render` |
| `HOLODECK_MCP_BRIDGE_FILE` | `.holodeck-mcp.json` at the holodeck repo root | Playground bridge file that `pnpm playground` writes (URL + agent token) |
| `HOLODECK_STUDIO_DIST` | `apps/studio/dist` next to this package | Studio build that `scene_render` and `blender_preview` serve (`cd apps/studio && pnpm build`) |
| `HOLODECK_MCP_ALLOW_BLENDER` | unset (off) | `1` lets the Blender tools run Blender (they also need `HOLODECK_MCP_TIER=exec`) |
| `BLENDER` | macOS `/Applications/Blender.app`, then `blender` on PATH | Blender binary (tested with 5.2.2 LTS) |
| `HOLODECK_MCP_REPO` | the holodeck repo this package sits in | Repo whose `blender/parts/` and `assets/models/` the Blender tools use |

## Tools

| Tool | Tier | What it does |
|---|---|---|
| `holodeck_info` | read | Root, tier, installed engines, packages and providers |
| `parts_list` | read | Library search (same matching as the studio sidebar), paged |
| `parts_get` | read | One part's contract: params (type, default, range, options), ports, anim nodes, footprint |
| `scene_list` | read | `.holodeck.json` files under the root |
| `scene_open` | read | Validate a document and make it the default for later calls |
| `scene_get` | read | Summary or full JSON, optionally only some objects; returns the `etag` |
| `scene_validate` | read | Studio import checks on a file or a JSON value |
| `scene_export` | read (author to write `out`) | Validated document JSON or the components CSV |
| `scene_render` | read (author to write `out`) | PNG of the document as the studio draws it (headless Chromium + WebGPU), returned as image content |
| `scene_new` | author | Empty document or the playground starter (bound `holodeck.sim` connection) |
| `scene_add_object` | author | Place a part (palette defaults; inline parts attach to pipes); run parts from `x,y` to `to` |
| `scene_update_params` | author | Params (`null` = back to default) and placement fields (`fillColor`, `opacity`, `meta`...) |
| `scene_move` | author | Move like a canvas drag (attached pipes follow) and/or rotate in quarter turns |
| `scene_connect` | author | Pipe between two ports (or free cells), routed around obstacles, ports recorded |
| `scene_remove` | author | Delete objects; pipe ends on them are freed; groups go whole |
| `scene_bind` | author | Bind a param to a provider signal, or unbind (`null`) |
| `playground_status` | read | Is `pnpm playground` running with its bridge, which tabs are connected (never an error) |
| `playground_state` | read | The live tab's scene (saved or not), etag, active tab, save status, selection, connection states, live values |
| `playground_screenshot` | read (author to write `out`) | PNG of the live canvas (current camera, live values) |
| `provider_list` | read | Installed providers: capabilities, source syntax, secret-free config schema, secrets the user enters |
| `provider_connect` | author | Add or replace a secret-free connection (the studio's credential rules) |
| `provider_browse` | read | A connection's signal tree; on a file only the offline simulator, on `@playground` the tab's live session |
| `blender_status` | read | Blender found (path, version)? Gate open? Part scripts, installed models, this session's builds (never an error) |
| `blender_build_part` | exec + `HOLODECK_MCP_ALLOW_BLENDER=1` | Write `blender/parts/<name>.py`, run Blender headless (timeout), GLB to a scratch folder; returns the contract check, the log tail and the Workbench PNG |
| `part_validate` | read | The part contract on a build or an installed model: one line per problem (materials, ports, cameras/lights, triangles, size, floor, anchor, Y-up) |
| `blender_preview` | exec + `HOLODECK_MCP_ALLOW_BLENDER=1` | Workbench PNG plus the GLB in the real Holodeck style (studio `/render`, WebGPU); no WebGPU is an error |
| `part_install` | exec + `HOLODECK_MCP_ALLOW_BLENDER=1` | Copy a validated build to `assets/models/<name>.glb` and register it in the model map (`index.ts`) |

`path: "@playground"` makes any `scene_*` edit tool (and `provider_*`) work on
the scene open in the playground tab: one undo step per call, refused with
`conflict` when the user edited since your read. See
[`docs/MCP.md`](../../docs/MCP.md#playground-bridge).

A tool above the server's tier is still listed, but it refuses and names the
tier it needs. The Blender tools that run Blender need tier `exec` **and**
`HOLODECK_MCP_ALLOW_BLENDER=1` (Blender runs arbitrary Python); without the
variable they refuse with `blender_disabled`.

## Blender parts

```sh
HOLODECK_MCP_TIER=exec HOLODECK_MCP_ALLOW_BLENDER=1 node dist/cli.js
```

`blender_status` → `blender_build_part` (a `holodeck_bpy` script; copy the
header of `blender/parts/valve.py`) → fix what `part_validate` lists →
`blender_preview` → `part_install`, then commit `blender/parts/<name>.py`,
`assets/models/<name>.glb` and `assets/models/index.ts`. Part names are
lower-case words joined by `-` (`plate-heat-exchanger`); an existing part is
only replaced with `overwrite: true`. Builds run one at a time with a
wall-clock timeout (the process group is killed), Blender gets a minimal
environment, and GLBs stay in a scratch folder until installed. Details,
safety rules and the Phase 2 (daemon) / Phase 3 (add-on) designs:
[`docs/MCP.md`](../../docs/MCP.md#blender-parts-phase-1).

## Guarantees

- **Paths**: relative to the root, ending in `.holodeck.json` (exports may also
  write `.components.csv`). The server refuses absolute paths, `..`, NUL,
  hidden segments and `node_modules`. It also refuses symlinks (file or folder)
  that resolve outside the root. Writes are atomic: a temp file, then a rename.
- **Concurrency**: each result carries an `etag`. If you pass it back, the
  edit is refused when the file changed in the meantime. Edits of one
  document run one at a time in the server, so concurrent calls all apply. A
  save re-checks the version under a per-file lock. A new file is created
  with no-clobber semantics, so it never replaces one that appeared
  meanwhile.
- **Acknowledgements never fail after a write**: if an edit's details are
  too large to return, you get the ids, and `scene_get` reads the rest.
- **Validation**: the studio's own checks, bundled from `apps/studio/src`
  (`src/studio.ts`): envelope, engine, `requires`, body against the installed
  parts, bindings, and the credential rules (no secrets in connection configs,
  labels or binding sources). `requires` is recomputed on every save.
- **All or nothing**: if the editor rejects one step of a call (for example a
  param out of range), the whole call fails.
- **Size bounds**: documents up to 20 MB (the studio import limit); results up
  to 256k characters (narrow the request with `objectIds`, `view: "summary"`,
  `limit`); `scene_render` images up to 3 MB of PNG (bigger is `too_large`:
  pass `out` to write the file instead, or render smaller); every input
  string and list is bounded by its schema
  (`src/limits.ts`).

## Rendering

`scene_render` serves the built studio on a loopback-only port and opens its
`/render` route in headless Chromium. The route takes the document from a
global the server injects before load, never from a URL or a message. The
server waits for the engine's `data-render-state` and screenshots the
viewport. These cases are errors with a reason, never a blank PNG:

- no WebGPU (`unsupported`)
- the studio refuses the document
- a timeout
- a capture of one flat colour

One browser starts on first use. Renders run one at a time. The browser
closes after 2 idle minutes, when the client disconnects, or on SIGINT /
SIGTERM; renders still queued then fail with `closed` and the one in
progress is aborted. A browser that crashes or is killed is forgotten and
the next render starts a new one.

A PNG over 3 MB (`MAX_IMAGE_BYTES`, 4 MB as base64) is not put in the tool
result: without `out` it is a `too_large` error; with `out` the file is
written and the result carries only its metadata (`inline: false`).

Design notes, the playground bridge and the Blender flow: [`docs/MCP.md`](../../docs/MCP.md).

## Develop

```sh
pnpm type-check && pnpm exec vitest run && pnpm build && node ../../scripts/smoke-dist.mjs .
```

The package consumes the built `editor-2.5d-react`, `library-cloud`,
`provider-http` and `provider-aws` (`file:` deps, copied at install). Rebuild
them and run `pnpm install` again after changing them. In CI it runs inside
the `studio` job.
