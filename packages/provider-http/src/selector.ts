/**
 * Source syntax of `holodeck.http` (README "Sources"):
 *
 *   source   := [ endpoint "#" ] selector  |  jsonpath
 *   endpoint := "/" path [ "?" query ]      resolved against the connection URL's origin
 *   selector := json-pointer | jsonpath
 *
 *   json-pointer  RFC 6901: ""  (whole message), "/pumps/0/rpm", "/a~1b" (key "a/b"), "/m~0n" (key "m~n")
 *   jsonpath      "$" followed by ".name", "[0]", "[-1]" (from the end), "['any key']" or "[\"any key\"]"
 *
 * Examples: `/temperature`, `$.pumps[0].rpm`, `/api/line2#/speed`, `/api/line2#$.alarms[-1].text`.
 *
 * Splitting rule: a source that starts with `$` is a JSONPath on the default
 * endpoint (so `$['a#b']` keeps its `#`). Otherwise the first `#` separates
 * endpoint and selector. A pointer whose keys contain `#` therefore needs an
 * explicit (possibly empty) endpoint: `#/a#b` is key `a#b` on the default endpoint.
 *
 * "Lite" means no wildcards, filters, recursive descent or slices: one source
 * names one value, because a Holodeck signal is one scalar.
 */

/** One step into a JSON value: object key or array index (negative = from the end). */
export type SelectorToken = string | number;

export interface ParsedSource {
  /** The source string exactly as given (samples echo it back). */
  source: string;
  /** Endpoint path (`/api/x?y=1`), or `''` for the connection's default URL. */
  endpoint: string;
  tokens: SelectorToken[];
}

export class SourceSyntaxError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = 'SourceSyntaxError';
  }
}

/** Longest source accepted; bounds parser work on hostile documents. */
export const MAX_SOURCE_LENGTH = 2048;

// Endpoint: an absolute path with optional query. No whitespace, controls or
// backslashes (URL parsers rewrite `\` to `/`), and not `//host` (which would
// be a protocol-relative URL to another origin).
const ENDPOINT = /^\/(?!\/)[^\s\\#\u0000-\u001f\u007f]*$/;

export function parseSource(source: string): ParsedSource {
  if (typeof source !== 'string') throw new SourceSyntaxError('source must be a string', String(source));
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new SourceSyntaxError(`source is longer than ${MAX_SOURCE_LENGTH} characters`, source);
  }
  let endpoint = '';
  let selector = source;
  if (!source.startsWith('$')) {
    const hash = source.indexOf('#');
    if (hash >= 0) {
      endpoint = source.slice(0, hash);
      selector = source.slice(hash + 1);
      if (endpoint !== '' && !ENDPOINT.test(endpoint)) {
        throw new SourceSyntaxError(`endpoint "${endpoint}" must be an absolute path such as "/api/status"`, source);
      }
    }
  }
  return { source, endpoint, tokens: parseSelector(selector, source) };
}

export function parseSelector(selector: string, source = selector): SelectorToken[] {
  if (selector === '' || selector.startsWith('/')) return parsePointer(selector, source);
  if (selector.startsWith('$')) return parseJsonPath(selector, source);
  throw new SourceSyntaxError(
    `selector "${selector}" must be a JSON pointer ("/a/0/b") or a JSONPath ("$.a[0].b")`,
    source,
  );
}

function parsePointer(pointer: string, source: string): SelectorToken[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((raw) => {
      if (/~(?![01])/.test(raw)) throw new SourceSyntaxError(`bad escape in JSON pointer segment "${raw}"`, source);
      // Order matters (RFC 6901 §4): ~1 first, then ~0, so "~01" becomes "~1".
      return raw.replace(/~1/g, '/').replace(/~0/g, '~');
    });
}

const NAME_START = /[A-Za-z_$]/;
const NAME_CHAR = /[A-Za-z0-9_$-]/;

function parseJsonPath(path: string, source: string): SelectorToken[] {
  const tokens: SelectorToken[] = [];
  let i = 1; // after "$"
  const fail = (what: string): never => {
    throw new SourceSyntaxError(`JSONPath "${path}": ${what} at position ${i}`, source);
  };
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      i++;
      const start = i;
      if (i >= path.length || !NAME_START.test(path[i] as string)) fail('expected a member name');
      while (i < path.length && NAME_CHAR.test(path[i] as string)) i++;
      tokens.push(path.slice(start, i));
    } else if (ch === '[') {
      i++;
      const quote = path[i];
      if (quote === "'" || quote === '"') {
        i++;
        let key = '';
        for (;;) {
          if (i >= path.length) fail('unterminated string');
          const c = path[i] as string;
          if (c === '\\') {
            const next = path[i + 1];
            if (next !== quote && next !== '\\') fail('only \\\\ and an escaped quote are allowed in a key');
            key += next;
            i += 2;
          } else if (c === quote) {
            i++;
            break;
          } else {
            key += c;
            i++;
          }
        }
        tokens.push(key);
      } else {
        const m = /^-?(0|[1-9][0-9]{0,8})/.exec(path.slice(i));
        if (!m) fail('expected an index or a quoted key');
        tokens.push(Number((m as RegExpExecArray)[0]));
        i += (m as RegExpExecArray)[0].length;
      }
      if (path[i] !== ']') fail('expected "]"');
      i++;
    } else {
      fail(`unexpected "${ch}" (wildcards, filters and slices are not supported)`);
    }
  }
  return tokens;
}

export type Lookup = { found: true; value: unknown } | { found: false };

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/** Walk `tokens` into a parsed JSON value. Never throws. */
export function lookup(root: unknown, tokens: readonly SelectorToken[]): Lookup {
  let current: unknown = root;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      let index: number;
      if (typeof token === 'number') index = token < 0 ? current.length + token : token;
      else if (ARRAY_INDEX.test(token)) index = Number(token);
      else return { found: false };
      if (index < 0 || index >= current.length) return { found: false };
      current = current[index];
    } else if (current !== null && typeof current === 'object') {
      const key = String(token);
      // Own properties only: "__proto__" or "constructor" must not walk the prototype chain.
      if (!Object.prototype.hasOwnProperty.call(current, key)) return { found: false };
      current = (current as Record<string, unknown>)[key];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

/** RFC 6901 pointer for tokens (used by `browse` to build child sources). */
export function formatPointer(tokens: readonly SelectorToken[]): string {
  return tokens.map((t) => '/' + String(t).replace(/~/g, '~0').replace(/\//g, '~1')).join('');
}

/** Canonical source for an endpoint + tokens (always pointer form, `#` only when needed). */
export function formatSource(endpoint: string, tokens: readonly SelectorToken[]): string {
  const pointer = formatPointer(tokens);
  if (endpoint === '' && !pointer.includes('#')) return pointer;
  return `${endpoint}#${pointer}`;
}
