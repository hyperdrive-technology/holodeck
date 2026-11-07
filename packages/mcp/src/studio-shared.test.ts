/**
 * Guard for src/studio.ts: the studio modules this server bundles (and
 * everything they import inside apps/studio) must stay pure TypeScript, so a
 * studio change cannot quietly break the Node server. Walks the relative
 * import graph from studio.ts and fails on React, bundler-only imports
 * (`?url`, CSS), browser storage libraries and .tsx files.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const ALLOWED_PACKAGES = new Set(['@holodeck/sdk', '@holodeck/editor-2.5d-react', '@holodeck/provider-http', '@holodeck/provider-aws']);

function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [
    // import x from 'y' / export { x } from 'y' (possibly over several lines)
    ...[...text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    // side-effect imports: import 'y'
    ...[...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!),
    // dynamic imports: import('y')
    ...[...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!),
  ];
}

function resolveTs(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

describe('the import scanner', () => {
  it('sees static, side-effect and dynamic imports', async () => {
    const { tempDir } = await import('./test-support');
    const { writeFile } = await import('node:fs/promises');
    const { dir, cleanup } = await tempDir();
    const file = resolve(dir, 'x.ts');
    await writeFile(file, "import a from 'pkg-a';\nexport { b } from './b';\nimport 'side-effect';\nconst c = await import('dyn');\n");
    expect(specifiers(file).sort()).toEqual(['./b', 'dyn', 'pkg-a', 'side-effect']);
    await cleanup();
  });
});

describe('shared studio modules', () => {
  it('import only pure modules and the allowed packages', () => {
    const seen = new Set<string>();
    const problems: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      if (file.endsWith('.tsx')) problems.push(`${file}: a .tsx module`);
      for (const spec of specifiers(file)) {
        if (spec.startsWith('.')) {
          if (/\?|\.css$/.test(spec)) problems.push(`${file}: bundler-only import ${spec}`);
          else visit(resolveTs(file, spec));
        } else if (!ALLOWED_PACKAGES.has(spec)) problems.push(`${file}: imports ${spec}`);
      }
    };
    for (const spec of specifiers(resolve(here, 'studio.ts'))) visit(resolveTs(resolve(here, 'studio.ts'), spec));
    expect([...seen].some((f) => f.endsWith('document-checks.ts'))).toBe(true);
    expect(problems).toEqual([]);
  });
});
