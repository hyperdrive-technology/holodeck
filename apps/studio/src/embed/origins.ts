/**
 * Which parent pages may drive an embed through `postMessage` (holodeck#42).
 *
 * Allowed origins = the studio's own origin, plus every `parentOrigin` query
 * parameter on the embed URL (`/embed/<id>?parentOrigin=https://app.example`,
 * repeatable) that is an exact http(s) origin. A deployment can narrow that
 * with the build-time list `VITE_HOLODECK_EMBED_ORIGINS` (comma separated):
 * when set, a `parentOrigin` outside it is ignored.
 *
 * Why the URL may widen the list at all: the embedding page writes the iframe
 * URL, so it can only grant ITSELF access to its own iframe. What that access
 * reaches is display state (setObjectState) and documents it supplies itself
 * (loadDocument); stored documents live in the studio origin's IndexedDB,
 * which browsers partition per top-level site, so a cross-site embedder sees
 * an empty store. Outbound messages are always addressed to one exact allowed
 * origin (never `'*'`), so nothing is posted to a parent that was not allowed.
 */

/** `value` as an exact web origin (`https://host[:port]`), or null. Paths, credentials, `null` and non-http(s) schemes are refused. */
export function parseOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // `https://a.example/` and `https://a.example/path` normalise to the same
  // origin; require the exact origin so a typo is not silently widened.
  if (url.origin === 'null' || trimmed.replace(/\/$/, '') !== url.origin) return null;
  return url.origin;
}

export interface EmbedOriginPolicy {
  /** Origins that may post to the embed and receive its replies. */
  allowed: ReadonlySet<string>;
  /** `parentOrigin` values that were refused (malformed, or outside the configured list), for a console warning. */
  rejected: string[];
}

/**
 * The origin policy for an embed. `configured` is `VITE_HOLODECK_EMBED_ORIGINS`
 * (comma-separated; empty or undefined = no extra restriction).
 */
export function embedOriginPolicy(selfOrigin: string, search: URLSearchParams, configured?: string): EmbedOriginPolicy {
  const allowed = new Set<string>([selfOrigin]);
  const rejected: string[] = [];
  const list = (configured ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const narrowTo = list.length ? new Set(list.map(parseOrigin).filter((o): o is string => o !== null)) : null;
  for (const raw of search.getAll('parentOrigin')) {
    const origin = parseOrigin(raw);
    if (!origin || (narrowTo && !narrowTo.has(origin))) rejected.push(raw);
    else allowed.add(origin);
  }
  return { allowed, rejected };
}

/**
 * Accept a message only from our direct parent frame, from an allowed origin.
 * `source === parent` stops another frame or window (a popup, a sibling
 * iframe) on an allowed origin from driving this embed.
 */
export function acceptMessage(
  event: Pick<MessageEvent, 'origin' | 'source'>,
  policy: Pick<EmbedOriginPolicy, 'allowed'>,
  parent: MessageEventSource | null,
  self: unknown,
): boolean {
  if (!parent || parent === self) return false; // not framed: nobody to talk to
  return event.source === parent && policy.allowed.has(event.origin);
}
