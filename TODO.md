# Holodeck Monorepo - TODO

**Repository Status**: 🔴 MAJOR WORK NEEDED - Basic structure exists, core functionality missing

## 📋 Completed ✅

- ✅ **Repository Structure**
  - ✅ Monorepo setup with packages/ directory
  - ✅ TypeScript configuration
  - ✅ Package structure for CLI, editor-2d-react, and viewer-3d-react

- ✅ **Basic Package Scaffolding**
  - ✅ CLI package structure (`packages/cli/`)
  - ✅ 2D Editor package structure (`packages/editor-2d-react/`, renamed from viewer-2d-react)
  - ✅ 3D Viewer package structure (`packages/viewer-3d-react/`)
  - External importers/providers remain in sibling repos

## 🚨 Critical - CLI Implementation

### Commands Implementation 🔥
- [ ] **Complete generate command**
  - [x] Basic generate.ts structure exists
  - [ ] Fix TypeScript imports and linter errors
  - [ ] Implement importer discovery system
  - [ ] Add proper error handling and validation
  - [ ] Test with holodeck-importer-brainboard integration

- [ ] **Implement dev command**
  - [ ] Create `src/commands/dev.ts`
  - [ ] Vite development server integration
  - [ ] Hot reloading for scene files
  - [ ] Live preview with 2D editor
  - [ ] File watching with chokidar

- [ ] **Implement validate command**
  - [ ] Create `src/commands/validate.ts`
  - [ ] JSON schema validation
  - [ ] Importer-specific validation
  - [ ] Error reporting and suggestions

- [ ] **Implement info command**
  - [ ] Create `src/commands/info.ts`
  - [ ] Scene file analysis and statistics
  - [ ] Metadata display
  - [ ] Resource counting and breakdown

### CLI Core Infrastructure 🛠️
- [ ] **Package management**
  - [ ] Install dependencies (commander, execa, chokidar, vite, etc.)
  - [ ] Fix package.json configuration
  - [ ] Add missing TypeScript types
  - [ ] Build configuration with tsup

- [ ] **Importer discovery system**
  - [ ] Create `src/utils/discovery.ts`
  - [ ] Auto-detect installed importer packages
  - [ ] Dynamic loading of importer modules
  - [ ] Plugin registration and management

- [ ] **Development server**
  - [ ] Vite integration for dev command
  - [ ] Serve 2D editor with scene preview
  - [ ] Hot reloading when input files change
  - [ ] WebSocket for live updates

## 🚨 Critical - 2D Editor Implementation

### Core Editor Component 🎯
- [ ] **Replace placeholder implementation**
  - [x] Basic component structure exists
  - [ ] Implement actual scene rendering
  - [ ] SVG-based or Canvas-based rendering
  - [ ] Node and edge visualization
  - [ ] Interactive pan/zoom controls

### Scene Rendering Engine 🖼️
- [ ] **Scene graph rendering**
  - [ ] Node rendering with proper positioning
  - [ ] Edge/connection rendering
  - [ ] Material and color application
  - [ ] Bounds calculation and fitting

- [ ] **Interactive features**
  - [ ] Pan and zoom controls
  - [ ] Node selection and highlighting
  - [ ] Edge selection and highlighting
  - [ ] Context menus and tooltips

### Supporting Components 🧩
- [ ] **Complete stub components**
  - [ ] NodeRenderer.tsx - proper implementation
  - [ ] EdgeRenderer.tsx - proper implementation
  - [ ] ViewerControls.tsx - zoom, pan, reset controls
  - [ ] ViewerMinimap.tsx - overview navigation

- [ ] **Provider and hooks**
  - [ ] HolodeckProvider.tsx - scene state management
  - [ ] useHolodeck.ts - scene data hook
  - [ ] useLayout.ts - layout calculations

### Package Dependencies 📦
- [ ] **Install required dependencies**
  - [ ] React and TypeScript types
  - [ ] SVG/Canvas rendering library (d3, konva, or custom)
  - [ ] Pan/zoom library (react-zoom-pan-pinch or similar)
  - [ ] State management (zustand or context)

## 🚨 Critical - 3D Viewer Implementation (`viewer-3d-react`)

- [ ] **R3F canvas scaffold**
  - [x] Package + `HolodeckViewer3D` placeholder
  - [ ] Scene graph → Three.js meshes from `SceneFile`
  - [ ] Orbit controls, fit-to-scene, node pick → `onNodeSelect`
  - [ ] Live-data coloring via provider hooks (pairs with `@holodeck/provider-hyperdrive`)

## 🔄 Medium Priority - Integration & Polish

### CLI-Viewer Integration 🔗
- [ ] **Dev server integration**
  - [ ] Embed 2D editor in dev server
  - [ ] Live preview updates
  - [ ] Error display and debugging tools

### Testing Infrastructure 🧪
- [ ] **CLI command testing**
  - [ ] Unit tests for each command
  - [ ] Integration tests with real importers
  - [ ] E2E testing with sample files

- [ ] **Viewer component testing**
  - [ ] React component tests
  - [ ] Visual regression testing
  - [ ] Interaction testing

