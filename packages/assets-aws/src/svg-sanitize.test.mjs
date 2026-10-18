import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it } from 'vitest';
import { MAX_ICON_BYTES, sanitizeSvg, svgProblems, tileColour } from '../scripts/svg-sanitize.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const svg = (body, attrs = '') => `<svg xmlns="${SVG}" ${attrs}>${body}</svg>`;
const use = (href) => svg(`<use ${href}/>`);
const xlink = (href) => svg(`<use ${href}/>`, `xmlns:xlink="${XLINK}"`);

const rejected = [
  ['slash-separated onload', '<svg/onload="alert(1)">'],
  ['slash-separated onload with namespace', `<svg xmlns="${SVG}"/onload="alert(1)"/>`],
  ['onload immediately after closing quote', `<svg xmlns="${SVG}" width="80"onload="alert(1)"></svg>`],
  ['event handler', svg('', 'onload="alert(1)"')],
  ['mixed-case event handler', svg('', 'oNlOaD="alert(1)"')],
  ['script', svg('<script>alert(1)</script>')],
  ['mixed-case script', svg('<ScRiPt>alert(1)</ScRiPt>')],
  ['prefixed script', svg(`<svg:script xmlns:svg="${SVG}">alert(1)</svg:script>`)],
  ['prefixed SVG root', `<svg:svg xmlns:svg="${SVG}"/>`],
  ['prefixed allowed element', svg(`<s:path xmlns:s="${SVG}" d="M0 0"/>`)],
  ['unbound prefix', svg('<s:path/>')],
  ['CDATA', svg('<![CDATA[<script>alert(1)</script>]]>')],
  ['xml-stylesheet PI after the declaration', `<?xml version="1.0"?><?xml-stylesheet href="https://evil.test/x.css"?>${svg('')}`],
  ['second XML declaration inside the document', svg('<?xml version="1.0"?>')],
  ['XML declaration not at the start', ` x<?xml version="1.0"?>${svg('')}`],
  ['XML declaration with an unknown pseudo-attribute', `<?xml version="1.0" href="javascript:alert(1)"?>${svg('')}`],
  ['two leading XML declarations', `<?xml version="1.0"?><?xml version="1.0"?>${svg('')}`],
  ['uppercase <?XML declaration', `<?XML version="1.0"?>${svg('')}`],
  ['BOM + declaration + PI', `\uFEFF<?xml version="1.0"?><?pi x?>${svg('')}`],
  ["'>' inside the declaration", `<?xml version="1.0" encoding="a>b"?>${svg('')}`],
  ['empty declaration', `<?xml?>${svg('')}`],
  ['declaration without version', `<?xml encoding="UTF-8"?>${svg('')}`],
  ['encoding before version', `<?xml encoding="UTF-8" version="1.0"?>${svg('')}`],
  ['unknown version', `<?xml version="2.0"?>${svg('')}`],
  ['version with junk', `<?xml version="1.0 evil"?>${svg('')}`],
  ['encoding with junk', `<?xml version="1.0" encoding="x y"?>${svg('')}`],
  ['standalone with a bad value', `<?xml version="1.0" standalone="maybe"?>${svg('')}`],
  ['mismatched quotes', `<?xml version="1.0'?>${svg('')}`],
  ['DOCTYPE after the declaration', `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]>${svg('')}`],
  ['empty CDATA', svg('<![CDATA[]]>')],
  ['CDATA inside title', svg('<title><![CDATA[x]]></title>')],
  ['DOCTYPE', `<!DOCTYPE svg><svg xmlns="${SVG}"/>`],
  ['external DTD', `<!DOCTYPE svg SYSTEM "file:///etc/passwd"><svg xmlns="${SVG}"/>`],
  ['entity declaration', `<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="${SVG}"/>`],
  ['external entity', `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="${SVG}"><title>&x;</title></svg>`],
  ['undeclared entity', svg('<title>&unknown;</title>')],
  ['XML stylesheet PI', `<?xml-stylesheet type="text/css" href="//evil.test/a.css"?>${svg('')}`],
  ['PI inside SVG', svg('<?xml-stylesheet href="//evil.test/a.css"?>')],
  ['arbitrary PI', `${svg('')}<?anything x?>`],
  ['double-quoted external href', use('href="https://evil.test/a.svg#x"')],
  ['single-quoted external href', use("href='https://evil.test/a.svg#x'")],
  ['unquoted external href', use('href=https://evil.test/a.svg#x')],
  ['unquoted fragment', use('href=#x')],
  ['protocol-relative href', use('href="//evil.test/a.svg#x"')],
  ['file href', use("href='file:///etc/passwd'")],
  ['single-quoted xlink href', xlink("xlink:href='//evil.test/a.svg#x'")],
  ['file xlink href', xlink("xlink:href='file:///etc/passwd'")],
  ['javascript href', use('href="javascript:alert(1)"')],
  ['mixed-case javascript href', use('href="JaVaScRiPt:alert(1)"')],
  ['decimal character reference scheme', use('href="&#106;avascript:alert(1)"')],
  ['hex character reference scheme', use('href="&#x6a;avascript:alert(1)"')],
  ['entity-encoded colon', use('href="javascript&#58;alert(1)"')],
  ['entity-encoded protocol-relative href', use('href="&#47;&#47;evil.test/a.svg"')],
  ['javascript with space', use('href="java script:alert(1)"')],
  ['javascript with newline', use('href="java\nscript:alert(1)"')],
  ['javascript with encoded tab', use('href="java&#9;script:alert(1)"')],
  ['javascript with encoded newline', use('href="java&#10;script:alert(1)"')],
  ['javascript xlink href', xlink('xlink:href="&#106;avascript:alert(1)"')],
  ['data href', use('href="data:image/svg+xml;base64,AAAA"')],
  ['relative external use', use('href="icons.svg#x"')],
  ['absolute external use', use('href="/icons.svg#x"')],
  ['empty href', use('href=""')],
  ['empty fragment', use('href="#"')],
  ['href on path', svg('<path href="#x"/>')],
  ['xlink href on path', svg('<path xlink:href="#x"/>', `xmlns:xlink="${XLINK}"`)],
  ['gradient href', svg('<linearGradient href="//evil.test/x"/>')],
  ['external URL fill', svg('<path fill="url(https://evil.test/p)"/>')],
  ['protocol-relative URL stroke', svg("<path stroke='url(//evil.test/p)'/>")],
  ['file URL mask', svg('<g mask="url(file:///etc/passwd)"/>')],
  ['data URL clip-path', svg('<g clip-path="url(data:image/svg+xml,x)"/>')],
  ['entity-encoded URL scheme', svg('<path fill="url(&#106;avascript:alert(1))"/>')],
  ['mixed-case URL function', svg('<path fill="UrL(//evil.test/p)"/>')],
  ['CSS-escaped URL function', svg('<path fill="u\\72l(//evil.test/p)"/>')],
  ['CSS-escaped URL argument', svg('<path fill="url(\\2f\\2f evil.test/p)"/>')],
  ['CSS comment in URL', svg('<path fill="url(/**///evil.test/p)"/>')],
  ['fragment URL with unsafe fallback', svg('<path fill="url(#g) url(//evil.test/p)"/>')],
  ['fragment URL with CSS suffix', svg('<path fill="url(#g);stroke:url(//evil.test/p)"/>')],
  ['style element import', svg('<style>@import "//evil.test/a.css";</style>')],
  ['style attribute URL', svg('<path style="fill:url(//evil.test/p)"/>')],
  ['style attribute import', svg('<path style="@import url(//evil.test/a.css)"/>')],
  ['style attribute expression', svg('<path style="fill:expression(alert(1))"/>')],
  ['style attribute plain declaration', svg('<path style="fill:red"/>')],
  ['presentation expression', svg('<path fill="expression(alert(1))"/>')],
  ['foreignObject', svg('<foreignObject><div/></foreignObject>')],
  ['image', svg('<image href="data:image/png;base64,AAAA"/>')],
  ['animation href', svg('<animate href="#x" attributeName="href" to="//evil.test/x"/>')],
  ['animation onbegin', svg('<animate onbegin="alert(1)"/>')],
  ['set href', svg('<set href="#x" attributeName="href" to="//evil.test/x"/>')],
  ['set onbegin', svg('<set onbegin="alert(1)"/>')],
  ['foreign namespace root', '<svg xmlns="http://www.w3.org/1999/xhtml"/>'],
  ['namespace reset', svg('<g xmlns=""><path/></g>')],
  ['foreign default namespace', svg('<g xmlns="urn:evil"/>')],
  ['foreign prefix declaration', svg('', 'xmlns:evil="urn:evil"')],
  ['foreign namespaced attribute', svg('<path evil:fill="red"/>', 'xmlns:evil="urn:evil"')],
  ['SVG namespace on attribute', svg(`<path xmlns:s="${SVG}" s:fill="red"/>`)],
  ['aliased xlink href', svg(`<use xmlns:l="${XLINK}" l:href="#x"/>`)],
  ['rebound xlink namespace', svg('<use xmlns:xlink="urn:evil" xlink:href="#x"/>')],
  ['xml:base changes fragment meaning', svg('<g xml:base="https://evil.test/"><use href="#x"/></g>')],
  ['unknown attribute', svg('<path surprise="x"/>')],
  ['geometry attribute on wrong element', svg('<g d="M0 0"/>')],
  ['prototype attribute name', svg('<path constructor="x"/>')],
  ['unknown element', svg('<constructor/>')],
  ['mixed-case allowed element', svg('<PATH/>')],
  ['mixed-case attribute', svg('<path FILL="red"/>')],
  ['title containing an element', svg('<title><path/></title>')],
  ['non-SVG root', '<html/>'],
  ['missing namespace', '<svg><path/></svg>'],
  ['multiple roots', `${svg('')}${svg('')}`],
  ['mismatched tags', svg('<g></path>')],
  ['unclosed element', svg('<g>')],
  ['malformed end tag', svg('<g></g trailing>')],
  ['duplicate attribute', svg('<path fill="red" fill="blue"/>')],
  ['unescaped ampersand', svg('<title>x & y</title>')],
  ['invalid XML text character', svg('<title>\u0000</title>')],
  ['invalid XML character reference', svg('<title>&#0;</title>')],
  ['text outside title or desc', svg('hello')],
  ['too large', svg('<g/>'.repeat(MAX_ICON_BYTES))],
  ['too deeply nested', svg('<g>'.repeat(65) + '</g>'.repeat(65))],
];

