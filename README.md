# Holodeck

Open-source **HMI and scene tooling** for Hyperdrive. **Languages:** browser TypeScript (React packages); native services stay in Rust [`core`](../core/). See [LANGUAGE_POLICY.md](../LANGUAGE_POLICY.md).

## In this repo (`packages/`)

| Package | npm | Role |
|---------|-----|------|
| `cli` | `@holodeck/cli` | `holodeck generate`, `dev`, `validate`, `info` |
| `editor-2d-react` | `@holodeck/editor-2d-react` | Editable 2D diagram editor (React Flow) — **evolved from the original `viewer-2d-react` scaffold** |
| `viewer-3d-react` | `@holodeck/viewer-3d-react` | Read-only 3D scene viewer (R3F scaffold) |

## External extensions (sibling repos)

Importers, providers, and commercial asset tiers live **outside** this monorepo, e.g.:

- [`holodeck-importer-brainboard`](../holodeck-importer-brainboard/) — `@holodeck-pro/importer-brainboard`
- Future: `@holodeck/provider-hyperdrive`, `@holodeck/importer-tf`, `@holodeck-pro/*` gated assets

All extensions depend on `@holodeck/sdk` only (open packages never hard-depend on `@holodeck-pro/*`).

## Layout

```
holodeck/
├── packages/
│   ├── cli/
│   ├── editor-2d-react/    # was viewer-2d-react
│   └── viewer-3d-react/
└── examples/
```

## Development

```bash
cd packages/cli && pnpm install && pnpm build
cd ../editor-2d-react && pnpm install && pnpm type-check
cd ../viewer-3d-react && pnpm install && pnpm type-check
```

See [ROADMAP.md](./ROADMAP.md) for phased plan and [TODO.md](./TODO.md) for implementation status.
