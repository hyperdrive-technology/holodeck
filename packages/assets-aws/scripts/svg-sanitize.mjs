/**
 * Conservative SVG sanitiser for vendor icons that ship inside an npm package.
 *
 * Icons are loaded as textures/images by the renderer, but the files may also
 * be opened directly in a browser or inlined by a host, so the package refuses
 * anything active: scripts, event handlers, external references, embedded
 * documents. The official AWS icons use none of these; the check exists so a
 * future icon-set refresh cannot silently add one. Used by `sync-assets.mjs`
 * (before writing) and by the unit tests (on every shipped file).
 */

/** Per-icon size budget (bytes). The largest AWS Architecture 64px icon is ~11 KB. */
export const MAX_ICON_BYTES = 16 * 1024;

const FORBIDDEN_ELEMENTS = ['script', 'foreignObject', 'iframe', 'object', 'embed', 'image', 'style', 'animate', 'set', 'a', 'audio', 'video'];

/** Normalise the wrapper noise of Illustrator/Figma exports. Never changes drawing data. */
export function sanitizeSvg(text) {
  return (
    text
      .replace(/^﻿/, '')
      .replace(/<\?xml[^>]*\?>\s*/g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      // Unused (we reject xlink:href below) and only invites external-reference tooling.
      .replace(/\sxmlns:xlink="[^"]*"/g, '')
      .replace(/>\s+</g, '><')
      .trim() + '\n'
  );
}

/** Every reason `text` is not acceptable; empty when it is safe to ship. */
export function svgProblems(text) {
  const problems = [];
  if (Buffer.byteLength(text) > MAX_ICON_BYTES) problems.push(`larger than ${MAX_ICON_BYTES} bytes`);
  if (!/^<svg[\s>]/.test(text)) problems.push('does not start with <svg');
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(text)) problems.push('has a DOCTYPE, entity or processing instruction');
  for (const name of FORBIDDEN_ELEMENTS) {
    if (new RegExp(`<${name}[\\s/>]`, 'i').test(text)) problems.push(`has a <${name}> element`);
  }
  if (/\son[a-z]+\s*=/i.test(text)) problems.push('has an event-handler attribute');
  if (/javascript:|data:|vbscript:/i.test(text)) problems.push('has a script or data: URL');
  if (/@import/i.test(text)) problems.push('has @import');
  for (const m of text.matchAll(/(?:xlink:)?href\s*=\s*"([^"]*)"/gi)) {
    if (!m[1].startsWith('#')) problems.push(`has an external href "${m[1]}"`);
  }
  for (const m of text.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) {
    if (!m[1].startsWith('#')) problems.push(`has an external url() "${m[1]}"`);
  }
  // The only http(s) text allowed is the SVG namespace declaration itself.
  const withoutNamespace = text.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, '');
  if (/https?:\/\//i.test(withoutNamespace)) problems.push('mentions an http(s) URL');
  return problems;
}

/** The icon's tile colour (the `Icon-Architecture-BG` group's fill), uppercase, or undefined. */
export function tileColour(text) {
  const m = /Icon-Architecture-BG[^>]*>/.exec(text);
  if (!m) return undefined;
  const group = /fill="(#[0-9a-fA-F]{6})"/.exec(m[0]);
  if (group) return group[1].toUpperCase();
  const rect = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(text.slice(m.index));
  return rect?.[1].toUpperCase();
}
