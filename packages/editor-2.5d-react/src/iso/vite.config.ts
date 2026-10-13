import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const MODELS_DIR = path.resolve(import.meta.dirname, '../../assets/models');

/**
 * Full-reload pages when `pnpm parts:watch` rewrites a GLB. Vite serves the
 * GLB as a static asset, so a rebuild never invalidates a module on its own.
 */
function reloadOnModelChange(): Plugin {
  return {
    name: 'holodeck-reload-on-model-change',
    configureServer(server) {
      server.watcher.add(MODELS_DIR);
      const reload = (file: string) => {
        if (file.startsWith(MODELS_DIR) && file.endsWith('.glb')) {
          server.ws.send({ type: 'full-reload' });
        }
      };
      server.watcher.on('add', reload);
      server.watcher.on('change', reload);
    },
  };
}

export default defineConfig({
  plugins: [reloadOnModelChange()],
  server: {
    host: '127.0.0.1',
    fs: { allow: [path.resolve(import.meta.dirname, '../..')] },
  },
  esbuild: { jsx: 'automatic' },
});
