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

## Tiers

| Tier | Allows |
|---|---|
| `read` | library and scene inspection |
| `author` (default) | creating and editing documents under the root |
| `exec` | reserved for group 4 (Blender part builds, which will also need `HOLODECK_MCP_ALLOW_BLENDER=1`); no tool uses it yet |

## Status

| Group | Tools | State |
|---|---|---|
| 1. Library + scenes | `parts_*`, `scene_*`, `holodeck_info` | done |
| 2. Headless render | `scene_render` | done |
| 3. Playground bridge | `playground_*`, `provider_*`, `@playground` path | done |
| 4. Blender Phase 1 | `blender_*`, `part_validate`, `part_install` | planned |

Known gaps in group 1:

- Arcentry connectors (`connector` part, `draw-connector` tool) cannot be
  drawn yet: `scene_connect` draws pipes only.
- Layers, groups, copy and paste are not exposed. Grouped objects move and
  delete as a group.
