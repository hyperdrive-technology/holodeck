/**
 * A provider's `configSchema` (JSON Schema 2020-12) as a form.
 *
 * Generic on purpose: the studio knows no provider. The form covers what a
 * person fills in by hand: top-level strings, numbers, booleans, enums, and
 * `oneOf` object variants told apart by a `const` property (HTTP `auth`
 * scheme, AWS `credentials` type), each with its own simple fields. Anything
 * else (nested objects such as `backoff`, arrays, free JSON `body`) is edited
 * as one "advanced" JSON object. Validation is the schema itself, through Ajv
 * (the canonical JSON Schema validator), so the form can never accept what
 * the provider's schema rejects.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';

type Schema = Record<string, unknown>;

export interface SimpleField {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'enum';
  required: boolean;
  default?: unknown;
  description?: string;
  options?: string[];
  min?: number;
  max?: number;
}

export interface VariantField {
  key: string;
  label: string;
  kind: 'variant';
  required: boolean;
  description?: string;
  /** The property whose `const` names the variant (`scheme`, `type`). */
  discriminator: string;
  variants: Array<{ value: string; description?: string; fields: SimpleField[] }>;
  /** Variant used when the field is absent (schema `default`), if any. */
  defaultVariant?: string;
}

export type ConfigField = SimpleField | VariantField;

export interface ConfigForm {
  fields: ConfigField[];
  /** Properties edited as JSON. */
  advancedKeys: string[];
}

const isObj = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v);
const titleCase = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function simpleField(key: string, schema: Schema, required: boolean): SimpleField | undefined {
  const base = {
    key,
    label: typeof schema.title === 'string' ? schema.title : titleCase(key),
    required,
    ...(schema.default !== undefined ? { default: schema.default } : {}),
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
  };
  if (Array.isArray(schema.enum) && schema.enum.every((v) => typeof v === 'string')) {
    return { ...base, kind: 'enum', options: schema.enum as string[] };
  }
  const bounds = {
    ...(typeof schema.minimum === 'number' ? { min: schema.minimum } : {}),
    ...(typeof schema.maximum === 'number' ? { max: schema.maximum } : {}),
  };
  switch (schema.type) {
    case 'string':
      return { ...base, kind: 'string' };
    case 'boolean':
      return { ...base, kind: 'boolean' };
    case 'number':
      return { ...base, kind: 'number', ...bounds };
    case 'integer':
      return { ...base, kind: 'integer', ...bounds };
    default:
      return undefined;
  }
}

function variantField(key: string, schema: Schema, required: boolean): VariantField | undefined {
  const variants = schema.oneOf;
  if (!Array.isArray(variants) || variants.length === 0 || !variants.every(isObj)) return undefined;
  const first = variants[0]!.properties;
  if (!isObj(first)) return undefined;
  const discriminator = Object.keys(first).find((k) =>
    variants.every((v) => isObj(v.properties) && isObj(v.properties[k]) && typeof (v.properties[k] as Schema).const === 'string'),
  );
  if (!discriminator) return undefined;
  const out: VariantField['variants'] = [];
  for (const v of variants) {
    const props = v.properties as Record<string, Schema>;
    const req = new Set(Array.isArray(v.required) ? (v.required as string[]) : []);
    const fields: SimpleField[] = [];
    for (const [k, s] of Object.entries(props)) {
      if (k === discriminator) continue;
      const f = simpleField(k, s, req.has(k));
      if (!f) return undefined; // a nested structure: leave the whole field to JSON
      fields.push(f);
    }
    out.push({ value: props[discriminator]!.const as string, ...(typeof v.description === 'string' ? { description: v.description } : {}), fields });
  }
  const dflt = isObj(schema.default) ? schema.default[discriminator] : undefined;
  return {
    key,
    label: titleCase(key),
    kind: 'variant',
    required,
    discriminator,
    variants: out,
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
    ...(typeof dflt === 'string' ? { defaultVariant: dflt } : {}),
  };
}

/** Split a config schema into form fields and JSON-edited keys. No schema = everything advanced. */
export function describeConfig(schema: unknown): ConfigForm {
  if (!isObj(schema) || !isObj(schema.properties)) return { fields: [], advancedKeys: [] };
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fields: ConfigField[] = [];
  const advancedKeys: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties as Record<string, Schema>)) {
    const field = simpleField(key, prop, required.has(key)) ?? variantField(key, prop, required.has(key));
    if (field) fields.push(field);
    else advancedKeys.push(key);
  }
  return { fields, advancedKeys };
}

/** Form state: simple fields as strings / booleans, variants as `{ [discriminator]: value, ...fields }`, the rest as JSON text. */
export interface ConfigFormValues {
  values: Record<string, string | boolean | Record<string, string>>;
  advanced: string;
}

