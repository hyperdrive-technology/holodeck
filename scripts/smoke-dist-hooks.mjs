/**
 * `--import` preload for smoke-dist.mjs: stubs bundler-only side-effect
 * imports (CSS) as empty modules so a built package can be loaded in plain
 * Node. Synchronous `module.registerHooks` covers both `import` and
 * `require` in the same process (Node >= 23.5; this repo pins Node 26).
 */
import { registerHooks } from 'node:module';

const BUNDLER_ONLY = /\.(css|scss|less)$/;

registerHooks({
  load(url, context, nextLoad) {
    if (BUNDLER_ONLY.test(new URL(url).pathname)) {
      return { format: context.format === 'module' ? 'module' : 'commonjs', source: '', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
