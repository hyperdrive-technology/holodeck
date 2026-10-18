/**
 * Credentials must never be stored in a document (holodeck#163 review, P1).
 * A connection's config is checked two ways:
 *
 * 1. The provider's own config validation, where the provider exports one
 *    (`parseHttpConfig`, `parseAwsConfig`): the providers' credential rules
 *    (no `Authorization` / `Cookie` / `Proxy-Authorization` headers, no
 *    `user:pass@` URLs, no AWS key names) stay the single source of truth.
 * 2. A generic deep scan for anything that looks like a credential, for every
 *    provider, known or not: key names (authorization, cookie, *secret*,
 *    *token*, *password*, api keys, access keys, private keys, the provider's
 *    declared secret names), and values (URLs with userinfo or credential
 *    query parameters, `Bearer` / `Basic` header values, AWS access key ids).
 *
 * Both fail closed: anything doubtful is refused, with a message that points
 * to the secrets fields. Used by the connection dialog, document save
 * (`checkHostDocument`, so the store refuses it) and import / embed load.
 */

import type { HolodeckProvider, ProviderConnection } from '@holodeck/sdk';
import { HttpConfigError, parseHttpConfig } from '@holodeck/provider-http';
import { AwsConfigError, parseAwsConfig } from '@holodeck/provider-aws';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Provider config validators, by provider id. Each returns the provider's
 * normalised config (what the provider will actually use) or throws with
 * `details` on an invalid one (structure or credentials). Providers without
 * an exported validator get the generic scan only.
 */
export const PROVIDER_CONFIG_VALIDATORS: Readonly<Record<string, (config: unknown) => unknown>> = {
  'holodeck.http': parseHttpConfig,
  'aws.cloudwatch': parseAwsConfig,
};

/** The provider's own verdict on `config`; empty = valid or no validator for that provider. */
export function providerConfigProblems(providerId: string, config: unknown): string[] {
  return checkWithProvider(providerId, config).problems;
}

/** The provider's verdict and, when valid, its normalised config (undefined: no validator). */
function checkWithProvider(providerId: string, config: unknown): { problems: string[]; normalized?: unknown } {
  const validate = PROVIDER_CONFIG_VALIDATORS[providerId];
  if (!validate) return { problems: [] };
  try {
    return { problems: [], normalized: validate(config ?? {}) };
  } catch (error) {
    if (error instanceof HttpConfigError || error instanceof AwsConfigError) return { problems: [...error.details] };
    const details = (error as { details?: unknown }).details;
    return { problems: Array.isArray(details) ? details.map(String) : [error instanceof Error ? error.message : String(error)] };
  }
}

// -----------------------------------------------------------------------------
// Names
// -----------------------------------------------------------------------------

/** Lower case, separators (`-`, `_`, `.`, spaces) dropped: `X-Api-Key`, `api_key`, `apiKey` all read `xapikey` / `apikey`. */
export const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_.\s]/g, '');

/**
 * Names that are credentials on their own (query parameters, headers, config
 * keys), compared normalized: `key` (Google), `sig` (Azure SAS), `code`
 * (Azure Functions), `auth` (Firebase), header names used by API gateways
 * (holodeck#168).
 */
const CREDENTIAL_NAMES = new Set([
  'key',
  'sig',
  'signature',
  'code',
  'auth',
  'pwd',
  'sid',
  'sessionid',
  'xauthkey',
  'xauthtoken',
  'ocpapimsubscriptionkey',
  'subscriptionkey',
  'xfunctionskey',
  'xamzsecuritytoken',
  'xamzsignature',
  'xgoogapikey',
]);

/** Parts that make any name a credential (`client_secret`, `refreshToken`, `dbPassword`, `x-api-key`). */
const CREDENTIAL_PARTS = ['authorization', 'cookie', 'secret', 'token', 'password', 'passwd', 'passphrase', 'apikey', 'privatekey', 'accesskey', 'bearer'];

/**
 * Names that contain a credential word but are not credentials (holodeck#169):
 * paging and quota words next to "token" (`nextToken`, `maxTokens`,
 * `page_token`, `X-Token-Count`, `tokenizer`, `csrfTokenHeader`), and
 * references to a secret rather than the secret (`secretName`, `secretArn`,
 * `SecretsManagerRequests`).
 */