const toText = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Current config -> form state (for editing an existing connection). */
export function configToForm(form: ConfigForm, config: Record<string, unknown> = {}): ConfigFormValues {
  const values: ConfigFormValues['values'] = {};
  for (const f of form.fields) {
    const v = config[f.key];
    if (f.kind === 'variant') {
      const obj = isObj(v) ? v : {};
      const chosen = typeof obj[f.discriminator] === 'string' ? (obj[f.discriminator] as string) : (f.defaultVariant ?? '');
      const entry: Record<string, string> = { [f.discriminator]: chosen };
      for (const variant of f.variants) for (const sub of variant.fields) entry[sub.key] = toText(obj[sub.key]);
      values[f.key] = entry;
    } else if (f.kind === 'boolean') values[f.key] = typeof v === 'boolean' ? v : f.default === true;
    else values[f.key] = toText(v);
  }
  const advanced: Record<string, unknown> = {};
  for (const k of form.advancedKeys) if (config[k] !== undefined) advanced[k] = config[k];
  return { values, advanced: Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : '' };
}

function parseScalar(f: SimpleField, text: string): { value?: unknown; problem?: string } {
  if (f.kind === 'string' || f.kind === 'enum') return { value: text };
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) return { problem: `${f.label}: enter a number` };
  if (f.kind === 'integer' && !Number.isInteger(n)) return { problem: `${f.label}: enter a whole number` };
  return { value: n };
}

/**
 * Form state -> config. Empty optional fields are left out (the provider's
 * default applies); a variant left at "none" is left out. Advanced JSON must
 * be an object and may not repeat a form field.
 */
export function formToConfig(form: ConfigForm, state: ConfigFormValues): { config: Record<string, unknown>; problems: string[] } {
  const config: Record<string, unknown> = {};
  const problems: string[] = [];
  for (const f of form.fields) {
    const raw = state.values[f.key];
    if (f.kind === 'variant') {
      const entry = isObj(raw) ? (raw as Record<string, string>) : {};
      const chosen = entry[f.discriminator];
      if (!chosen) {
        if (f.required) problems.push(`${f.label}: choose one`);
        continue;
      }
      const variant = f.variants.find((v) => v.value === chosen);
      if (!variant) {
        problems.push(`${f.label}: unknown option "${chosen}"`);
        continue;
      }
      const obj: Record<string, unknown> = { [f.discriminator]: chosen };
      for (const sub of variant.fields) {
        const text = entry[sub.key] ?? '';
        if (text === '') {
          if (sub.required) problems.push(`${f.label} ${sub.label}: required`);
          continue;
        }
        const parsed = parseScalar(sub, text);
        if (parsed.problem) problems.push(parsed.problem);
        else obj[sub.key] = parsed.value;
      }
      config[f.key] = obj;
      continue;
    }
    if (f.kind === 'boolean') {
      if (raw !== undefined && raw !== f.default) config[f.key] = raw === true;
      continue;
    }
    const text = typeof raw === 'string' ? raw : '';
    if (text === '') {
      if (f.required) problems.push(`${f.label}: required`);
      continue;
    }
    const parsed = parseScalar(f, text);
    if (parsed.problem) problems.push(parsed.problem);
    else config[f.key] = parsed.value;
  }
  if (state.advanced.trim() !== '') {
    let advanced: unknown;
    try {
      advanced = JSON.parse(state.advanced);
    } catch (error) {
      problems.push(`Advanced settings: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    if (advanced !== undefined) {
      if (!isObj(advanced)) problems.push('Advanced settings: must be a JSON object');
      else {
        for (const [k, v] of Object.entries(advanced)) {
          if (form.fields.some((f) => f.key === k)) problems.push(`Advanced settings: "${k}" is set in the form above`);
          else config[k] = v;
        }
      }
    }
  }
  return { config, problems };
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

// `strict: false`: provider schemas may use keywords Ajv's strict mode flags
// (unknown formats, `$schema` URIs). `validateFormats: false`: formats such as
// `uri` need ajv-formats; the provider re-checks its own config on connect.
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const compiled = new WeakMap<object, ValidateFunction>();

function describeError(e: ErrorObject): string {
  const at = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'config';
  if (e.keyword === 'additionalProperties') return `${at}: unknown setting "${String(e.params.additionalProperty)}"`;
  if (e.keyword === 'required') return `${at}: "${String(e.params.missingProperty)}" is required`;
  return `${at}: ${e.message ?? 'is invalid'}`;
}

/** Every problem the provider's schema finds in `config`; empty = valid (or no schema). */
export function validateConfig(schema: unknown, config: unknown): string[] {
  if (!isObj(schema)) return [];
  let validate = compiled.get(schema);
  if (!validate) {
    try {
      validate = ajv.compile(schema);
    } catch (error) {
      return [`the provider's config schema could not be compiled: ${error instanceof Error ? error.message : String(error)}`];
    }
    compiled.set(schema, validate);
  }
  if (validate(config)) return [];
  // oneOf failures repeat per variant; keep each message once.
  return [...new Set((validate.errors ?? []).map(describeError))];
}

