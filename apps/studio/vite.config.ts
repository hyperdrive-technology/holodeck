/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const EDITOR = '@holodeck/editor-2.5d-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': decodeURIComponent(new URL('./src', import.meta.url).pathname) },
    // The editor and the SDK are `file:` dependencies with their own
    // node_modules. One copy of each of these must exist at runtime: two Reacts
    // break hooks, two SDKs break `instanceof ContributionRegistry`, two threes
    // break R3F's object checks.
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '@holodeck/sdk'],
  },
  optimizeDeps: {
    // The editor's GLB URLs are `new URL('./models/x.glb', import.meta.url)`;
    // Vite dev pre-bundling rewrites them to 404s unless the package is
    // excluded (holodeck#28, packages/editor-2.5d-react/tsup.config.ts). Its
    // bare imports are then not scanned, hence the explicit include list.
    exclude: [EDITOR],
    include: ['@react-three/fiber', '@react-three/drei', 'three'],
  },
  build: {
    // three.js + R3F + the editor are ~2 MB minified; one chunk is fine for a
    // local-first app. Revisit with route-level code splitting (S2).
    chunkSizeWarningLimit: 2600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
