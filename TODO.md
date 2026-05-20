# Starfleet Monorepo - TODO

**Repository Status**: 🔴 MAJOR WORK NEEDED - Basic structure exists, core functionality missing

## 📋 Completed ✅

- ✅ **Repository Structure**
  - ✅ Monorepo setup with packages/ directory
  - ✅ TypeScript configuration
  - ✅ Package structure for CLI, viewer-2d-react, and viewer-3d-react

- ✅ **Basic Package Scaffolding**
  - ✅ CLI package structure (`packages/cli/`)
  - ✅ 2D Viewer package structure (`packages/viewer-2d-react/`)
  - ✅ 3D Viewer package structure (`packages/viewer-3d-react/`) — R3F v10, WebGPU-ready
  - ✅ Template packages for importers/providers

## 🚨 Critical - CLI Implementation

### Commands Implementation 🔥
- [ ] **Complete generate command**
  - [x] Basic generate.ts structure exists
  - [ ] Fix TypeScript imports and linter errors
  - [ ] Implement importer discovery system
  - [ ] Add proper error handling and validation
  - [ ] Test with starfleet-importer-brainboard integration

- [ ] **Implement dev command**
  - [ ] Create `src/commands/dev.ts`
  - [ ] Vite development server integration
  - [ ] Hot reloading for scene files
  - [ ] Live preview with 2D viewer
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
  - [ ] Serve 2D viewer with scene preview
  - [ ] Hot reloading when input files change
  - [ ] WebSocket for live updates

## 🚨 Critical - 2D Viewer Implementation

### Core Viewer Component 🎯
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
  - [ ] StarfleetProvider.tsx - scene state management
  - [ ] useStarfleet.ts - scene data hook
  - [ ] useLayout.ts - layout calculations

### Package Dependencies 📦
- [ ] **Install required dependencies**
  - [ ] React and TypeScript types
  - [ ] SVG/Canvas rendering library (d3, konva, or custom)
  - [ ] Pan/zoom library (react-zoom-pan-pinch or similar)
  - [ ] State management (zustand or context)

## 🔄 Medium Priority - Integration & Polish

### CLI-Viewer Integration 🔗
- [ ] **Dev server integration**
  - [ ] Embed 2D viewer in dev server
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

### 3D Viewer (R3F + WebGPU) 🌐
- [x] **Package scaffolding** (`packages/viewer-3d-react/`)
  - [x] React Three Fiber v10 (`10.0.0-alpha.2`)
  - [x] `StarfleetCanvas` with `webgl` | `webgpu` | `auto` backends
  - [x] `StarfleetViewer3D` with scene graph rendering
  - [x] `@starfleet/viewer-3d-react/webgpu` subpath for TSL hooks
- [ ] **Full 3D scene implementation**
  - [ ] Rich node/edge types and labels
  - [ ] Layout from 2D positions / force layout in 3D
  - [ ] Selection, tooltips, status overlays

### Enhanced Viewer Features 🎨
- [ ] **Advanced rendering**
  - [ ] Animation support
  - [x] 3D preview mode (upgrade path) — `@starfleet/viewer-3d-react`
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

3. **🚨 CRITICAL: Implement 2D viewer core rendering**
   ```bash
   cd packages/viewer-2d-react
   # Implement actual scene rendering in StarfleetViewer2D.tsx
   ```

4. **🔧 HIGH: Test CLI integration with brainboard importer**
   ```bash
   # These commands must work:
   starfleet generate ../starfleet-importer-brainboard/examples/webapp/aws-3-tier-webapp.json
   starfleet dev ../starfleet-importer-brainboard/examples/webapp/aws-3-tier-webapp.json
   ```

5. **🔧 MEDIUM: Implement OpenAI visual testing workflow**
   - Create end-to-end test that uses all components together

## 🔗 Dependencies & Integration Points

### Internal Dependencies
- ✅ `@starfleet/sdk` (ready to use)
- 🔄 `starfleet-importer-brainboard` (ready, waiting for CLI)

### External Dependencies Needed
- [ ] **CLI package**:
  - commander, execa, chokidar, vite, zod, chalk, ora, inquirer, fs-extra, globby
- [ ] **Viewer package**:
  - react, react-dom, d3 or konva or custom SVG, zustand, @types/react

### Integration Points
- [ ] CLI must discover and load starfleet-importer-brainboard
- [ ] Dev server must serve viewer-2d-react component
- [ ] Viewer must render SceneFile from @starfleet/sdk

## 📊 Success Criteria

### CLI Success Criteria
- [ ] `starfleet generate` converts Brainboard JSON to Starfleet JSON
- [ ] `starfleet dev` launches development server with live preview
- [ ] `starfleet validate` validates scene files
- [ ] `starfleet info` shows scene file statistics
- [ ] CLI auto-discovers starfleet-importer-brainboard

### Viewer Success Criteria
- [ ] Renders Starfleet JSON as interactive 2D diagram
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
starfleet --help

# Viewer package
cd packages/viewer-2d-react
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
starfleet generate <input> [options]    # Convert file to Starfleet JSON
starfleet dev <input> [options]         # Development server with preview
starfleet validate <input> [options]    # Validate scene file
starfleet info <input> [options]        # Show scene file information
```

### Viewer Integration Architecture
```
Input File → CLI Generate → Starfleet JSON → 2D Viewer → Visual Output
           ↓
         Dev Server ← Hot Reload ← File Watcher
           ↓
         Browser Preview ← Live Updates ← WebSocket
```

### OpenAI Testing Flow
```
Brainboard JSON → CLI → Starfleet JSON → 2D Viewer → Screenshot → OpenAI Vision API → Similarity Score
```

## 🚨 Current Blockers

1. **Missing CLI dependencies** - Package installation fails
2. **Incomplete command implementations** - Only generate.ts partially done
3. **2D viewer is placeholder** - No actual rendering implementation
4. **No importer discovery** - CLI can't find installed importers
5. **No dev server** - No way to preview scenes in browser

**Bottom Line**: This monorepo needs significant implementation work before it can support the end-to-end workflow described in the project goals.
