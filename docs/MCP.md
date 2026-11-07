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

## Tiers

| Tier | Allows |
|---|---|
| `read` | library and scene inspection |
| `author` (default) | creating and editing documents under the root |
| `exec` | running local programs: Blender part builds (also needs `HOLODECK_MCP_ALLOW_BLENDER=1`) |

## Status

| Group | Tools | State |
|---|---|---|
| 1. Library + scenes | `parts_*`, `scene_*`, `holodeck_info` | done |
| 2. Headless render | `scene_render` | done |
| 3. Playground bridge | `playground_*`, `provider_*` | planned |
| 4. Blender Phase 1 | `blender_*`, `part_validate`, `part_install` | planned |

Known gaps in group 1:

- Arcentry connectors (`connector` part, `draw-connector` tool) cannot be
  drawn yet: `scene_connect` draws pipes only.
- Layers, groups, copy and paste are not exposed. Grouped objects move and
  delete as a group.
