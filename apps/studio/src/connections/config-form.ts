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
  /**
   * The schema accepts properties it does not declare (no schema, or
   * `additionalProperties` not `false`): the advanced JSON box is offered for
   * them, and existing ones are kept there (never dropped on save).
   */
  allowsExtra: boolean;
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
  if (!isObj(schema) || !isObj(schema.properties)) return { fields: [], advancedKeys: [], allowsExtra: true };
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const fields: ConfigField[] = [];
  const advancedKeys: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties as Record<string, Schema>)) {
    const field = simpleField(key, prop, required.has(key)) ?? variantField(key, prop, required.has(key));
    if (field) fields.push(field);
    else advancedKeys.push(key);
  }
  return { fields, advancedKeys, allowsExtra: schema.additionalProperties !== false };
}

/** One form input's value: text for strings / numbers / enums, a boolean for checkboxes. */
export type FieldValue = string | boolean;

/**
 * Form state. The form is an OVERLAY on the raw config (review of
 * holodeck#163): `original` is the config being edited, `initial` the form
 * values it produced; `formToConfig` starts from a deep copy of `original`
 * and writes only the form-owned fields whose value differs from `initial`.
 * Anything the form does not show (undeclared keys, extra keys inside a
 * variant, nested objects) is never touched unless the user edits the
 * Advanced JSON, which holds exactly the keys the form does not own.
 */
export interface ConfigFormValues {
  /** Top-level fields; a variant is `{ [discriminator]: value, ...sub-fields }`. */
  values: Record<string, FieldValue | Record<string, FieldValue>>;
  advanced: string;
  /** The config being edited (deep copy). */
  original: Record<string, unknown>;
  /** `values` and `advanced` as `configToForm` produced them. */
  initial: { values: ConfigFormValues['values']; advanced: string };
}

// -----------------------------------------------------------------------------
// Codecs: one per field kind, config value <-> form value.
// -----------------------------------------------------------------------------

type Decoded = { value: unknown } | { absent: true } | { problem: string };

const codecs = {
  /** config -> form */
  toForm(f: SimpleField, v: unknown): FieldValue {
    if (f.kind === 'boolean') return typeof v === 'boolean' ? v : f.default === true;
    return v === undefined || v === null ? '' : String(v);
  },
  /** form -> config. `absent`: leave the key out. `required`: a present-but-empty text value is kept as "" (the schema / provider decide). */
  fromForm(f: SimpleField, input: FieldValue | undefined, inVariant: boolean): Decoded {
    switch (f.kind) {
      case 'boolean':
        return { value: input === true };
      case 'string':
      case 'enum': {
        const text = typeof input === 'string' ? input : '';
        if (text !== '') return { value: text };
        if (!f.required) return { absent: true };
        // Inside a variant an empty required text (HTTP basic auth with an empty user name) is valid data.
        return inVariant ? { value: '' } : { problem: `${f.label}: required` };
      }
      case 'number':
      case 'integer': {
        const text = typeof input === 'string' ? input.trim() : '';
        if (text === '') return f.required ? { problem: `${f.label}: required` } : { absent: true };
        const n = Number(text);
        if (!Number.isFinite(n)) return { problem: `${f.label}: enter a number` };
        if (f.kind === 'integer' && !Number.isInteger(n)) return { problem: `${f.label}: enter a whole number` };
        return { value: n };
      }
    }
  },
};

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T,>(v: T): T => (v === undefined ? v : (structuredClone(v) as T));

/** Config -> form state (for editing an existing connection, or `{}` for a new one). */
export function configToForm(form: ConfigForm, config: Record<string, unknown> = {}): ConfigFormValues {
  const values: ConfigFormValues['values'] = {};
  for (const f of form.fields) {
    const v = config[f.key];
    if (f.kind === 'variant') {
      const obj = isObj(v) ? v : {};
      const chosen = typeof obj[f.discriminator] === 'string' ? (obj[f.discriminator] as string) : (f.defaultVariant ?? '');
      const entry: Record<string, FieldValue> = { [f.discriminator]: chosen };
      const variant = f.variants.find((x) => x.value === chosen);
      // Sub-fields of every variant get an entry (switching variants shows empty inputs); the chosen one's carry the values.
      for (const other of f.variants) for (const sub of other.fields) if (!(sub.key in entry)) entry[sub.key] = codecs.toForm(sub, undefined);
      for (const sub of variant?.fields ?? []) entry[sub.key] = codecs.toForm(sub, obj[sub.key]);
      values[f.key] = entry;
    } else values[f.key] = codecs.toForm(f, v);
  }
  // Everything the form does not own goes to the advanced JSON, declared or not.
  const owned = new Set(form.fields.map((f) => f.key));
  const advancedObj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) if (!owned.has(k) && v !== undefined) advancedObj[k] = v;
  const advanced = Object.keys(advancedObj).length ? JSON.stringify(advancedObj, null, 2) : '';
  return { values, advanced, original: clone(config), initial: { values: clone(values), advanced } };
}

