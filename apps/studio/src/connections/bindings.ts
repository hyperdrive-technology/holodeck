/**
 * Bindings (`placement.bindings[param] = { connection, source, transform? }`)
 * and their transforms as editable forms. Validation is the SDK's own
 * (`validateTransform`), so the editor accepts exactly what documents accept.
 */

import { validateTransform, type ProviderConnection, type SignalBinding, type SignalValue, type ValueTransform } from '@holodeck/sdk';
import type { IsoPlacement, IsoSceneFile } from '@holodeck/editor-2.5d-react';

export type TransformKind = 'none' | ValueTransform['kind'];
export const TRANSFORM_KINDS: readonly TransformKind[] = ['none', 'scale', 'threshold', 'map', 'format'];

/** Text form of a transform: every field a string, lists as "key = value" lines. */
export interface TransformForm {
  kind: TransformKind;
  inMin: string;
  inMax: string;
  outMin: string;
  outMax: string;
  clamp: boolean;
  /** threshold: one "at = value" per line; map: one "input = value" per line. */
  lines: string;
  /** threshold `below` / map `default`. */
  fallback: string;
  template: string;
  digits: string;
}

export const EMPTY_TRANSFORM_FORM: TransformForm = {
  kind: 'none',
  inMin: '0',
  inMax: '100',
  outMin: '0',
  outMax: '1',
  clamp: true,
  lines: '',
  fallback: '',
  template: '{value}',
  digits: '',
};

/** "42" -> 42, "true" -> true, "null" -> null, '"x"' -> "x", anything else -> the text itself. */
export function parseSignalValue(text: string): SignalValue {
  const t = text.trim();
  try {
    const v: unknown = JSON.parse(t);
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  } catch {
    // Plain text.
  }
  return t;
}

/**
 * Text for a signal value in the editor, lossless with `parseSignalValue`
 * (holodeck#165): a string is shown bare only when reading it back gives the
 * same string; otherwise (`"7"`, `"true"`, `""`, multi-line, padded, quoted)
 * it is shown JSON-quoted.
 */
export function showValue(v: SignalValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v !== 'string') return JSON.stringify(v);
  return v !== '' && !/[\n\r]/.test(v) && parseSignalValue(v) === v ? v : JSON.stringify(v);
}

/** A map case key as text: bare unless it has `=`, a line break, padding or a leading quote. */
function showKey(k: string): string {
  return k === '' || /[=\n\r"]/.test(k) || k.trim() !== k ? JSON.stringify(k) : k;
}

function readKey(text: string): string {
  if (text.startsWith('"')) {
    try {
      const v: unknown = JSON.parse(text);
      if (typeof v === 'string') return v;
    } catch {
      // Fall through: the raw text.
    }
  }
  return text;
}

export function transformToForm(t: ValueTransform | undefined): TransformForm {
  if (!t) return EMPTY_TRANSFORM_FORM;
  switch (t.kind) {
    case 'scale':
      return { ...EMPTY_TRANSFORM_FORM, kind: 'scale', inMin: String(t.inMin), inMax: String(t.inMax), outMin: String(t.outMin), outMax: String(t.outMax), clamp: t.clamp !== false };
    case 'threshold':
      return { ...EMPTY_TRANSFORM_FORM, kind: 'threshold', lines: t.steps.map((s) => `${s.at} = ${showValue(s.value)}`).join('\n'), fallback: showValue(t.below) };
    case 'map':
      return { ...EMPTY_TRANSFORM_FORM, kind: 'map', lines: Object.entries(t.cases).map(([k, v]) => `${showKey(k)} = ${showValue(v)}`).join('\n'), fallback: showValue(t.default) };
    case 'format':
      return { ...EMPTY_TRANSFORM_FORM, kind: 'format', template: t.template, digits: t.digits === undefined ? '' : String(t.digits) };
  }
}

function pairs(lines: string): Array<[string, string]> {
  return lines
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // A JSON-quoted key may itself contain `=`: split after its closing quote.
      const quoted = l.startsWith('"') ? /^"(?:[^"\\]|\\.)*"/.exec(l)?.[0] : undefined;
      const from = quoted ? quoted.length : 0;
      const i = l.indexOf('=', from);
      return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    });
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

/** Form -> transform (undefined for `none`) plus every problem, via the SDK's `validateTransform`. */
export function formToTransform(f: TransformForm): { transform?: ValueTransform; problems: string[] } {
  let t: ValueTransform;
  switch (f.kind) {
    case 'none':
      return { problems: [] };
    case 'scale':
      t = { kind: 'scale', inMin: num(f.inMin), inMax: num(f.inMax), outMin: num(f.outMin), outMax: num(f.outMax), ...(f.clamp ? {} : { clamp: false }) };
      break;
    case 'threshold':
      t = {
        kind: 'threshold',
        steps: pairs(f.lines).map(([at, value]) => ({ at: num(at), value: parseSignalValue(value) })),
        ...(f.fallback.trim() ? { below: parseSignalValue(f.fallback) } : {}),
      };
      break;
    case 'map':
      t = {
        kind: 'map',
        cases: Object.fromEntries(pairs(f.lines).map(([k, v]) => [readKey(k), parseSignalValue(v)])),
        ...(f.fallback.trim() ? { default: parseSignalValue(f.fallback) } : {}),
      };
      break;
    case 'format':
      t = { kind: 'format', template: f.template, ...(f.digits.trim() ? { digits: num(f.digits) } : {}) };
      break;
  }
  const problems = validateTransform(t, 'transform');
  return problems.length ? { problems } : { transform: t, problems };
}

/** Problems with a binding before it is written into a placement. */
export function bindingProblems(connections: readonly ProviderConnection[] | undefined, binding: SignalBinding): string[] {
  const problems: string[] = [];
  if (!(connections ?? []).some((c) => c.id === binding.connection)) problems.push('connection: choose one of the document’s connections');
  if (binding.source.trim() === '') problems.push('source: required');
  if (binding.transform) problems.push(...validateTransform(binding.transform, 'transform'));
  return problems;
}

/** `bindings` with `param` set (or removed when `binding` is undefined); `undefined` when nothing is left. */
export function withBinding(
  bindings: IsoPlacement['bindings'],
  param: string,
  binding: SignalBinding | undefined,
): IsoPlacement['bindings'] | undefined {
  const next: Record<string, SignalBinding> = { ...(bindings ?? {}) };
  if (binding) next[param] = binding;
  else delete next[param];
  return Object.keys(next).length ? next : undefined;
}

/** Every `objectId.param` bound to `connectionId`. */
export function connectionUsages(scene: IsoSceneFile, connectionId: string): string[] {
  const out: string[] = [];
  for (const o of scene.objects) {
    for (const [param, b] of Object.entries(o.bindings ?? {})) if (b.connection === connectionId) out.push(`${o.id}.${param}`);
  }
  return out;
}

/** Connection ids are document-scoped handles: letters, digits, `-`, `_`, `.`; unique in the document. */
export function connectionIdProblem(id: string, existing: readonly string[]): string | null {
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(id)) return 'id: start with a letter; letters, digits, - _ . only (max 64)';
  if (existing.includes(id)) return `id: "${id}" is already used in this document`;
  return null;
}
