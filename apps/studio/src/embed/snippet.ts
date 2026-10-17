/**
 * The embed URL and `<iframe>` snippet the Export dialog offers (holodeck#42).
 */

import { parseOrigin } from './origins';

/** `/embed/<docId>` on `studioOrigin`, with `parentOrigin` when one is given and valid (see origins.ts). */
export function embedUrl(studioOrigin: string, docId: string, parentOrigin?: string): string {
  const url = new URL(`/embed/${encodeURIComponent(docId)}`, studioOrigin);
  const parent = parentOrigin ? parseOrigin(parentOrigin) : null;
  if (parent && parent !== url.origin) url.searchParams.set('parentOrigin', parent);
  return url.toString();
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A copy-paste `<iframe>` for `url`; `title` is the document name (escaped). */
export function embedSnippet(url: string, title: string): string {
  return `<iframe src="${escapeAttr(url)}" title="${escapeAttr(title || 'Holodeck document')}" width="960" height="540" style="border:0" loading="lazy"></iframe>`;
}