const NOT_CREDENTIAL = [
  /token.*(count|limit|header|type|izer|expir|ttl|length|size|usage|url|endpoint)|(count|limit|page|next|max|min|continuation|prev)token|tokenizer/,
  /secret.*(arn|name|manager|ref|path|version|id$)/,
];

/**
 * Is `name` a credential name? `context`: `param` for query / fragment
 * parameters and HTTP header names, where short names such as `key`, `code`
 * and `auth` carry credentials; `key` for other config keys, where those
 * words are ordinary (`tags[].key`, the HTTP `auth` scheme object).
 */
export function credentialName(name: string, extra: ReadonlySet<string> = new Set(), context: 'param' | 'key' = 'param'): boolean {
  const k = normalizeKey(name);
  if (!k) return false;
  if (extra.has(k)) return true;
  if (context === 'param' && CREDENTIAL_NAMES.has(k)) return true;
  if (NOT_CREDENTIAL.some((re) => re.test(k))) return false;
  // Header style `X-Something-Key` (gateway keys), not `sortKey` / `partitionKey`.
  if (context === 'param' && /-key$/i.test(name.trim())) return true;
  return CREDENTIAL_PARTS.some((part) => k.includes(part));
}

// -----------------------------------------------------------------------------
// Values
// -----------------------------------------------------------------------------

