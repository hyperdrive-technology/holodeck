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
 * Provider config validators, by provider id. Each throws with `details` on
 * an invalid config (structure or credentials). Providers without an
 * exported validator get the generic scan only.
 */
export const PROVIDER_CONFIG_VALIDATORS: Readonly<Record<string, (config: unknown) => void>> = {
  'holodeck.http': parseHttpConfig,
  'aws.cloudwatch': parseAwsConfig,
};

/** The provider's own verdict on `config`; empty = valid or no validator for that provider. */
export function providerConfigProblems(providerId: string, config: unknown): string[] {
  const validate = PROVIDER_CONFIG_VALIDATORS[providerId];
  if (!validate) return [];
  try {
    validate(config ?? {});
    return [];
  } catch (error) {
    if (error instanceof HttpConfigError || error instanceof AwsConfigError) return [...error.details];
    const details = (error as { details?: unknown }).details;
    return Array.isArray(details) ? details.map(String) : [error instanceof Error ? error.message : String(error)];
  }
}

/**
 * Key names that mean "credential", compared after lower-casing and dropping
 * `-`, `_`, `.` and spaces (so `X-Api-Key`, `api_key` and `apiKey` match).
 * Substring matches, so `client_secret`, `refreshToken`, `dbPassword` match.
 * Deliberately not here: `auth` (a scheme object), `credentials` (AWS mode
 * object), `sessionName`, `username`.
 */
const CREDENTIAL_KEY_PARTS = [
  'authorization',
  'cookie',
  'secret',
  'token',
  'password',
  'passwd',
  'passphrase',
  'apikey',
  'privatekey',
  'accesskey',
  'bearer',
  'signature',
];

const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_.\s]/g, '');

function credentialKey(key: string, extra: ReadonlySet<string>): boolean {
  const k = normalizeKey(key);
  return extra.has(k) || CREDENTIAL_KEY_PARTS.some((part) => k.includes(part));
}

const USERINFO_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i;
const HEADER_CREDENTIAL = /^\s*(bearer|basic|digest|token)\s+\S/i;
const AWS_ACCESS_KEY_ID = /\b(AKIA|ASIA|AIDA|AROA)[0-9A-Z]{16}\b/;

function credentialValue(value: string, extra: ReadonlySet<string>): string | null {
  if (USERINFO_URL.test(value)) return 'a URL with a user name or password';
  if (HEADER_CREDENTIAL.test(value)) return 'an Authorization-style credential';
  if (AWS_ACCESS_KEY_ID.test(value)) return 'an AWS access key id';
  // Query parameters of anything URL-like: `?api_key=…`, `&token=…`.
  const query = value.match(/\?([^#\s]*)/)?.[1];
  if (query && /^[a-z][a-z0-9+.-]*:\/\/|^\//i.test(value)) {
    for (const pair of query.split('&')) {
      const name = decodeURIComponentSafe(pair.split('=')[0] ?? '');
      if (name && credentialKey(name, extra)) return `a URL with a "${name}" query parameter`;
    }
  }
  return null;
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * A credential inside free text (a binding source, a label): URL userinfo,
 * credential query parameters, `Bearer` / `Basic` values, AWS key ids.
 * `null` when clean. Never returns the value itself.
 */
export function credentialInText(value: string): string | null {
  return credentialValue(value, new Set());
}

/** Every credential-looking key or value in `config`, at any depth. */
export function credentialProblems(config: unknown, provider?: Pick<HolodeckProvider, 'secrets'>): string[] {
  const extra = new Set((provider?.secrets ?? []).map((s) => normalizeKey(s.key)));
  const found: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      const what = credentialValue(value, extra);
      if (what) found.push(`${path || 'config'}: looks like ${what}; credentials go in the connection's secrets, never in the document`);
    } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (isObj(value)) {
      for (const [k, v] of Object.entries(value)) {
        const at = path ? `${path}.${k}` : k;
        if (credentialKey(k, extra)) found.push(`${at}: "${k}" looks like a credential; credentials go in the connection's secrets, never in the document`);
        walk(v, at);
      }
    }
  };
  walk(config, '');
  return found;
}

/**
 * Everything wrong with one connection's config before it may be saved:
 * the generic credential scan plus the provider's own validation.
 */
export function connectionConfigProblems(connection: Pick<ProviderConnection, 'provider' | 'config'>, provider?: Pick<HolodeckProvider, 'secrets'>): string[] {
  return [...new Set([...credentialProblems(connection.config, provider), ...providerConfigProblems(connection.provider, connection.config)])];
}
