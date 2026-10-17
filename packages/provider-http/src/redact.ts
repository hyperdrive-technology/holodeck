/**
 * Secret hygiene: every string this provider logs, reports in a status or
 * throws passes through a `Redactor` (thrown errors at one exit point:
 * `redactError` in `connect` and every session method, provider.ts), which replaces each secret value (and
 * the encoded forms it appears in on the wire) with `***`. URLs are logged as
 * origin + path only, because query strings may carry `auth.scheme: "query"`
 * tokens or other sensitive parameters.
 */

export const REDACTED = '***';

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
      // The raw value and the forms it takes in URLs and Basic auth headers.
      for (const form of [secret, encodeURIComponent(secret), new URLSearchParams({ s: secret }).toString().slice(2)]) {
        if (form) needles.add(form);
      }
    }
  };
  const redact = ((text: string) => {
    let out = String(text);
    // Longest first, so a secret that contains another secret is fully replaced.
    for (const needle of [...needles].sort((a, b) => b.length - a.length)) out = out.split(needle).join(REDACTED);
    return out;
  }) as Redactor;
  redact.add = add;
  add(...initial);
  return redact;
}

/** `https://host:port/path` without query, fragment or userinfo. Never throws. */
export function safeUrl(url: string | URL): string {
  try {
    const u = new URL(String(url));
    return `${u.origin}${u.pathname}`;
  } catch {
    return '<invalid url>';
  }
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
