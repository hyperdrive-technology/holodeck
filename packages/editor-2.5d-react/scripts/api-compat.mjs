// Public API compatibility check of this package's BUILT declarations against
// another build (normally main). Third review of #228: type breaks were found
// one by one; this lists them all at once.
//
//   1. Build the baseline (e.g. a worktree of origin/main): `pnpm build` there.
//   2. mkdir -p artifacts/api/main artifacts/api/head
//      cp <baseline>/packages/editor-2.5d-react/dist/*.d.ts artifacts/api/main/
//      pnpm build && cp dist/*.d.ts artifacts/api/head/
//   3. node scripts/api-compat.mjs [index|contracts|holodeck-package]
//
// Reports removed exports, and for every export: TYPE main -> head (a value
// typed against main still fits; e.g. no newly required field) and head ->
// main (what we hand out still satisfies main's type); VALUE: typeof head
// assignable to typeof main (head stands in for main). Generic types are
// listed for a manual look. artifacts/ is gitignored. Exit code 1 on a break.
//  - for every exported VALUE: typeof head assignable to typeof main (head can stand in for main)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const pkgDir = new URL('..', import.meta.url).pathname;
const entry = process.argv[2] ?? 'index';
const require = createRequire(join(pkgDir, 'package.json'));
const ts = require('typescript');
const dir = join(pkgDir, 'artifacts/api');
const opts = { strict: true, skipLibCheck: true, noEmit: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, types: [] };
function exportsOf(file) {
  const p = ts.createProgram([file], opts);
  const c = p.getTypeChecker();
  const sf = p.getSourceFile(file);
  const out = new Map();
  for (const s of c.getExportsOfModule(c.getSymbolAtLocation(sf))) {
    const t = s.flags & ts.SymbolFlags.Alias ? c.getAliasedSymbol(s) : s;
    const isType = !!(t.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) && !(t.flags & ts.SymbolFlags.Value);
    const isValue = !!(t.flags & ts.SymbolFlags.Value);
    const decl = t.declarations?.[0];
    const generic = !!(decl && decl.typeParameters && decl.typeParameters.length);
    out.set(s.name, { isType, isValue, generic, alsoType: !!(t.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)) });
  }
  return out;
}
const m = exportsOf(join(dir, 'main', `${entry}.d.ts`));
const h = exportsOf(join(dir, 'head', `${entry}.d.ts`));
const removed = [...m.keys()].filter((k) => !h.has(k));
const added = [...h.keys()].filter((k) => !m.has(k));
console.log(`exports main=${m.size} head=${h.size}`);
console.log('REMOVED:', removed.join(', ') || '(none)');
console.log('added:', added.join(', ') || '(none)');
const lines = [`import type * as M from './main/${entry}';`, `import type * as H from './head/${entry}';`, `import * as MV from './main/${entry}';`, `import * as HV from './head/${entry}';`, 'declare function ok<T>(): T;'];
const generics = [];
for (const [name, me] of m) {
  const he = h.get(name);
  if (!he) continue;
  if (me.isType && !me.isValue) {
    if (me.generic) { generics.push(name); continue; }
    lines.push(`// type ${name}`, `export const in_${name}: H.${name} = ok<M.${name}>();`, `export const out_${name}: M.${name} = ok<H.${name}>();`);
  } else if (me.isValue) {
    lines.push(`// value ${name}`, `export const val_${name}: typeof MV.${name} = HV.${name};`);
  }
}
const probe = join(dir, `compat-${entry}.ts`);
writeFileSync(probe, lines.join('\n') + '\n');
const p = ts.createProgram([probe], opts);
const diags = ts.getPreEmitDiagnostics(p).filter((d) => d.file && d.file.fileName === probe);
const byLine = new Map();
for (const d of diags) {
  const { line } = d.file.getLineAndCharacterOfPosition(d.start);
  const src = d.file.text.split('\n')[line];
  const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n').slice(0, 4).join(' | ');
  byLine.set(src, msg.slice(0, 600));
}
console.log(`\nBREAKS (${byLine.size}):`);
for (const [src, msg] of byLine) console.log(`- ${src.replace(/^export const /, '').slice(0, 90)}\n    ${msg}`);
console.log('\ngeneric types not checked (inspect by hand):', generics.join(', ') || '(none)');
process.exitCode = removed.length || byLine.size ? 1 : 0;
