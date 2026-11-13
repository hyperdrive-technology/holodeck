/**
 * The agent skills shipped in `skills/` teach agents how to add parts in the
 * family style. They rot silently when a helper is renamed or a part is
 * removed, so this pins what they claim: frontmatter, relative links, the
 * `_common` helpers they name, the shipped parts they point at, and that the
 * template is a part script in the shape the rest expect.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROCESS_MODEL_SLUGS } from './models';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const skillsDir = join(packageDir, 'skills');
const common = readFileSync(resolve(packageDir, '../../blender/parts/process/_common.py'), 'utf8');
const text = (path: string) => readFileSync(path, 'utf8');
const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const markdownIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownIn(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []);
const allMarkdown = markdownIn(skillsDir);

describe('process agent skills', () => {
  it('ships the three skills', () => {
    expect(skills).toEqual(['process-part-add', 'process-part-verify', 'process-parts-batch']);
  });

  it.each(skills)('%s has frontmatter whose name is its directory and a usable description', (name) => {
    const body = text(join(skillsDir, name, 'SKILL.md'));
    const front = /^---\n([\s\S]*?)\n---\n/.exec(body)?.[1] ?? '';
    expect(front, 'SKILL.md must open with a --- frontmatter block').not.toBe('');
    expect(/^name: (.+)$/m.exec(front)?.[1]).toBe(name);
    const description = /^description: (.+)$/m.exec(front)?.[1] ?? '';
    expect(description.length).toBeGreaterThan(80);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it.each(allMarkdown.map((file) => [file.slice(skillsDir.length + 1), file] as const))(
    '%s only links to files that exist',
    (_name, file) => {
      const links = [...text(file).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!).filter((l) => !/^[a-z]+:/i.test(l));
      for (const link of links) expect(existsSync(resolve(dirname(file), link)), `${link} in ${file}`).toBe(true);
    },
  );

  it('only names _common helpers that exist', () => {
    const defined = new Set([...common.matchAll(/^(?:def|class) (\w+)|^([A-Z_]+) =/gm)].map((m) => m[1] ?? m[2]));
    const used = new Set<string>();
    for (const file of [...allMarkdown, join(skillsDir, 'process-part-add/part-template.py')]) {
      for (const m of text(file).matchAll(/\bc\.([A-Za-z_]\w*)/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(10);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('points at real shipped parts in the "Pick a reference part" table', () => {
    const guide = text(join(skillsDir, 'process-part-add/references/style-guide.md'));
    const section = /## Pick a reference part\n([\s\S]*?)\n## /.exec(guide)?.[1] ?? '';
    const named = section.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('| ---'))
      .slice(1).flatMap((row) => [...(row.split('|')[2] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!));
    expect(named.length).toBeGreaterThan(15);
    expect(named.filter((slug) => !PROCESS_MODEL_SLUGS.includes(slug))).toEqual([]);
  });

  it('keeps a template that is a part script in the shape the scripts share', () => {
    const template = text(join(skillsDir, 'process-part-add/part-template.py'));
    expect(template).toContain('import _common as c');
    expect(template).toContain('c.check(');
    expect(template).toMatch(/hd\.run_part\(build, "[\w-]+"\)/);
    expect(template).toContain('hd.add_anim(');
    // Not a part itself: it lives outside blender/parts/process, so no GLB is owed for it.
    expect(existsSync(resolve(packageDir, '../../blender/parts/process/example-part.py'))).toBe(false);
  });

  it('is published with the package', () => {
    const files = (JSON.parse(text(join(packageDir, 'package.json'))) as { files: string[] }).files;
    expect(files).toContain('skills/**/*');
  });
});
