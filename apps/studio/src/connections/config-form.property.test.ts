/**
 * Property test for the connection form (review of holodeck#163): the form is
 * an overlay on the raw config, so for ANY schema-valid config
 *
 *   configToForm -> formToConfig (no edits)      is the identity, and
 *   a single form-field edit                       changes only that field.
 *
 * Configs are generated from the real HTTP and AWS schemas and from a
 * synthetic open schema with variants, booleans, nested objects and extra
 * keys, with a seeded PRNG (deterministic, no extra dependency), and kept
 * only when the schema itself (Ajv) accepts them.
 */
import { AWS_CONFIG_SCHEMA } from '@holodeck/provider-aws';
import { HTTP_CONFIG_SCHEMA } from '@holodeck/provider-http';
import { describe, expect, it } from 'vitest';
import { configToForm, describeConfig, formToConfig, validateConfig, type ConfigForm, type FieldValue, type SimpleField, type VariantField } from './config-form';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[int(r, 0, xs.length - 1)]!;

/** Values known to satisfy the patterns in the real schemas. */
const PATTERN_SAMPLES = [
  'eu-west-1',
  'us-east-2',
  'arn:aws:iam::123456789012:role/Reader',
  'eu-west-1:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  'holodeck',
  'Average',
  'p95',
  'AWS/EC2',
  'https://x.test/a',
  'wss://x.test/s',
];
const WORDS = ['a', 'pump', 'Line 2', 'üñí', '', 'x/y', 'with space', '42', 'true'];

function genString(r: Rng, s: Schema): string | undefined {
  if (typeof s.pattern === 'string') {
    const re = new RegExp(s.pattern);
    const ok = PATTERN_SAMPLES.filter((x) => re.test(x));
    return ok.length ? pick(r, ok) : undefined;
  }
  if (s.format === 'uri') return pick(r, ['https://x.test/a', 'http://127.0.0.1:9/m', 'wss://x.test/s']);
  let v = pick(r, WORDS);
  if (typeof s.minLength === 'number' && v.length < s.minLength) v = v.padEnd(s.minLength as number, 'z');
  if (typeof s.maxLength === 'number') v = v.slice(0, s.maxLength as number);
  return v;
}

function genAny(r: Rng, depth: number): Json {
  const k = int(r, 0, depth > 2 ? 3 : 5);
  if (k === 0) return pick(r, [null, true, false]);
  if (k === 1) return int(r, -5, 500);
  if (k === 2 || k === 3) return pick(r, WORDS);
  if (k === 4) return [genAny(r, depth + 1), genAny(r, depth + 1)];
  return { [`k${int(r, 0, 9)}`]: genAny(r, depth + 1) };
}

function gen(r: Rng, s: Schema, depth = 0): Json | undefined {
  if ('const' in s) return s.const as Json;
  if (Array.isArray(s.enum)) return pick(r, s.enum as Json[]);
  if (Array.isArray(s.oneOf)) return gen(r, pick(r, s.oneOf as Schema[]), depth);
  switch (s.type) {
    case 'string':
      return genString(r, s);
    case 'boolean':
      return r() < 0.5;
    case 'integer':
    case 'number': {
      const lo = typeof s.minimum === 'number' ? (s.minimum as number) : 0;
      const hi = typeof s.maximum === 'number' ? (s.maximum as number) : lo + 1000;
      const n = int(r, Math.ceil(lo), Math.floor(Math.min(hi, lo + 100000)));
      return s.type === 'number' && r() < 0.3 && n < hi ? n + 0.5 : n;
    }
    case 'array': {
      if (depth > 3) return [];
      const items = isObj(s.items) ? s.items : {};
      const out: Json[] = [];
      for (let i = int(r, 0, 2); i > 0; i--) {
        const v = gen(r, items, depth + 1);
        if (v !== undefined) out.push(v);
      }
      return out;
    }
    case 'object':
    default: {
      if (!isObj(s.properties) && s.type !== 'object') return genAny(r, depth);
      const out: Record<string, Json> = {};
      const req = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      for (const [k, sub] of Object.entries((s.properties ?? {}) as Record<string, Schema>)) {
        if (!req.has(k) && (r() < 0.5 || depth > 3)) continue;
        const v = gen(r, sub, depth + 1);
        if (v !== undefined) out[k] = v;
      }
      if (s.additionalProperties !== false && depth < 3) {
        for (let i = int(r, 0, 2); i > 0; i--) {
          const extraSchema = isObj(s.additionalProperties) ? s.additionalProperties : undefined;
          const v = extraSchema ? gen(r, extraSchema, depth + 1) : genAny(r, depth + 1);
          if (v !== undefined) out[`extra_${int(r, 0, 99)}`] = v;
        }
      }
      return out;
    }
  }
}

