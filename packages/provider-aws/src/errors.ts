/**
 * Errors the provider throws or reports. AWS SDK errors are classified and
 * rebuilt as `AwsProviderError` (message, kind, AWS error code only), so no
 * SDK object with request/response metadata escapes.
 */

import { AwsConfigError } from './config';
import { errorMessage, type Redactor } from './redact';
import { SourceSyntaxError } from './source';

/**
 * - `config`: bad connection settings or missing secrets.
 * - `auth`: AWS refused the credentials (expired token, access denied, bad signature).
 * - `throttled`: AWS rate limit; the poller backs off and never polls faster than its interval.
 * - `network`: fetch failed, timed out, or targeted an origin outside `permissions.network`.
 * - `aws`: any other AWS service error.
 * - `closed` / `unsupported`: session closed, or an operation this source kind does not support.
 */
export type AwsFailureKind = 'config' | 'auth' | 'throttled' | 'network' | 'aws' | 'closed' | 'unsupported';

export class AwsProviderError extends Error {
  constructor(
    message: string,
    readonly kind: AwsFailureKind,
    /** AWS error code, e.g. `ThrottlingException`. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AwsProviderError';
  }
}

const THROTTLE_CODES = new Set([
  'Throttling',
  'ThrottlingException',
  'ThrottledException',
  'TooManyRequestsException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'LimitExceededException',
  'SlowDown',
]);

const AUTH_CODES = new Set([
  'AccessDenied',
  'AccessDeniedException',
  'UnauthorizedOperation',
  'UnrecognizedClientException',
  'InvalidClientTokenId',
  'InvalidAccessKeyId',
  'ExpiredToken',
  'ExpiredTokenException',
  'SignatureDoesNotMatch',
  'InvalidSignatureException',
  'IncompleteSignature',
  'MissingAuthenticationToken',
  'NotAuthorizedException',
  'CredentialsProviderError',
]);

interface SdkErrorShape {
  name?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  $retryable?: { throttling?: unknown };
}

/** Classify an unknown thrown value (AWS SDK service error, fetch failure, our own errors). */
export function classify(error: unknown): { kind: AwsFailureKind; code?: string } {
  if (error instanceof AwsProviderError) return { kind: error.kind, code: error.code };
  if (error instanceof AwsConfigError || error instanceof SourceSyntaxError) return { kind: 'config' };
  const e = (typeof error === 'object' && error !== null ? error : {}) as SdkErrorShape;
  const code = typeof e.name === 'string' ? e.name : undefined;
  const status = typeof e.$metadata?.httpStatusCode === 'number' ? e.$metadata.httpStatusCode : undefined;
  if ((code && THROTTLE_CODES.has(code)) || status === 429 || e.$retryable?.throttling === true) {
    return { kind: 'throttled', code };
  }
  if ((code && AUTH_CODES.has(code)) || status === 401 || status === 403) return { kind: 'auth', code };
  if (status !== undefined) return { kind: 'aws', code };
  // No HTTP status: the request never got an answer (fetch TypeError, timeout, abort).
  if (code === 'AbortError' || code === 'TimeoutError' || error instanceof TypeError) return { kind: 'network', code };
  return { kind: code && /Exception$|Error$/.test(code) && code !== 'Error' ? 'aws' : 'network', code };
}

/**
 * Wrap a failed AWS call as an `AwsProviderError` with a bounded, redacted
 * message: `<operation> <region>: <code>: <message>`.
 */
export function toProviderError(error: unknown, operation: string, region: string, redact: Redactor): AwsProviderError {
  if (error instanceof AwsProviderError) return new AwsProviderError(redact(error.message), error.kind, error.code);
  const { kind, code } = classify(error);
  const message = errorMessage(error);
  const head = code && code !== 'Error' && !message.startsWith(code) ? `${code}: ` : '';
  return new AwsProviderError(redact(`${operation} ${region}: ${head}${message}`), kind, code);
}

/**
 * The single exit point for thrown errors (see redact.ts): rebuilds every
 * error type we throw with redacted text and nothing attached.
 */
export function redactError(error: unknown, redact: Redactor): Error {
  if (error instanceof AwsProviderError) return new AwsProviderError(redact(error.message), error.kind, error.code);
  if (error instanceof SourceSyntaxError) return new SourceSyntaxError(redact(error.message), redact(error.source));
  if (error instanceof AwsConfigError) return new AwsConfigError(error.details.map(redact));
  if (error instanceof RangeError) return new RangeError(redact(error.message));
  if (error instanceof TypeError) return new TypeError(redact(error.message));
  const { kind, code } = classify(error);
  return new AwsProviderError(redact(errorMessage(error)), kind, code);
}