describe('SVG allowlist', () => {
  it.each(rejected)('rejects %s through both APIs', (_name, text) => {
    expect(svgProblems(text).length).toBeGreaterThan(0);
    expect(() => sanitizeSvg(text)).toThrow();
  });

  it.each([
    ['basic path', svg('<path d="M0 0h8v8z" fill="#fff"/>', 'viewBox="0 0 8 8"')],
    ['shapes and presentation', svg('<g transform="translate(1, 2) scale(2)" opacity=".5"><rect x="0" y="0" width="8px" height="8" rx="1"/><circle cx="2" cy="2" r="1"/><ellipse cx="4" cy="4" rx="2" ry="1"/><line x1="0" y1="0" x2="8" y2="8" stroke="red" stroke-linecap="round"/><polyline points="0,0 1,2 3,4"/><polygon points="0 0 1 2 3 4" fill-rule="evenodd"/></g>')],
    ['gradients, masks and clipping', svg('<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="0%" gradientUnits="objectBoundingBox" gradientTransform="rotate(15)" spreadMethod="reflect"><stop offset="0%" stop-color="#fff" stop-opacity="1"/></linearGradient><radialGradient id="r" cx="50%" cy="50%" r="1" fx=".5" fy=".5" fr="0"/><clipPath id="clip" clipPathUnits="userSpaceOnUse"><path d="M0 0h8v8z"/></clipPath><mask id="mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse"><rect width="8" height="8" fill="white"/></mask></defs><path d="M0 0h8v8z" fill="url(#g)" stroke="url(&quot;#r&quot;)" clip-path="url(\'#clip\')" mask="url(#mask)"/>')],
    ['local use', svg('<defs><path id="p" d="M0 0h8v8z"/></defs><use href="#p" x="1" y="2"/>')],
    ['single-quoted local xlink use', xlink("xlink:href='#p'")],
    ['encoded safe fragment', use('href="&#35;p"')],
    ['literal URL as description text', svg('<desc>Reference: https://example.test/</desc>')],
    ['escaped title text', svg('<title> A &amp; B &lt;path&gt; </title><desc>  Keep\nspaces  </desc>')],
  ])('accepts %s and serialises idempotently', (_name, text) => {
    expect(svgProblems(text)).toEqual([]);
    const canonical = sanitizeSvg(text);
    expect(svgProblems(canonical)).toEqual([]);
    expect(sanitizeSvg(canonical)).toBe(canonical);
  });

  it('canonicalises quotes, attribute order, comments, namespaces and empty tags', () => {
    const a = svg("<!-- vendor note --><path id='p' fill='red' d='M0 0'></path>", `width='8' xmlns:xlink='${XLINK}' height='8'`);
    const b = svg('<path d="M0 0" fill="red" id="p"/>', 'height="8" width="8"');
    expect(sanitizeSvg(a)).toBe(sanitizeSvg(b));
    expect(sanitizeSvg(a)).toBe(`<svg height="8" width="8" xmlns="${SVG}"><path d="M0 0" fill="red" id="p"/></svg>\n`);
  });

  it('preserves escaped metadata and its whitespace', () => {
    const text = svg('<title> A &amp; B &lt;path&gt; </title><desc>  Keep\nspaces  </desc>');
    expect(sanitizeSvg(text)).toBe(text.replace(' >', '>') + '\n');
  });

  it('finds tile colours regardless of attribute order or a rect fill', () => {
    expect(tileColour(svg('<g fill="#abcdef" id="Icon-Architecture-BG/64/X"><rect/></g>'))).toBe('#ABCDEF');
    expect(tileColour(svg('<g id="Icon-Architecture-BG/64/X"><rect fill="#abcdef"/></g>'))).toBe('#ABCDEF');
  });
});

