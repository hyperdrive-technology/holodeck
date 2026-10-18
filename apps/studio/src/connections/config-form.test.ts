import { AWS_CONFIG_SCHEMA, AWS_PROVIDER_SECRETS } from '@holodeck/provider-aws';
import { HTTP_CONFIG_SCHEMA, HTTP_PROVIDER_SECRETS } from '@holodeck/provider-http';
import { describe, expect, it } from 'vitest';
import { configToForm, describeConfig, formToConfig, secretsInConfig, validateConfig, type VariantField } from './config-form';

describe('describeConfig', () => {
  it('HTTP: url/mode/interval as fields, auth as a variant, nested objects as advanced JSON', () => {
    const form = describeConfig(HTTP_CONFIG_SCHEMA);
    const keys = form.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['url', 'mode', 'intervalMs', 'timeoutMs', 'method', 'followRedirects', 'auth']));
    expect(form.fields.find((f) => f.key === 'url')).toMatchObject({ kind: 'string', required: true });
    expect(form.fields.find((f) => f.key === 'mode')).toMatchObject({ kind: 'enum', options: ['poll', 'sse', 'websocket'] });
    const auth = form.fields.find((f) => f.key === 'auth') as VariantField;
    expect(auth.discriminator).toBe('scheme');
    expect(auth.variants.map((v) => v.value)).toEqual(['bearer', 'header', 'query', 'basic']);
    expect(auth.variants.find((v) => v.value === 'basic')?.fields.map((f) => f.key)).toEqual(['username']);
    expect(form.advancedKeys).toEqual(expect.arrayContaining(['backoff', 'headers', 'write']));
  });

  it('AWS: region required, credentials a variant defaulting to static', () => {
    const form = describeConfig(AWS_CONFIG_SCHEMA);
    expect(form.fields.find((f) => f.key === 'region')).toMatchObject({ kind: 'string', required: true });
    const creds = form.fields.find((f) => f.key === 'credentials') as VariantField;
    expect(creds).toMatchObject({ discriminator: 'type', defaultVariant: 'static' });
    expect(creds.variants.map((v) => v.value)).toEqual(['static', 'assumeRole', 'cognito', 'host']);
    expect(creds.variants.find((v) => v.value === 'assumeRole')?.fields.find((f) => f.key === 'durationS')).toMatchObject({ kind: 'integer', min: 900, max: 43200 });
  });

  it('no schema: no fields', () => {
    expect(describeConfig(undefined)).toEqual({ fields: [], advancedKeys: [] });
  });
});

describe('form <-> config', () => {
  it('round-trips an HTTP config with auth and advanced settings', () => {
    const form = describeConfig(HTTP_CONFIG_SCHEMA);
    const config = { url: 'http://localhost:9999/m', mode: 'poll', intervalMs: 500, auth: { scheme: 'header', name: 'X-Key' }, backoff: { initialMs: 200 } };
    const state = configToForm(form, config);
    expect(state.values.auth).toMatchObject({ scheme: 'header', name: 'X-Key' });
    const back = formToConfig(form, state);
    expect(back.problems).toEqual([]);
    expect(back.config).toEqual(config);
    expect(validateConfig(HTTP_CONFIG_SCHEMA, back.config)).toEqual([]);
  });

  it('leaves empty optional fields out and reports missing required ones', () => {
    const form = describeConfig(HTTP_CONFIG_SCHEMA);
    const state = configToForm(form, {});
    expect(formToConfig(form, state).problems).toContain('Url: required');
    (state.values as Record<string, unknown>).url = 'http://x.test/a';
    expect(formToConfig(form, state)).toEqual({ config: { url: 'http://x.test/a' }, problems: [] });
  });

  it('rejects non-numbers, bad advanced JSON and duplicates of form fields', () => {
    const form = describeConfig(HTTP_CONFIG_SCHEMA);
    const state = configToForm(form, { url: 'http://x.test' });
    (state.values as Record<string, unknown>).intervalMs = 'fast';
    state.advanced = '{"url": "http://other"}';
    const { problems } = formToConfig(form, state);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining('enter a number'), expect.stringContaining('"url" is set in the form')]));
    state.advanced = '[1]';
    expect(formToConfig(form, state).problems).toContain('Advanced settings: must be a JSON object');
    state.advanced = '{nope';
    expect(formToConfig(form, state).problems.join()).toContain('not valid JSON');
  });

  it('AWS assumeRole variant needs its roleArn', () => {
    const form = describeConfig(AWS_CONFIG_SCHEMA);
    const state = configToForm(form, { region: 'eu-west-1', credentials: { type: 'assumeRole' } });
    expect(formToConfig(form, state).problems).toContain('Credentials Role Arn: required');
  });
});

describe('validateConfig (provider schema through Ajv)', () => {
  it('accepts valid configs and explains invalid ones', () => {
    expect(validateConfig(AWS_CONFIG_SCHEMA, { region: 'eu-west-1' })).toEqual([]);
    expect(validateConfig(AWS_CONFIG_SCHEMA, { region: 'mars' }).join()).toContain('region');
    expect(validateConfig(AWS_CONFIG_SCHEMA, {}).join()).toContain('"region" is required');
    expect(validateConfig(HTTP_CONFIG_SCHEMA, { url: 'http://x', bogus: 1 }).join()).toContain('unknown setting "bogus"');
    expect(validateConfig(HTTP_CONFIG_SCHEMA, { url: 'http://x', intervalMs: 10 }).join()).toContain('intervalMs');
  });

  it('no schema = nothing to check', () => {
    expect(validateConfig(undefined, { anything: true })).toEqual([]);
  });
});

describe('secretsInConfig', () => {
  it('finds provider secret names anywhere in a config', () => {
    expect(secretsInConfig({ secrets: HTTP_PROVIDER_SECRETS }, { url: 'x', token: 'abc' })[0]).toContain('"token" is a secret');
    expect(secretsInConfig({ secrets: AWS_PROVIDER_SECRETS }, { region: 'eu-west-1', nested: [{ SecretAccessKey: 'k' }] })[0]).toContain('nested[0].SecretAccessKey');
    expect(secretsInConfig({ secrets: HTTP_PROVIDER_SECRETS }, { url: 'x', auth: { scheme: 'bearer' } })).toEqual([]);
    expect(secretsInConfig(undefined, { token: 'x' })).toEqual([]);
  });
});