/**
 * Form state -> config: a deep copy of the original config with only the
 * form-owned fields the user changed written over it (see ConfigFormValues).
 * Advanced JSON, if edited, replaces exactly the keys the form does not own;
 * it must be an object and may not repeat a form field.
 */
export function formToConfig(form: ConfigForm, state: ConfigFormValues): { config: Record<string, unknown>; problems: string[] } {
  const original = state.original ?? {};
  const initial = state.initial ?? { values: {}, advanced: '' };
  const config: Record<string, unknown> = clone(original);
  const problems: string[] = [];
  const write = (target: Record<string, unknown>, key: string, d: Decoded) => {
    if ('problem' in d) problems.push(d.problem);
    else if ('absent' in d) delete target[key];
    else target[key] = d.value;
  };

  for (const f of form.fields) {
    const now = state.values[f.key];
    const was = initial.values[f.key];
    if (f.kind === 'variant') {
      const entry = isObj(now) ? (now as Record<string, FieldValue>) : {};
      const before = isObj(was) ? (was as Record<string, FieldValue>) : {};
      const chosen = typeof entry[f.discriminator] === 'string' ? (entry[f.discriminator] as string) : '';
      // Untouched (including a variant shown only because of the schema default): the original stays as it was.
      if (sameValue(entry, before)) {
        if (!chosen && f.required && !isObj(original[f.key])) problems.push(`${f.label}: choose one`);
        continue;
      }
      const switched = chosen !== before[f.discriminator] || !isObj(original[f.key]);
      if (!chosen) {
        if (f.required) problems.push(`${f.label}: choose one`);
        else if (switched) delete config[f.key];
        continue;
      }
      const variant = f.variants.find((v) => v.value === chosen);
      if (!variant) {
        problems.push(`${f.label}: unknown option "${chosen}"`);
        continue;
      }
      // Same variant: overlay on the original object (its undeclared keys stay).
      // Another variant: a fresh object (the old variant's fields do not apply).
      const obj: Record<string, unknown> = switched ? { [f.discriminator]: chosen } : clone(original[f.key] as Record<string, unknown>);
      for (const sub of variant.fields) {
        if (!switched && sameValue(entry[sub.key], before[sub.key])) continue;
        write(obj, sub.key, codecs.fromForm(sub, entry[sub.key], true));
      }
      config[f.key] = obj;
      continue;
    }
    if (sameValue(now, was) && (f.key in original || f.kind === 'boolean' || now === '')) {
      // Unchanged. A required field that is still empty and absent is reported.
      if (f.required && !(f.key in original) && f.kind !== 'boolean') problems.push(`${f.label}: required`);
      continue;
    }
    write(config, f.key, codecs.fromForm(f, now as FieldValue | undefined, false));
  }

  if (state.advanced !== initial.advanced) {
    const owned = new Set(form.fields.map((f) => f.key));
    let parsed: unknown = {};
    if (state.advanced.trim() !== '') {
      try {
        parsed = JSON.parse(state.advanced);
      } catch (error) {
        problems.push(`Advanced settings: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
        parsed = undefined;
      }
    }
    if (parsed !== undefined) {
      if (!isObj(parsed)) problems.push('Advanced settings: must be a JSON object');
      else {
        // The advanced JSON is the whole set of keys the form does not own.
        for (const k of Object.keys(config)) if (!owned.has(k)) delete config[k];
        for (const [k, v] of Object.entries(parsed)) {
          if (owned.has(k)) problems.push(`Advanced settings: "${k}" is set in the form above`);
          else config[k] = v;
        }
      }
    }
  }
  return { config, problems };
}

// -----------------------------------------------------------------------------
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

