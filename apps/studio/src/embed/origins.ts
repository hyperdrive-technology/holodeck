/**
 * Who may drive an embed through `postMessage`, and who may see STORED
 * documents through it (holodeck#42, hardened for holodeck#151).
 *
 * Two levels:
 *
 *  - **trusted** = the studio's own origin + the build-time list
 *    `VITE_HOLODECK_EMBED_ORIGINS` (comma separated). Only a trusted parent
 *    (every ancestor frame trusted) gets the stored document for
 *    `/embed/<docId>` rendered and described (`ready`, `getInfo`).
 *  - **allowed** = trusted + every `parentOrigin` query parameter on the embed
 *    URL that is an exact http(s) origin (and, when the configured list is
 *    set, inside it). An allowed-but-untrusted parent may only talk to the
 *    embed about documents it sends itself (`loadDocument`); stored
 *    documents are never read for it.
 *
 * Why the split: the embedding page writes the iframe URL, so a URL grant
 * proves nothing about who it is. Relying on browsers partitioning storage
 * per top-level site is not enough: a same-site sibling (another subdomain,
 * or another port on the same host) shares the studio's storage partition,
 * and some browsers / policies do not partition at all. Outbound messages are
 * always addressed to one exact origin (never `'*'`).
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
  /** Origins that may also see stored documents: own origin + the configured list (never URL grants). */
  trusted: ReadonlySet<string>;
  /** `parentOrigin` values that were refused (malformed, or outside the configured list), for a console warning. */
  rejected: string[];
}

/**
 * The origin policy for an embed. `configured` is `VITE_HOLODECK_EMBED_ORIGINS`
 * (comma-separated; empty or undefined = no extra restriction).
 */
export function embedOriginPolicy(selfOrigin: string, search: URLSearchParams, configured?: string): EmbedOriginPolicy {
  const rejected: string[] = [];
  const list = (configured ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const narrowTo = list.length ? new Set(list.map(parseOrigin).filter((o): o is string => o !== null)) : null;
  const trusted = new Set<string>([selfOrigin, ...(narrowTo ?? [])]);
  const allowed = new Set<string>(trusted);
  for (const raw of search.getAll('parentOrigin')) {
    const origin = parseOrigin(raw);
    if (!origin || (narrowTo && !narrowTo.has(origin))) rejected.push(raw);
    else allowed.add(origin);
  }
  return { allowed, trusted, rejected };
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

/** Where this page sits, as far as the browser tells us. */
export interface FrameContext {
  /** In an iframe (`window.parent !== window`). */
  framed: boolean;
  /** `location.ancestorOrigins` (parent first), or null where the browser lacks it (Firefox). */
  ancestorOrigins: readonly string[] | null;
  /** `document.referrer` ('' when withheld). */
  referrer: string;
  /** The parent is the top window (one level of framing). */
  parentIsTop: boolean;
}

/** The current window's frame context. */
export function currentFrameContext(win: Window = window): FrameContext {
  const ancestors = (win.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  return {
    framed: win.parent !== win,
    ancestorOrigins: ancestors ? Array.from({ length: ancestors.length }, (_, i) => ancestors.item(i) ?? 'null') : null,
    referrer: win.document.referrer,
    parentIsTop: win.parent === win.top,
  };
}

/**
 * May this embed read and show stored documents (holodeck#151)? Yes when not
 * framed (a person opened the URL), or when EVERY ancestor frame is trusted.
 * The ancestor chain comes from `location.ancestorOrigins` (browser-supplied;
 * a page cannot forge it). Without it (Firefox) only a single level of framing
 * whose referrer origin is trusted counts; a withheld referrer means no.
 * Anything unknown is untrusted: then only `loadDocument` documents are shown.
 *
 * INVARIANT for the referrer fallback (holodeck#157): `document.referrer` is the
 * origin of the document that INITIATED the iframe navigation, which equals the
 * parent only while no studio-origin page can navigate a named / attacker-chosen
 * frame. So NO studio page may call `window.open(url, name)`, use `<a target>` /
 * `<form target>` fed by untrusted input, or expose an open redirect; otherwise
 * an untrusted top page could launder a studio-origin referrer into its own
 * iframe. Remove the fallback once Firefox ships `location.ancestorOrigins`.
 */
export function storedDocumentsVisible(policy: Pick<EmbedOriginPolicy, 'trusted'>, frame: FrameContext): boolean {
  if (!frame.framed) return true;
  if (frame.ancestorOrigins) return frame.ancestorOrigins.length > 0 && frame.ancestorOrigins.every((o) => policy.trusted.has(o));
  if (!frame.parentIsTop || !frame.referrer) return false;
  let origin: string;
  try {
    origin = new URL(frame.referrer).origin;
  } catch {
    return false;
  }
  return policy.trusted.has(origin);
}

/**
 * True when the stored-document check is closed only because this browser has
 * no `ancestorOrigins` (Firefox) AND the referrer was withheld (a partner
 * sending `Referrer-Policy: no-referrer`). Lets the embed say why instead of
 * waiting silently (holodeck#157).
 */
export function referrerWithheld(frame: FrameContext): boolean {
  return frame.framed && frame.ancestorOrigins === null && frame.parentIsTop && !frame.referrer;
}