/** A synthetic open-schema provider: variants (open), booleans inside variants, nested objects, extra keys. */
const SYNTHETIC_SCHEMA: Schema = {
  type: 'object',
  required: ['endpoint'],
  properties: {
    endpoint: { type: 'string' },
    retries: { type: 'integer', minimum: 0, maximum: 10 },
    ratio: { type: 'number', minimum: 0, maximum: 1 },
    verbose: { type: 'boolean', default: false },
    mode: { enum: ['fast', 'safe', 'off'] },
    auth: {
      oneOf: [
        { type: 'object', required: ['kind'], properties: { kind: { const: 'none' } } },
        { type: 'object', required: ['kind', 'header'], properties: { kind: { const: 'token' }, header: { type: 'string' }, raw: { type: 'boolean' } } },
        { type: 'object', required: ['kind', 'user'], properties: { kind: { const: 'basic' }, user: { type: 'string' }, port: { type: 'integer', minimum: 1, maximum: 65535 } } },
      ],
    },
    limits: { type: 'object', properties: { max: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } } },
  },
};

const SCHEMAS: Array<[string, Schema]> = [
  ['HTTP', HTTP_CONFIG_SCHEMA as Schema],
  ['AWS', AWS_CONFIG_SCHEMA as Schema],
  ['synthetic open schema', SYNTHETIC_SCHEMA],
];

function validConfigs(schema: Schema, count: number, seed: number): Array<Record<string, unknown>> {
  const r = rng(seed);
  const out: Array<Record<string, unknown>> = [];
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const c = gen(r, schema);
    if (isObj(c) && validateConfig(schema, c).length === 0) out.push(c);
  }
  return out;
}

/** A different valid value for a simple field (undefined when there is none). */
function edited(r: Rng, f: SimpleField, current: FieldValue | undefined): { form: FieldValue; config: unknown } | undefined {
  switch (f.kind) {
    case 'boolean': {
      const v = !(current === true);
      return { form: v, config: v };
    }
    case 'enum': {
      const options = (f.options ?? []).filter((o) => o !== current);
      if (!options.length) return undefined;
      const v = pick(r, options);
      return { form: v, config: v };
    }
    case 'string': {
      const v = `${typeof current === 'string' ? current : ''}-edited`;
      return { form: v, config: v };
    }
    case 'number':
    case 'integer': {
      const lo = f.min ?? 0;
      const hi = f.max ?? lo + 1000;
      const now = typeof current === 'string' && current !== '' ? Number(current) : undefined;
      const choices = [lo, hi, Math.floor((lo + hi) / 2)].filter((n) => n !== now && Number.isFinite(n));
      if (!choices.length) return undefined;
      const v = pick(r, choices);
      return { form: String(v), config: v };
    }
  }
}

function editableTargets(form: ConfigForm, state: ReturnType<typeof configToForm>) {
  const targets: Array<{ field: SimpleField; variant?: VariantField }> = [];
  for (const f of form.fields) {
    if (f.kind !== 'variant') targets.push({ field: f });
    else {
      const entry = state.values[f.key] as Record<string, FieldValue>;
      const chosen = f.variants.find((v) => v.value === entry[f.discriminator]);
      // Only edit inside a variant the config already has (switching variants is not a one-field edit).
      if (chosen && isObj(state.original[f.key])) for (const sub of chosen.fields) targets.push({ field: sub, variant: f });
    }
  }
  return targets;
}

describe.each(SCHEMAS)('config form overlay: %s', (_name, schema) => {
  const form = describeConfig(schema);
  const configs = validConfigs(schema, 150, 7);

  it('generates enough schema-valid configs', () => {
    expect(configs.length).toBeGreaterThan(100);
  });

  it('configToForm -> formToConfig with no edits is the identity', () => {
    for (const config of configs) {
      const result = formToConfig(form, configToForm(form, config));
      expect(result.problems, JSON.stringify(config)).toEqual([]);
      expect(result.config, JSON.stringify(config)).toEqual(config);
    }
  });

  it('a single-field edit changes only that field', () => {
    const r = rng(11);
    let edits = 0;
    for (const config of configs) {
      const state = configToForm(form, config);
      const targets = editableTargets(form, state);
      if (!targets.length) continue;
      const { field, variant } = pick(r, targets);
      const entry = variant ? (state.values[variant.key] as Record<string, FieldValue>) : undefined;
      const current = entry ? entry[field.key] : (state.values[field.key] as FieldValue);
      const edit = edited(r, field, current);
      if (!edit) continue;
      if (variant && entry) state.values[variant.key] = { ...entry, [field.key]: edit.form };
      else state.values[field.key] = edit.form;
      const expected = structuredClone(config);
      if (variant) (expected[variant.key] as Record<string, unknown>)[field.key] = edit.config;
      else expected[field.key] = edit.config;
      const result = formToConfig(form, state);
      expect(result.problems, JSON.stringify({ config, field: field.key })).toEqual([]);
      expect(result.config, JSON.stringify({ config, field: field.key })).toEqual(expected);
      edits++;
    }
    expect(edits).toBeGreaterThan(50);
  });
});
