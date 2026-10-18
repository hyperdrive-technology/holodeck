import { describe, expect, it } from 'vitest';
import { connectionFingerprint as fp } from './fingerprint';

const http = (config: Record<string, unknown>) => fp({ provider: 'holodeck.http', config });
const aws = (config: Record<string, unknown>) => fp({ provider: 'aws.cloudwatch', config });

describe('connectionFingerprint (holodeck#166)', () => {
  it('HTTP: changes with the origin or the auth scheme, not with path, interval or key order', () => {
    const base = http({ url: 'https://api.example.com/v1/m', auth: { scheme: 'bearer' }, intervalMs: 1000 });
    expect(http({ intervalMs: 5000, auth: { scheme: 'bearer' }, url: 'https://api.example.com/v2/other' })).toBe(base);
    expect(http({ url: 'https://evil.example.com/v1/m', auth: { scheme: 'bearer' } })).not.toBe(base);
    expect(http({ url: 'http://api.example.com/v1/m', auth: { scheme: 'bearer' } })).not.toBe(base);
    expect(http({ url: 'https://api.example.com:8443/v1/m', auth: { scheme: 'bearer' } })).not.toBe(base);
    expect(http({ url: 'https://api.example.com/v1/m', auth: { scheme: 'query', name: 'k' } })).not.toBe(base);
  });

  it('AWS: changes with region, credential mode, role or pool', () => {
    const base = aws({ region: 'eu-west-1', credentials: { type: 'static' } });
    expect(aws({ region: 'eu-west-1', minPollIntervalMs: 120000 })).toBe(base); // static is the default
    expect(aws({ region: 'us-east-1' })).not.toBe(base);
    expect(aws({ region: 'eu-west-1', credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::1:role/A' } })).not.toBe(
      aws({ region: 'eu-west-1', credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::1:role/B' } }),
    );
  });

  it('unknown providers: any config change differs; providers never share', () => {
    expect(fp({ provider: 'acme.x', config: { a: 1, b: 2 } })).toBe(fp({ provider: 'acme.x', config: { b: 2, a: 1 } }));
    expect(fp({ provider: 'acme.x', config: { a: 1 } })).not.toBe(fp({ provider: 'acme.x', config: { a: 2 } }));
    expect(fp({ provider: 'acme.x', config: {} })).not.toBe(fp({ provider: 'acme.y', config: {} }));
  });
});
