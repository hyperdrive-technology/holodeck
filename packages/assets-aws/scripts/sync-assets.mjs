#!/usr/bin/env node
/**
 * Regenerate `assets/` from the official AWS Architecture Icons package and
 * the sibling library-cloud archetypes.
 *
 *   node scripts/sync-assets.mjs <dir containing Architecture-Service-Icons_*>
 *
 * Get the package from https://aws.amazon.com/architecture/icons/ (the exact
 * URL, version and checksum we last used are in src/icon-source.json). Extract
 * the zip into a NEW EMPTY directory and pass that directory here: downloaded
 * archives are untrusted, and every icon is sanitised before it is written.
 *
 * Adding a service = add a row to src/services.json, run this, commit assets/.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSvg, svgProblems, tileColour } from './svg-sanitize.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('usage: sync-assets.mjs <extracted AWS icon package dir>');
  process.exit(2);
}
const services = JSON.parse(readFileSync(join(root, 'src/services.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'src/categories.json'), 'utf8'));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__MACOSX') walk(path, out);
    } else out.push(path);
  }
  return out;
}
const byName = new Map();
for (const file of walk(source)) {
  if (/Arch_.*_64\.svg$/.test(file) && file.includes('Architecture-Service-Icons')) {
    const name = file.slice(file.lastIndexOf('/') + 1);
    byName.set(name, [...(byName.get(name) ?? []), file]);
  }
}

mkdirSync(join(root, 'assets/aws-icons'), { recursive: true });
mkdirSync(join(root, 'assets/models'), { recursive: true });
let failed = false;
for (const service of services) {
  const files = byName.get(`Arch_${service.icon}_64.svg`) ?? [];
  if (files.length !== 1) {
    console.error(`${service.slug}: expected exactly one Arch_${service.icon}_64.svg, found ${files.length}`);
    failed = true;
    continue;
  }
  const raw = readFileSync(files[0], 'utf8');
  const problems = svgProblems(raw);
  if (problems.length) {
    console.error(`${service.slug}: ${problems.join('; ')}`);
    failed = true;
    continue;
  }
  const svg = sanitizeSvg(raw);
  const colour = tileColour(svg);
  if (colour !== categories[service.category].color.toUpperCase()) problems.push(`tile colour ${colour} is not the ${service.category} category colour`);
  if (problems.length) {
    console.error(`${service.slug}: ${problems.join('; ')}`);
    failed = true;
    continue;
  }
  writeFileSync(join(root, 'assets/aws-icons', `${service.slug}.svg`), svg);
}
// Archetype models are vendored from library-cloud: a package cannot reference another
// package's assets through assetUrl (it refuses paths that leave the package).
for (const archetype of new Set(services.map((s) => s.archetype))) {
  copyFileSync(join(root, '../library-cloud/assets/models', `${archetype}.glb`), join(root, 'assets/models', `${archetype}.glb`));
}
if (failed) process.exit(1);
console.log(`synced ${services.length} icons and ${new Set(services.map((s) => s.archetype)).size} archetype models`);