const dir = new URL('../assets/aws-icons/', import.meta.url);
const icons = readdirSync(dir).filter((name) => name.endsWith('.svg')).sort();
const parse = (text) => new DOMParser({ onError: (_level, message) => { throw new Error(message); } }).parseFromString(text, 'application/xml');
const pathData = (doc) => Array.from(doc.getElementsByTagNameNS(SVG, 'path')).map((path) => path.getAttribute('d'));
// Also check ancestor transforms, fills and geometry: path strings alone would
// miss changes to their inherited presentation or other drawing elements.
const drawing = (doc) => Array.from(doc.getElementsByTagNameNS(SVG, '*')).map((el) => ({
  name: el.localName,
  attributes: Object.fromEntries(Array.from(el.attributes).filter((attr) => !attr.name.startsWith('xmlns')).map((attr) => [attr.name, attr.value]).sort()),
}));

describe('upstream AWS icon shape', () => {
  // AWS's own icon files start with an XML declaration; refreshing from the
  // official package must work (GPT review of #182: 53/54 were rejected).
  it('accepts a leading XML declaration (with BOM / whitespace) and drops it', () => {
    const body = readFileSync(fileURLToPath(new URL('../assets/aws-icons/ec2.svg', import.meta.url)), 'utf8');
    for (const prefix of ['<?xml version="1.0" encoding="UTF-8"?>\n', '\uFEFF<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n', "  <?xml version='1.0'?>"]) {
      expect(svgProblems(prefix + body)).toEqual([]);
      expect(sanitizeSvg(prefix + body)).toBe(sanitizeSvg(body));
    }
  });
});

