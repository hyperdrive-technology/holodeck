/**
 * Text of a `label` placement from its resolved params, so a host can bind a
 * tag to `value` and show live readings on the floor.
 *
 *   text    template; `{value}` is replaced by the formatted reading. If the
 *           template has no `{value}` and a value exists, " {value}" is appended
 *           ("Mash" + 64.2 -> "Mash 64.2 °C"). Static labels (no value) show `text` as-is.
 *   value   number | boolean | string | null | undefined (undefined = static label).
 *   unit    appended to numeric readings ("°C"); not to ON/OFF or enum names.
 *   format  'auto' (default: boolean -> ON/OFF, number -> one decimal),
 *           'int' (no decimals), 'onoff' (truthy -> ON).
 *   labels  enum names for integer states, `{"0":"HeatHLT"}` or "0=HeatHLT,1=FillMash".
 */
export type LabelFormat = 'auto' | 'int' | 'onoff';

const NO_READING = '--';

function parseLabels(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return Object.fromEntries(
      raw
        .split(',')
        .map((pair) => pair.split('='))
        .filter((kv): kv is [string, string] => kv.length === 2 && kv[0]!.trim() !== '')
        .map(([k, v]) => [k.trim(), v.trim()]),
    );
  }
  return {};
}

export function formatLabelValue(params: Record<string, unknown>): string {
  const { value, unit, format, labels } = params;
  if (value === undefined || value === null || value === '') return NO_READING;
  const names = parseLabels(labels);
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (typeof value === 'string' && !Number.isFinite(Number(value))) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return NO_READING;
  if (format === 'onoff') return n !== 0 ? 'ON' : 'OFF';
  const named = names[String(n)];
  if (named !== undefined) return named;
  const text = format === 'int' ? n.toFixed(0) : n.toFixed(1);
  return typeof unit === 'string' && unit ? `${text} ${unit}` : text;
}

export function formatLabelText(params: Record<string, unknown>): string {
  const template = String(params.text ?? '');
  if (params.value === undefined) return template;
  const withSlot = template.includes('{value}') ? template : `${template} {value}`.trimStart();
  return withSlot.split('{value}').join(formatLabelValue(params));
}