/** Well-known token shapes (holodeck#168). */
const TOKEN_SHAPES: ReadonlyArray<[RegExp, string]> = [
  [/\b(AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/, 'a GitHub token'],
  [/\b(sk|rk)_(live|test)_[A-Za-z0-9]{10,}/, 'a Stripe key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/, 'a JSON web token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];

/** `Bearer abc…`, `Basic dXNlcj…`: a scheme then a token-like word (so "Basic tier" is fine, holodeck#169). */
const AUTH_HEADER_VALUE = /^\s*(bearer|basic|digest|token)\s+[A-Za-z0-9._~+/=-]{8,}\s*$/i;

const DUMMY_BASE = 'https://base.invalid/';
const WEB_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:']);

function decode(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** `a=1&b=2` -> name/value pairs (empty and value-less parts kept). */
function params(text: string): Array<[string, string]> {
  return text
    .split(/[&;]/)
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      return i < 0 ? [decode(part), ''] : [decode(part.slice(0, i)), decode(part.slice(i + 1))];
    });
}

/**
 * Every string is read as a possible URL (holodeck#163 review): resolved
 * against the connection's own URL (or a dummy https base), so absolute,
 * scheme-relative (`//u:p@h`), path-relative (`write?api_key=…`), sloppy
 * (`https:/u:p@h`, backslashes, leading spaces) and plain text all go through
 * one WHATWG parser. Then the userinfo, every query parameter (name and
 * value) and a `name=value` fragment (OAuth `#access_token=`) are checked.
 */
function urlCredential(value: string, base: string, extra: ReadonlySet<string>): string | null {
  // No pre-filtering by shape (review of #163 @ 51da21b): EVERY string goes
  // to the WHATWG parser, which itself strips leading/trailing C0 controls
  // and spaces, removes tabs and newlines and percent-encodes inner spaces,
  // exactly as a provider's `new URL(...)` would. Prose parses as a harmless
  // relative path. Several readings, any of which may expose a credential:
  // as is, resolved against the base (relative forms), on its own, and
  // normalised (`https:/u:p@h`, backslashes) for looser clients.
  // `trim()` also drops Unicode spaces (U+2003 …), which the URL parser keeps.
  const trimmed = value.trim();
  const normalized = trimmed.replace(/\\/g, '/').replace(/^([a-z][a-z0-9+.-]*):\/*/i, '$1://');
  for (const candidate of new Set([value, trimmed, normalized])) {
    for (const b of [base, undefined]) {
      const found = checkUrl(candidate, b, extra);
      if (found) return found;
    }
  }
  return null;
}

function checkUrl(text: string, base: string | undefined, extra: ReadonlySet<string>): string | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(text) : new URL(text, base);
  } catch {
    return null;
  }
  if (url.password || (url.username && WEB_SCHEMES.has(url.protocol))) return 'a URL with a user name or password';
  for (const [name, v] of params(url.search.slice(1))) {
    if (credentialName(name, extra)) return `a URL with a "${name}" query parameter`;
    const shape = tokenShape(v);
    if (shape) return `a URL whose query carries ${shape}`;
  }
  const fragment = url.hash.slice(1);
  if (fragment.includes('=')) {
    for (const [name, v] of params(fragment)) {
      if (credentialName(name, extra)) return `a URL with a "${name}" fragment parameter`;
      if (tokenShape(v)) return 'a URL whose fragment carries a token';
    }
  }
  return null;
}

function tokenShape(value: string): string | null {
  for (const [re, what] of TOKEN_SHAPES) if (re.test(value)) return what;
  return null;
}

function credentialValue(value: string, base: string, extra: ReadonlySet<string>): string | null {
  if (AUTH_HEADER_VALUE.test(value)) return 'an Authorization-style credential';
  return tokenShape(value) ?? urlCredential(value, base, extra);
}

const baseOf = (config: unknown): string => {
  const url = isObj(config) ? config.url : undefined;
  if (typeof url === 'string') {
    try {
      return new URL(url.trim()).href;
    } catch {
      // Not absolute: the dummy base.
    }
  }
  return DUMMY_BASE;
};

/**
 * A credential inside free text (a binding source, a label). `base`: the
 * connection URL a relative source is resolved against. `null` when clean.
 * Never returns the value itself.
 */
export function credentialInText(value: string, base: string = DUMMY_BASE): string | null {
  return credentialValue(value, base, new Set());
}

/** Deepest nesting the scan accepts; deeper configs are refused (they are not legitimate settings). */
export const MAX_CONFIG_DEPTH = 64;
/** Most values (keys + leaves) the scan visits in one config. */
export const MAX_CONFIG_NODES = 50_000;

/**
 * Every credential-looking key or value in `config`, at any depth. Relative
 * URLs resolve against `config.url`. Iterative with a depth and size bound,
 * so hostile input (6,000 nested objects) is a problem, never a stack
 * overflow (review of #163 @ 51da21b). Never throws.
 */
export function credentialProblems(config: unknown, provider?: Pick<HolodeckProvider, 'secrets'>): string[] {
  const extra = new Set((provider?.secrets ?? []).map((s) => normalizeKey(s.key)));
  const base = baseOf(config);
  const found: string[] = [];
  const stack: Array<{ value: unknown; path: string; depth: number; headers: boolean }> = [{ value: config, path: '', depth: 0, headers: false }];
  let visited = 0;
  while (stack.length) {
    const { value, path, depth, headers } = stack.pop()!;
    if (++visited > MAX_CONFIG_NODES) return [...found, `config: has more than ${MAX_CONFIG_NODES} values; refusing to store it`];
    if (depth > MAX_CONFIG_DEPTH) return [...found, `${path || 'config'}: nested more than ${MAX_CONFIG_DEPTH} levels deep; refusing to store it`];
    if (typeof value === 'string') {
      const what = credentialValue(value, base, extra);
      if (what) found.push(`${path || 'config'}: looks like ${what}; credentials go in the connection's secrets, never in the document`);
    } else if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], path: `${path}[${i}]`, depth: depth + 1, headers: false });
    } else if (isObj(value)) {
      const entries = Object.entries(value);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i]!;
        const at = path ? `${path}.${k}` : k;
        // Keys of a `headers` object are header names: the strict (parameter) rules apply.
        if (credentialName(k, extra, headers ? 'param' : 'key')) {
          found.push(`${at}: "${k}" looks like a credential; credentials go in the connection's secrets, never in the document`);
        }
        stack.push({ value: v, path: at, depth: depth + 1, headers: normalizeKey(k) === 'headers' });
      }
    }
  }
  return found;
}

/**
 * Everything wrong with one connection's config before it may be saved:
 * the generic credential scan plus the provider's own validation.
 */
export function connectionConfigProblems(connection: Pick<ProviderConnection, 'provider' | 'config'>, provider?: Pick<HolodeckProvider, 'secrets'>): string[] {
  const raw = credentialProblems(connection.config, provider);
  // Depth / size refusals stop here: the provider's own (recursive) parser is not handed hostile input.
  if (raw.some((p) => p.includes('refusing to store it'))) return raw;
  const checked = checkWithProvider(connection.provider, connection.config);
  // Also scan what the provider will actually use (its normalised config):
  // any normalisation it applies (trimming, encoding) is then covered too.
  const normalized = checked.normalized === undefined ? [] : credentialProblems(checked.normalized, provider);
  return [...new Set([...raw, ...checked.problems, ...normalized])];
}