describe('shipped AWS icons', () => {
  it.each(icons)('%s stays accepted and preserves drawing data', (name) => {
    const text = readFileSync(new URL(name, dir), 'utf8');
    expect(svgProblems(text)).toEqual([]);
    const canonical = sanitizeSvg(text);
    expect(svgProblems(canonical)).toEqual([]);
    expect(sanitizeSvg(canonical)).toBe(canonical);
    const before = parse(text);
    const after = parse(canonical);
    expect(pathData(before).length).toBeGreaterThan(0);
    expect(pathData(after)).toEqual(pathData(before));
    expect(drawing(after)).toEqual(drawing(before));
  });
});

describe('assets:sync CLI', () => {
  it('writes canonical SVGs and refuses unsafe raw input without overwriting the icon', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'holodeck-svg-sync-'));
    try {
      const pkg = join(fixture, 'packages/assets-aws');
      const source = join(fixture, 'Architecture-Service-Icons');
      const models = join(fixture, 'packages/library-cloud/assets/models');
      for (const dir of [join(pkg, 'scripts'), join(pkg, 'src'), source, models]) mkdirSync(dir, { recursive: true });
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(pkg, 'node_modules'), 'dir');
      for (const name of ['sync-assets.mjs', 'svg-sanitize.mjs']) {
        copyFileSync(new URL(`../scripts/${name}`, import.meta.url), join(pkg, 'scripts', name));
      }
      const [service] = JSON.parse(readFileSync(new URL('./services.json', import.meta.url), 'utf8'));
      writeFileSync(join(pkg, 'src/services.json'), JSON.stringify([service]));
      copyFileSync(new URL('./categories.json', import.meta.url), join(pkg, 'src/categories.json'));
      copyFileSync(new URL(`../../library-cloud/assets/models/${service.archetype}.glb`, import.meta.url), join(models, `${service.archetype}.glb`));
      const input = join(source, `Arch_${service.icon}_64.svg`);
      const destination = join(pkg, 'assets/aws-icons', `${service.slug}.svg`);
      const original = readFileSync(new URL(`${service.slug}.svg`, dir), 'utf8');
      const canonical = sanitizeSvg(original);
      writeFileSync(input, original);
      const run = () => spawnSync(process.execPath, [join(pkg, 'scripts/sync-assets.mjs'), source], { cwd: pkg, encoding: 'utf8' });
      const accepted = run();
      expect(accepted.stderr).toBe('');
      expect(accepted.status).toBe(0);
      expect(readFileSync(destination, 'utf8')).toBe(canonical);
      // These must be rejected from raw source, never cleaned into acceptance.
      for (const unsafe of [
        '<?xml-stylesheet href="//evil.test/a.css"?>',
        '<![CDATA[]]>',
        '<use href="&#106;avascript:alert(1)"/>',
      ]) {
        writeFileSync(input, original.replace('</svg>', `${unsafe}</svg>`));
        const rejected = run();
        expect(rejected.status).toBe(1);
        expect(rejected.stderr).toContain(`${service.slug}:`);
        expect(readFileSync(destination, 'utf8')).toBe(canonical);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
