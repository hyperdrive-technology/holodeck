/**
 * The `./contracts` entry (holodeck#137) must stay dependency-light and keep
 * its public names. Sibling packages' tests (library-cloud, assets-aws) run in
 * CI jobs that never install React or three, so a runtime import of either
 * here would break them; this walks the real source graph to catch it here.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as contracts from './contracts';
import * as main from './index';
import { HOLODECK_STYLE } from '../assets/process/style';
import { ISO_KINDS, isIsoPartDefinition, isIsoTheme } from './registry/kinds';

const ENTRY = fileURLToPath(new URL('./contracts.ts', import.meta.url));
const ALLOWED_BARE = new Set(['@holodeck/sdk']);

/**
 * Runtime module specifiers of one TS file: `import … from`, `export … from`
 * and side-effect `import '…'`, minus `import type` / `export type`, which
 * TypeScript erases. Inline `type` markers (`import { type X, Y }`) still
 * leave a runtime import of the module, so they count. Parsed with the
 * TypeScript compiler API rather than a regex, so multi-line and commented
 * imports are handled the way tsc sees them.
 */
function runtimeSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: string[] = [];
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node)) {
      if (node.importClause?.isTypeOnly) continue;
      out.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) continue;
      out.push((node.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return out;
}

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  const found = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), base].find((c) => existsSync(c) && statSync(c).isFile());
  if (!found) throw new Error(`cannot resolve ${spec} from ${from}`);
  return found;
}

/** Every bare (package) specifier reachable at runtime from `entry`. */
function runtimePackages(entry: string): { packages: Set<string>; files: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of runtimeSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) queue.push(resolveRelative(file, spec));
      else packages.add(spec);
    }
  }
  return { packages, files };
}

describe('runtimeSpecifiers', () => {
  it('keeps value imports and re-exports, drops type-only ones', () => {
    const src = [
      "import { a, type B } from './a';",
      "import type { C } from 'react';",
      "export type { D } from 'three';",
      "export { e } from './e';",
      "import './side-effect';",
      'import {\n  f,\n  g,\n} from "@holodeck/sdk";',
    ].join('\n');
    expect(runtimeSpecifiers(src)).toEqual(['./a', './e', './side-effect', '@holodeck/sdk']);
  });
});

describe('@holodeck/editor-2.5d-react/contracts', () => {
  it('reaches no package but @holodeck/sdk at runtime (no React, three or R3F)', () => {
    const { packages, files } = runtimePackages(ENTRY);
    expect([...packages].filter((p) => !ALLOWED_BARE.has(p))).toEqual([]);
    // Sanity: the walk really followed the re-exports.
    expect(files.size).toBeGreaterThan(2);
  });

  it('exports the validators and style that sibling packages use', () => {
    expect(contracts.ISO_KINDS).toBe(ISO_KINDS);
    expect(contracts.isIsoPartDefinition).toBe(isIsoPartDefinition);
    expect(contracts.isIsoTheme).toBe(isIsoTheme);
    expect(contracts.HOLODECK_STYLE).toBe(HOLODECK_STYLE);
    expect(Object.keys(contracts).sort()).toEqual(
      [
        'HOLODECK_STYLE',
        'ISO_ANIMATOR_KIND',
        'ISO_INSPECTOR_KIND',
        'ISO_KINDS',
        'ISO_PART_KIND',
        'ISO_THEME_KIND',
        'isIsoAnimator',
        'isIsoInspectorPanel',
        'isIsoPartDefinition',
        'isIsoTheme',
        'isParamSpec',
      ].sort(),
    );
  });

  it('is a subset of the main entry, with the same objects', () => {
    for (const [name, value] of Object.entries(contracts)) {
      expect((main as Record<string, unknown>)[name], name).toBe(value);
    }
  });
});