### Documentation 📚
- [ ] **CLI documentation**
  - [ ] Command reference
  - [ ] Usage examples
  - [ ] Integration guides

- [ ] **Viewer documentation**
  - [ ] Component API reference
  - [ ] Customization guides
  - [ ] Integration examples

## 🔄 Low Priority - Advanced Features

### Enhanced Viewer Features 🎨
- [ ] **Advanced rendering**
  - [ ] Animation support
  - [ ] 3D preview mode (upgrade path)
  - [ ] Custom themes and styling
  - [ ] Export capabilities (PNG, SVG)

### CLI Extensions 🔧
- [ ] **Additional commands**
  - [ ] Export command for different formats
  - [ ] Batch processing support
  - [ ] Configuration management
  - [ ] Plugin management

### Performance Optimization 🚀
- [ ] **Large scene handling**
  - [ ] Virtualization for large diagrams
  - [ ] Progressive loading
  - [ ] Memory optimization

## 🎯 Next Actions (Priority Order)

1. **🚨 CRITICAL: Fix CLI package dependencies and build**
   ```bash
   cd packages/cli
   pnpm install  # Install missing dependencies
   pnpm build    # Fix build errors
   ```

2. **🚨 CRITICAL: Complete CLI commands implementation**
   ```bash
   # Must implement:
   # - src/commands/dev.ts
   # - src/commands/validate.ts
   # - src/commands/info.ts
   # - src/utils/discovery.ts
   ```

3. **🚨 CRITICAL: Implement 2D editor core rendering**
   ```bash
   cd packages/editor-2d-react
   # Implement actual scene rendering in HolodeckEditor2D.tsx
   ```

4. **🔧 HIGH: Test CLI integration with brainboard importer**
   ```bash
   # These commands must work:
   holodeck generate ../holodeck-importer-brainboard/examples/webapp/aws-3-tier-webapp.json
   holodeck dev ../holodeck-importer-brainboard/examples/webapp/aws-3-tier-webapp.json
   ```

5. **🔧 MEDIUM: Implement OpenAI visual testing workflow**
   - Create end-to-end test that uses all components together

## 🔗 Dependencies & Integration Points

### Internal Dependencies
- ✅ `@holodeck/sdk` (ready to use)
- 🔄 `holodeck-importer-brainboard` (ready, waiting for CLI)

### External Dependencies Needed
- [ ] **CLI package**:
  - commander, execa, chokidar, vite, zod, chalk, ora, inquirer, fs-extra, globby
- [ ] **Viewer package**:
  - react, react-dom, d3 or konva or custom SVG, zustand, @types/react

### Integration Points
- [ ] CLI must discover and load holodeck-importer-brainboard
- [ ] Dev server must serve editor-2d-react component
- [ ] Viewer must render SceneFile from @holodeck/sdk

## 📊 Success Criteria

### CLI Success Criteria
- [ ] `holodeck generate` converts Brainboard JSON to Holodeck JSON
- [ ] `holodeck dev` launches development server with live preview
- [ ] `holodeck validate` validates scene files
- [ ] `holodeck info` shows scene file statistics
- [ ] CLI auto-discovers holodeck-importer-brainboard

### Viewer Success Criteria
- [ ] Renders Holodeck JSON as interactive 2D diagram
- [ ] Supports pan, zoom, and selection
- [ ] Matches visual output of reference PNG
- [ ] Integrates with dev server for live preview
- [ ] Passes OpenAI visual similarity test (>80%)

## 🔧 Development Commands

```bash
# CLI package
cd packages/cli
pnpm install
pnpm build
pnpm test

# Test CLI globally
pnpm link --global
holodeck --help

# Viewer package
cd packages/editor-2d-react
pnpm install
pnpm build
pnpm test
pnpm storybook  # Once implemented

# Monorepo commands
pnpm install      # Install all package dependencies
pnpm build        # Build all packages
pnpm test         # Test all packages
```

## 📝 Implementation Notes

### CLI Command Structure
```bash
holodeck generate <input> [options]    # Convert file to Holodeck JSON
holodeck dev <input> [options]         # Development server with preview
holodeck validate <input> [options]    # Validate scene file
holodeck info <input> [options]        # Show scene file information
```

### Viewer Integration Architecture
```
Input File → CLI Generate → Holodeck JSON → 2D Editor → Visual Output
           ↓
         Dev Server ← Hot Reload ← File Watcher
           ↓
         Browser Preview ← Live Updates ← WebSocket
```

### OpenAI Testing Flow
```
Brainboard JSON → CLI → Holodeck JSON → 2D Editor → Screenshot → OpenAI Vision API → Similarity Score
```

## 🚨 Current Blockers

1. **Missing CLI dependencies** - Package installation fails
2. **Incomplete command implementations** - Only generate.ts partially done
3. **2D editor is placeholder** - No actual rendering implementation
4. **No importer discovery** - CLI can't find installed importers
5. **No dev server** - No way to preview scenes in browser

**Bottom Line**: This monorepo needs significant implementation work before it can support the end-to-end workflow described in the project goals.
