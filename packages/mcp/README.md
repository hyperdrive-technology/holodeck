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
| `scene_new` | author | Empty document or the playground starter (bound `holodeck.sim` connection) |
| `scene_add_object` | author | Place a part (palette defaults; inline parts attach to pipes); run parts from `x,y` to `to` |
| `scene_update_params` | author | Params (`null` = back to default) and placement fields (`fillColor`, `opacity`, `meta`...) |
| `scene_move` | author | Move like a canvas drag (attached pipes follow) and/or rotate in quarter turns |
| `scene_connect` | author | Pipe between two ports (or free cells), routed around obstacles, ports recorded |
| `scene_remove` | author | Delete objects; pipe ends on them are freed; groups go whole |
| `scene_bind` | author | Bind a param to a provider signal, or unbind (`null`) |

A tool above the server's tier is still listed, but it refuses and names the
tier it needs.

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
  `limit`); every input string and list is bounded by its schema
  (`src/limits.ts`).

Design notes, the playground bridge and the Blender flow: [`docs/MCP.md`](../../docs/MCP.md).

## Develop

```sh
pnpm type-check && pnpm exec vitest run && pnpm build && node ../../scripts/smoke-dist.mjs .
```

The package consumes the built `editor-2.5d-react`, `library-cloud`,
`provider-http` and `provider-aws` (`file:` deps, copied at install). Rebuild
them and run `pnpm install` again after changing them. In CI it runs inside
the `studio` job.
