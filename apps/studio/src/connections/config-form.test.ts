import { AWS_CONFIG_SCHEMA } from '@holodeck/provider-aws';
import { HTTP_CONFIG_SCHEMA } from '@holodeck/provider-http';
import { describe, expect, it } from 'vitest';
import { configToForm, describeConfig, formToConfig, validateConfig, type FieldValue, type VariantField } from './config-form';
import { connectionConfigProblems } from './credentials';

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
    expect(describeConfig(undefined)).toEqual({ fields: [], advancedKeys: [], allowsExtra: true });
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

  it('AWS assumeRole without a roleArn: left as it was (no edit) and refused by the provider', () => {
    const form = describeConfig(AWS_CONFIG_SCHEMA);
    const state = configToForm(form, { region: 'eu-west-1', credentials: { type: 'assumeRole' } });
    const { config, problems } = formToConfig(form, state);
    expect(problems).toEqual([]);
    expect(config.credentials).toEqual({ type: 'assumeRole' });
    expect(connectionConfigProblems({ provider: 'aws.cloudwatch', config }).join()).toContain('roleArn');
  });

  // Review of #163 @ 7e01b65: an empty basic-auth user name is valid and must survive editing.
  it('HTTP basic auth with an empty user name round-trips', () => {
    const form = describeConfig(HTTP_CONFIG_SCHEMA);
    const config = { url: 'https://x.test/a', auth: { scheme: 'basic', username: '' } };
    const back = formToConfig(form, configToForm(form, config));
    expect(back).toEqual({ config, problems: [] });
    expect(validateConfig(HTTP_CONFIG_SCHEMA, back.config)).toEqual([]);
    expect(connectionConfigProblems({ provider: 'holodeck.http', config: back.config })).toEqual([]);
  });
});

// Review of holodeck#163: editing a connection must never drop settings the form does not show.
describe('unknown settings survive editing', () => {
  it('schemaless provider: the whole config round-trips through the advanced JSON', () => {
    const form = describeConfig(undefined);
    const config = { endpoint: 'https://api.example.test', nested: { a: [1, 2] }, flag: false };
    const state = configToForm(form, config);
    expect(JSON.parse(state.advanced)).toEqual(config);
    expect(formToConfig(form, state)).toEqual({ config, problems: [] });
  });

  it('schema with additionalProperties: undeclared keys are kept next to the form fields', () => {
    const schema = { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] };
    const form = describeConfig(schema);
    expect(form.allowsExtra).toBe(true);
    const config = { url: 'https://x.test', vendorOption: 3 };
    const state = configToForm(form, config);
    expect(JSON.parse(state.advanced)).toEqual({ vendorOption: 3 });
    expect(formToConfig(form, state).config).toEqual(config);
  });

  it('closed schema (HTTP): nothing extra is offered, declared advanced keys still round-trip', () => {
    expect(describeConfig(HTTP_CONFIG_SCHEMA).allowsExtra).toBe(false);
  });
});

// Review of holodeck#163 @ 076954e: variants are edited as an overlay too.
describe('variants', () => {
  const schema = {
    type: 'object',
    properties: {
      auth: {
        oneOf: [
          { type: 'object', required: ['kind'], properties: { kind: { const: 'none' } } },
          { type: 'object', required: ['kind', 'header'], properties: { kind: { const: 'token' }, header: { type: 'string' }, raw: { type: 'boolean' } } },
        ],
      },
    },
  };
  const form = describeConfig(schema);

  it('an open variant keeps its undeclared properties when one of its fields is edited', () => {
    const config = { auth: { kind: 'token', header: 'X-Key', vendorHint: { a: 1 } } };
    const state = configToForm(form, config);
    state.values.auth = { ...(state.values.auth as Record<string, FieldValue>), header: 'X-Other' };
    expect(formToConfig(form, state)).toEqual({ config: { auth: { kind: 'token', header: 'X-Other', vendorHint: { a: 1 } } }, problems: [] });
  });

  it('a boolean inside a variant is a boolean (checked = true), never "enter a number"', () => {
    const config = { auth: { kind: 'token', header: 'X-Key' } };
    const state = configToForm(form, config);
    expect((state.values.auth as Record<string, FieldValue>).raw).toBe(false);
    state.values.auth = { ...(state.values.auth as Record<string, FieldValue>), raw: true };
    expect(formToConfig(form, state)).toEqual({ config: { auth: { kind: 'token', header: 'X-Key', raw: true } }, problems: [] });
  });

  it('switching the variant starts a fresh object (the old variant’s fields do not apply)', () => {
    const state = configToForm(form, { auth: { kind: 'token', header: 'X-Key', raw: true } });
    state.values.auth = { ...(state.values.auth as Record<string, FieldValue>), kind: 'none' };
    expect(formToConfig(form, state).config).toEqual({ auth: { kind: 'none' } });
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

