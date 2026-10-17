/**
 * Secret hygiene (same design as @holodeck/provider-http's redact.ts). Every
 * string this provider logs, reports in a status or throws passes through a
 * `Redactor`, which replaces each credential value (access key id, secret
 * access key, session token, external id, and every temporary credential an
 * STS / Cognito exchange returns) with `***`. Thrown errors are rebuilt at a
 * single exit point (`redactError`, used by `connect` and every session method
 * in provider.ts), so no SDK error object, `$response`, `$metadata` or `cause`
 * ever leaves the provider.
 */

export const REDACTED = '***';

/** Longest error/status text we pass on; AWS messages can quote whole canonical requests. */
export const MAX_MESSAGE_LENGTH = 500;

export interface Redactor {
  (text: string): string;
  /** Add secret values after construction (secrets are read when the session connects). */
  add(...secrets: Array<string | undefined>): void;
}

export function createRedactor(initial: Array<string | undefined> = []): Redactor {
  const needles = new Set<string>();
  const add = (...secrets: Array<string | undefined>) => {
    for (const secret of secrets) {
      if (!secret) continue;
      // The raw value and the encoded forms it can take in URLs, query strings,
      // headers and SigV4 canonical requests (which AWS quotes back in
      // SignatureDoesNotMatch messages; RFC 3986 encoding).
      const rfc3986 = encodeURIComponent(secret).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      for (const form of [secret, encodeURIComponent(secret), rfc3986, encodeURI(secret), new URLSearchParams({ s: secret }).toString().slice(2)]) {
        if (form) needles.add(form);
      }
    }
  };
  const redact = ((text: string) => {
    let out = String(text);
    // Longest first, so a secret that contains another secret is fully replaced.
    for (const needle of [...needles].sort((a, b) => b.length - a.length)) out = out.split(needle).join(REDACTED);
    return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…` : out;
  }) as Redactor;
  redact.add = add;
  add(...initial);
  return redact;
}

/** Message of an unknown thrown value, without its stack or attached data. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // fetch() failures put the useful part (ECONNREFUSED …) in `cause`.
    const cause = (error as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    return causeMsg && !error.message.includes(causeMsg) ? `${error.message} (${causeMsg})` : error.message;
  }
  return String(error);
}
