import { describe, expect, it } from 'vitest';
import { AWS_CONFIG_SCHEMA, AWS_DEFAULTS, AWS_PROVIDER_SECRETS, AwsConfigError, isValidPeriod, isValidStat, parseAwsConfig } from './config';

const errorsOf = (raw: unknown): string[] => {
  try {
    parseAwsConfig(raw);
    return [];
  } catch (error) {
    expect(error).toBeInstanceOf(AwsConfigError);
    return (error as AwsConfigError).details;
  }
};

describe('parseAwsConfig', () => {
  it('fills defaults from a region alone', () => {
    expect(parseAwsConfig({ region: 'eu-west-1' })).toEqual({
      region: 'eu-west-1',
      regions: ['eu-west-1'],
      credentials: { type: 'static' },
      defaultPeriodS: 60,
      defaultStat: 'Average',
      minPollIntervalMs: 60_000,
      alarmPollIntervalMs: 60_000,
      timeoutMs: 10_000,
      maxAttempts: 3,
      backoff: { ...AWS_DEFAULTS.backoff },
      browseRecentlyActive: true,
      browseMaxItems: 500,
      discover: { maxResources: 1000 },
    });
  });

  it('accepts every credentials type and normalises assumeRole defaults', () => {
    expect(parseAwsConfig({ region: 'eu-west-1', credentials: { type: 'host' } }).credentials).toEqual({ type: 'host' });
    expect(parseAwsConfig({ region: 'eu-west-1', credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::123456789012:role/ReadOnly' } }).credentials).toEqual({
      type: 'assumeRole',
      roleArn: 'arn:aws:iam::123456789012:role/ReadOnly',
      sessionName: 'holodeck',
      durationS: 3600,
    });
    expect(
      parseAwsConfig({
        region: 'cn-north-1',
        credentials: { type: 'assumeRole', roleArn: 'arn:aws-cn:iam::123456789012:role/path/RO', sessionName: 'studio@des', durationS: 900 },
      }).credentials,
    ).toMatchObject({ sessionName: 'studio@des', durationS: 900 });
    expect(
      parseAwsConfig({ region: 'eu-west-1', credentials: { type: 'cognito', identityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' } }).credentials,
    ).toEqual({ type: 'cognito', identityPoolId: 'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0' });
  });

  it('puts the default region first in regions, without duplicates', () => {
    expect(parseAwsConfig({ region: 'eu-west-1', regions: ['us-east-1', 'eu-west-1', 'us-east-1'] }).regions).toEqual(['eu-west-1', 'us-east-1']);
  });

  it('refuses credentials in the document, wherever they are put', () => {
    for (const key of ['accessKeyId', 'secretAccessKey', 'sessionToken', 'aws_secret_access_key', 'AWS_SESSION_TOKEN', 'password', 'secret', 'token']) {
      expect(errorsOf({ region: 'eu-west-1', [key]: 'x' })).toEqual([`${key}: credentials must not be stored in a document; use the connection's secrets`]);
      expect(errorsOf({ region: 'eu-west-1', credentials: { type: 'static', [key]: 'x' } })[0]).toMatch(/must not be stored in a document/);
    }
  });

  it('lists every problem at once, and never echoes a value that might be a secret', () => {
    const details = errorsOf({
      region: 'Europe',
      regions: ['eu-west-1', 'nowhere'],
      credentials: { type: 'assumeRole', roleArn: 'arn:aws:iam::1:user/x', sessionName: 'a', durationS: 10 },
      defaultPeriodS: 45,
      defaultStat: 'Median',
      minPollIntervalMs: 10,
      alarmPollIntervalMs: 1.5,
      lookbackS: 1,
      timeoutMs: 0,
      maxAttempts: 11,
      backoff: { initialMs: 10, maxMs: 5, factor: 0.5, jitter: 2, extra: 1 },
      browseRecentlyActive: 'yes',
      browseMaxItems: 0,
      discover: { resourceTypes: ['EC2 instance'], tags: [{ key: '' }], maxResources: 0, other: 1 },
      typo: true,
    });
    expect(details).toEqual(
      expect.arrayContaining([
        'typo: unknown setting',
        'region: must be an AWS region such as eu-west-1',
        'regions: not AWS regions: "nowhere"',
        'credentials.roleArn: must be an IAM role ARN (arn:aws:iam::<account>:role/<name>)',
        'credentials.sessionName: 2–64 characters of [A-Za-z0-9_+=,.@-]',
        'credentials.durationS: must be an integer between 900 and 43200',
        expect.stringMatching(/^defaultPeriodS:/),
        expect.stringMatching(/^defaultStat:/),
        'minPollIntervalMs: must be an integer between 1000 and 86400000',
        'alarmPollIntervalMs: must be an integer between 1000 and 86400000',
        'lookbackS: must be an integer between 60 and 1296000',
        'timeoutMs: must be an integer between 100 and 120000',
        'maxAttempts: must be an integer between 1 and 10',
        'backoff.extra: unknown setting',
        'backoff.factor: must be a number between 1 and 10',
        'backoff.jitter: must be a number between 0 and 1',
        'backoff.maxMs: must be ≥ backoff.initialMs',
        'browseRecentlyActive: must be a boolean',
        'browseMaxItems: must be an integer between 1 and 10000',
        'discover.other: unknown setting',
        'discover.maxResources: must be an integer between 1 and 100000',
        expect.stringMatching(/^discover.resourceTypes:/),
        expect.stringMatching(/^discover.tags:/),
      ]),
    );
    expect(details.length).toBe(23);
  });

  it.each([
    [null, 'config: must be an object'],
    [[], 'config: must be an object'],
    [{}, 'region: must be an AWS region such as eu-west-1'],
    [{ region: 'eu-west-1', credentials: 'static' }, 'credentials: must be an object with a type'],
    [{ region: 'eu-west-1', credentials: { type: 'iam' } }, 'credentials.type: must be one of static, assumeRole, cognito, host'],
    [{ region: 'eu-west-1', credentials: { type: 'cognito', identityPoolId: 'pool' } }, 'credentials.identityPoolId: must be <region>:<uuid>'],
    [{ region: 'eu-west-1', regions: [] }, 'regions: must be a list of 1–40 regions'],
    [{ region: 'eu-west-1', backoff: 3 }, 'backoff: must be an object'],
    [{ region: 'eu-west-1', discover: [] }, 'discover: must be an object'],
  ])('rejects %j', (raw, message) => {
    expect(errorsOf(raw)).toContain(message);
  });

  it('accepts discover filters and copies them', () => {
    const tags = [{ key: 'env', values: ['prod'] }, { key: 'team' }];
    const config = parseAwsConfig({ region: 'eu-west-1', discover: { resourceTypes: ['ec2:instance', 's3'], tags, maxResources: 50 } });
    expect(config.discover).toEqual({ resourceTypes: ['ec2:instance', 's3'], tags, maxResources: 50 });
    tags[0]?.values?.push('dev');
    expect(config.discover.tags?.[0]?.values).toEqual(['prod']);
  });
});

describe('validators and schema', () => {
  it('isValidPeriod / isValidStat', () => {
    expect([1, 5, 10, 20, 30, 60, 600, 86_400].every(isValidPeriod)).toBe(true);
    expect([0, 2, 45, 61, 1.5, -60, NaN, '60', 31 * 86_400].some(isValidPeriod)).toBe(false);
    expect(['Average', 'p99', 'p99.99', 'tm(1)'].map(isValidStat)).toEqual([true, true, true, false]);
  });

  it('the schema requires region, has no secret fields and matches the secrets list', () => {
    expect(AWS_CONFIG_SCHEMA.required).toEqual(['region']);
    const text = JSON.stringify(AWS_CONFIG_SCHEMA);
    for (const secret of AWS_PROVIDER_SECRETS) expect(text).not.toContain(`"${secret.key}":`);
    expect(AWS_PROVIDER_SECRETS.map((s) => s.key)).toEqual(['accessKeyId', 'secretAccessKey', 'sessionToken', 'externalId']);
    expect(AWS_PROVIDER_SECRETS.every((s) => s.optional)).toBe(true);
  });
});
