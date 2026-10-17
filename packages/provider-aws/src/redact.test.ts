import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';
import { AwsConfigError } from './config';
import { AwsProviderError, classify, redactError, toProviderError } from './errors';
import { createRedactor, errorMessage, MAX_MESSAGE_LENGTH, REDACTED } from './redact';
import { SourceSyntaxError } from './source';

describe('createRedactor', () => {
  it('replaces every secret and its encodings, longest first, and bounds the length', () => {
    const r = createRedactor(['abc/def+', undefined, '']);
    r.add('abc/def+ghi');
    expect(r('x abc/def+ghi y abc/def+ z abc%2Fdef%2B w abc%2Fdef%2Bghi')).toBe(`x ${REDACTED} y ${REDACTED} z ${REDACTED} w ${REDACTED}`);
    expect(r('a'.repeat(MAX_MESSAGE_LENGTH + 10)).length).toBe(MAX_MESSAGE_LENGTH + 1);
    expect(r(42 as unknown as string)).toBe('42');
  });

  it('errorMessage includes a fetch cause once', () => {
    expect(errorMessage(new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }))).toBe('fetch failed (ECONNREFUSED)');
    expect(errorMessage(new Error('x ECONNREFUSED', { cause: 'ECONNREFUSED' }))).toBe('x ECONNREFUSED');
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('error classification', () => {
  const sdkError = (name: string, status?: number, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(`${name} happened`), { name, $metadata: status === undefined ? {} : { httpStatusCode: status }, ...extra });

  it.each([
    [sdkError('ThrottlingException', 400), 'throttled'],
    [sdkError('Throttling', 400), 'throttled'],
    [sdkError('ThrottledException', 400), 'throttled'],
    [sdkError('Whatever', 429), 'throttled'],
    [sdkError('Whatever', 400, { $retryable: { throttling: true } }), 'throttled'],
    [sdkError('AccessDeniedException', 400), 'auth'],
    [sdkError('ExpiredTokenException', 400), 'auth'],
    [sdkError('Whatever', 403), 'auth'],
    [sdkError('InternalFailure', 500), 'aws'],
    [sdkError('ResourceNotFound', 404), 'aws'],
    [new TypeError('fetch failed'), 'network'],
    [sdkError('TimeoutError'), 'network'],
    [sdkError('AbortError'), 'network'],
    [new AwsConfigError(['x']), 'config'],
    [new SourceSyntaxError('x', 's'), 'config'],
    [new AwsProviderError('x', 'closed'), 'closed'],
    ['a string', 'network'],
  ])('%#: %s → %s', (error, kind) => {
    expect(classify(error).kind).toBe(kind);
  });

  it('toProviderError formats operation, region and code, redacted', () => {
    const r = createRedactor(['SECRETKEY']);
    const err = toProviderError(Object.assign(new Error('bad SECRETKEY'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), 'GetMetricData', 'eu-west-1', r);
    expect(err).toMatchObject({ kind: 'auth', code: 'AccessDenied', message: `GetMetricData eu-west-1: AccessDenied: bad ${REDACTED}` });
    // No duplicate code when the message already starts with it.
    expect(toProviderError(Object.assign(new Error('Throttling: Rate exceeded'), { name: 'Throttling', $metadata: { httpStatusCode: 400 } }), 'Op', 'r', r).message).toBe('Op r: Throttling: Rate exceeded');
  });

  it('redactError rebuilds each error type without attached data', () => {
    const r = createRedactor(['S3CR3T']);
    const cases: Array<[unknown, string]> = [
      [new AwsProviderError('a S3CR3T', 'aws', 'Code'), 'AwsProviderError'],
      [new SourceSyntaxError('b S3CR3T', 'src S3CR3T'), 'SourceSyntaxError'],
      [new AwsConfigError(['c S3CR3T']), 'AwsConfigError'],
      [new RangeError('d S3CR3T'), 'RangeError'],
      [new TypeError('e S3CR3T'), 'TypeError'],
      [Object.assign(new Error('f S3CR3T'), { name: 'InternalFailure', $metadata: { httpStatusCode: 500 }, $response: { headers: { authorization: 'S3CR3T' } } }), 'AwsProviderError'],
    ];
    for (const [input, name] of cases) {
      const out = redactError(input, r) as Error & Record<string, unknown>;
      expect(out.name).toBe(name);
      expect(JSON.stringify({ ...out, message: out.message })).not.toContain('S3CR3T');
      expect(out.$response).toBeUndefined();
      expect(out.$metadata).toBeUndefined();
    }
    expect((redactError(new SourceSyntaxError('x', 'S3CR3T'), r) as SourceSyntaxError).source).toBe(REDACTED);
  });
});

describe('backoffDelay', () => {
  const cfg = { initialMs: 2000, maxMs: 300_000, factor: 2, jitter: 0.2 };
  it('grows exponentially, caps, spreads with jitter and survives huge attempts', () => {
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, { ...cfg, jitter: 0 }))).toEqual([2000, 4000, 8000, 16000]);
    expect(backoffDelay(100, { ...cfg, jitter: 0 })).toBe(300_000);
    expect(backoffDelay(1, cfg, () => 0)).toBe(1600);
    expect(backoffDelay(1, cfg, () => 1)).toBe(2400);
    expect(backoffDelay(0, cfg, () => 0.5)).toBe(2000);
    expect(backoffDelay(1e9, cfg, () => 2)).toBe(300_000);
  });
});
