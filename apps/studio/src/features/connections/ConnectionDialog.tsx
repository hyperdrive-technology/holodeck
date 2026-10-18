import { HOLODECK_KINDS, type HolodeckHost, type HolodeckProvider, type ProviderConnection } from '@holodeck/sdk';
import { useForm } from '@tanstack/react-form';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectionIdProblem } from '../../connections/bindings';
import { connectionConfigProblems, credentialInText } from '../../connections/credentials';
import { connectionFingerprint } from '../../connections/fingerprint';
import {
  configToForm,
  describeConfig,
  formToConfig,
  validateConfig,
  type ConfigField,
  type ConfigFormValues,
  type FieldValue,
  type SimpleField,
} from '../../connections/config-form';

/** What a submit hands back: the connection for the document, and secret changes for sessionStorage only. */
export interface ConnectionSubmit {
  connection: ProviderConnection;
  /** key -> new value; '' = clear. Keys not present are unchanged. */
  secrets: Record<string, string>;
}

interface FormState {
  provider: string;
  id: string;
  label: string;
  config: ConfigFormValues;
  secrets: Record<string, string>;
  clear: Record<string, boolean>;
}

const selectClass = 'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm';

/**
 * Add or edit one provider connection. Non-secret settings come from the
 * provider's `configSchema` (connections/config-form.ts); secrets are
 * password fields that never show a stored value, only whether one is set,
 * and are handed back separately so they never reach the document.
 */
export function ConnectionDialog({
  host,
  open,
  onOpenChange,
  existing,
  takenIds,
  secretIsSet,
  onSubmit,
}: {
  host: HolodeckHost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing this connection (provider and id fixed); absent = adding one. */
  existing?: ProviderConnection;
  /** Ids already used in the document (other than `existing`). */
  takenIds: readonly string[];
  /** Is `key` stored for this connection at `fingerprint` (the endpoint as currently filled in)? */
  secretIsSet: (key: string, fingerprint: string) => boolean;
  onSubmit: (result: ConnectionSubmit) => void;
}) {
  const providers = host.registry.list<HolodeckProvider>(HOLODECK_KINDS.provider);
  const [problems, setProblems] = useState<string[]>([]);
  const initialProvider = existing?.provider ?? providers[0]?.id ?? '';
  const providerOf = (id: string) => providers.find((p) => p.id === id);
  const formOf = (id: string) => describeConfig(providerOf(id)?.configSchema);

  const form = useForm({
    defaultValues: {
      provider: initialProvider,
      id: existing?.id ?? '',
      label: existing?.label ?? '',
      config: configToForm(formOf(initialProvider), existing?.config as Record<string, unknown> | undefined),
      secrets: {},
      clear: {},
    } as FormState,
    onSubmit: ({ value }) => {
      // Checked here (not as a form-level validator) so every problem is listed at once.
      const found = submitProblems(value);
      setProblems(found);
      if (found.length) return;
      const provider = providerOf(value.provider);
      const { config } = formToConfig(formOf(value.provider), value.config);
      const connection: ProviderConnection = { id: value.id.trim(), provider: value.provider };
      if (value.label.trim()) connection.label = value.label.trim();
      if (Object.keys(config).length) connection.config = config;
      const secrets: Record<string, string> = {};
      for (const spec of provider?.secrets ?? []) {
        if (value.clear[spec.key]) secrets[spec.key] = '';
        else if (value.secrets[spec.key]) secrets[spec.key] = value.secrets[spec.key]!;
      }
      onSubmit({ connection, secrets });
    },
  });

  function submitProblems(value: FormState): string[] {
    const provider = providerOf(value.provider);
    if (!provider) return ['provider: choose one'];
    const problems: string[] = [];
    if (!existing) {
      const idProblem = connectionIdProblem(value.id.trim(), takenIds);
      if (idProblem) problems.push(idProblem);
    }
    const inLabel = credentialInText(value.label);
    if (inLabel) problems.push(`label: looks like ${inLabel}; credentials go in the secrets fields`);
    const { config, problems: formProblems } = formToConfig(formOf(value.provider), value.config);
    problems.push(...formProblems);
    if (!formProblems.length) {
      problems.push(...validateConfig(provider.configSchema, config));
      problems.push(...connectionConfigProblems({ provider: provider.id, config }, provider));
    }
    return problems;
  }

    function renderProviderFields(provider: HolodeckProvider | undefined, configState: ConfigFormValues) {
    const described = describeConfig(provider?.configSchema);
    // Secrets count as set only for the endpoint as currently filled in: point
    // the connection elsewhere and they must be entered again (holodeck#166).
    const fingerprint = provider ? connectionFingerprint({ provider: provider.id, config: formToConfig(described, configState).config }) : '';
    const isSet = (key: string) => !!existing && secretIsSet(key, fingerprint);
    const endpointChanged =
      !!existing && !!provider && fingerprint !== connectionFingerprint(existing) && (provider.secrets ?? []).some((spec) => secretIsSet(spec.key, connectionFingerprint(existing)));
    if (!provider) return null;
    return (
      <>
        {provider.description ? <p className="text-xs text-muted-foreground">{provider.description}</p> : null}
        <form.Field name="config">
          {(field) => {
            const state = field.state.value;
            const setValue = (key: string, value: ConfigFormValues['values'][string]) =>
              field.handleChange({ ...state, values: { ...state.values, [key]: value } });
            return (
              <fieldset className="flex flex-col gap-3" data-testid="connection-config">
                {described.fields.map((f) => (
                  <ConfigInput key={f.key} field={f} value={state.values[f.key]} onChange={(v) => setValue(f.key, v)} />
                ))}
                {/* Also for schemaless / open schemas: otherwise their settings cannot be entered (review of #163). */}
                {described.advancedKeys.length || described.allowsExtra || state.advanced.trim() ? (
                  <Row
                    label="Advanced"
                    htmlFor="connection-advanced"
                    hint={described.advancedKeys.length ? `JSON object with any of: ${described.advancedKeys.join(', ')}` : 'JSON object with the provider’s settings'}
                  >
                    <textarea
                      id="connection-advanced"
                      className="min-h-16 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
                      value={state.advanced}
                      onChange={(e) => field.handleChange({ ...state, advanced: e.target.value })}
                      placeholder="{}"
                    />
                  </Row>
                ) : null}
              </fieldset>
            );
          }}
        </form.Field>
        {provider.secrets?.length ? (
          <fieldset className="flex flex-col gap-3 rounded-md border p-3" data-testid="connection-secrets">
            <legend className="px-1 text-xs font-semibold">Secrets (this browser tab only)</legend>
          {endpointChanged ? (
            <p role="status" data-testid="secrets-endpoint-changed" className="text-xs text-amber-700 dark:text-amber-300">
              The connection now points somewhere else: secrets entered for the old endpoint will not be sent there. Enter them again.
            </p>
          ) : null}
            {provider.secrets.map((spec) => (
              <form.Field key={spec.key} name="secrets">
                {(field) => (
                  <Row label={spec.label} htmlFor={`secret-${spec.key}`} hint={spec.description}>
                    <div className="flex items-center gap-2">
                      <Input
                        id={`secret-${spec.key}`}
                        type="password"
                        autoComplete="off"
                        value={field.state.value[spec.key] ?? ''}
                        onChange={(e) => field.handleChange({ ...field.state.value, [spec.key]: e.target.value })}
                        placeholder={isSet(spec.key) ? '•••••• set (leave empty to keep)' : spec.optional ? 'optional' : 'required'}
                      />
                      {isSet(spec.key) ? (
                        <form.Field name="clear">
                          {(clear) => (
                            <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                              <input
                                type="checkbox"
                                checked={clear.state.value[spec.key] === true}
                                onChange={(e) => clear.handleChange({ ...clear.state.value, [spec.key]: e.target.checked })}
                              />
                              Clear
                            </label>
                          )}
                        </form.Field>
                      ) : null}
                    </div>
                  </Row>
                )}
              </form.Field>
            ))}
          </fieldset>
        ) : null}
        {provider.sourceSyntax ? <p className="text-xs text-muted-foreground">Sources: <code>{provider.sourceSyntax}</code></p> : null}
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="connection-dialog">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit connection “${existing.label ?? existing.id}”` : 'Add connection'}</DialogTitle>
          <DialogDescription>
            Settings are saved in the document. Secrets stay in this browser tab only (session storage; a duplicated tab gets a copy), bound
            to the endpoint they were entered for: they are never saved, exported or embedded.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          // The schema check below lists every problem; the browser's own
          // constraint check (min/max) would block the submit with one bubble.
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="provider">
            {(field) => (
              <Row label="Provider" htmlFor="connection-provider">
                <select
                  id="connection-provider"
                  className={selectClass}
                  value={field.state.value}
                  disabled={!!existing}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    form.setFieldValue('config', configToForm(formOf(e.target.value)));
                    form.setFieldValue('secrets', {});
                  }}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.id})
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </form.Field>
          <form.Field name="id">
            {(field) => (
              <Row label="Id" htmlFor="connection-id" hint="Used by bindings; cannot change later.">
                <Input id="connection-id" value={field.state.value} disabled={!!existing} onChange={(e) => field.handleChange(e.target.value)} placeholder="plant" />
              </Row>
            )}
          </form.Field>
          <form.Field name="label">
            {(field) => (
              <Row label="Label" htmlFor="connection-label">
                <Input id="connection-label" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="optional" />
              </Row>
            )}
          </form.Field>
          <form.Subscribe selector={(s) => [s.values.provider, s.values.config] as const}>
            {([providerId, configState]) => <div key={providerId} className="flex flex-col gap-3">{renderProviderFields(providerOf(providerId), configState)}</div>}
          </form.Subscribe>
          {problems.length ? (
            <ul role="alert" data-testid="connection-problems" className="list-disc pl-5 text-xs text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{existing ? 'Save' : 'Add'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfigInput({ field, value, onChange }: { field: ConfigField; value: ConfigFormValues['values'][string] | undefined; onChange: (v: ConfigFormValues['values'][string]) => void }) {
  if (field.kind === 'variant') {
    const entry = (value && typeof value === 'object' ? value : {}) as Record<string, FieldValue>;
    const chosen = field.variants.find((v) => v.value === entry[field.discriminator]);
    return (
      <div className="flex flex-col gap-2">
        <Row label={field.label} htmlFor={`config-${field.key}`} hint={chosen?.description ?? field.description}>
          <select
            id={`config-${field.key}`}
            className={selectClass}
            value={typeof entry[field.discriminator] === 'string' ? (entry[field.discriminator] as string) : ''}
            onChange={(e) => onChange({ ...entry, [field.discriminator]: e.target.value })}
          >
            {!field.required ? <option value="">none</option> : null}
            {field.variants.map((v) => (
              <option key={v.value} value={v.value}>
                {v.value}
              </option>
            ))}
          </select>
        </Row>
        {chosen?.fields.map((sub) => (
          <ScalarInput
            key={sub.key}
            id={`config-${field.key}-${sub.key}`}
            field={{ ...sub, label: `${field.label} ${sub.label}` }}
            value={entry[sub.key]}
            // Keep the input's own type: a checkbox stays a boolean (review of #163).
            onChange={(v) => onChange({ ...entry, [sub.key]: v })}
          />
        ))}
      </div>
    );
  }
  return <ScalarInput id={`config-${field.key}`} field={field} value={value as string | boolean | undefined} onChange={onChange} />;
}

function ScalarInput({ id, field, value, onChange }: { id: string; field: SimpleField; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  const hint = [field.description, field.default !== undefined && field.kind !== 'boolean' ? `default ${JSON.stringify(field.default)}` : '']
    .filter(Boolean)
    .join(' · ');
  if (field.kind === 'boolean') {
    return (
      <Row label={field.label} htmlFor={id} hint={field.description}>
        <input id={id} type="checkbox" className="size-4" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
      </Row>
    );
  }
  if (field.kind === 'enum') {
    return (
      <Row label={field.label} htmlFor={id} hint={hint}>
        <select id={id} className={selectClass} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.required ? 'choose…' : 'default'}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </Row>
    );
  }
  return (
    <Row label={`${field.label}${field.required ? ' *' : ''}`} htmlFor={id} hint={hint}>
      <Input
        id={id}
        type={field.kind === 'string' ? 'text' : 'number'}
        min={field.min}
        max={field.max}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </Row>
  );
}

function Row({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  const hintId = useId();
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-2">
      <Label htmlFor={htmlFor} className="pt-2">
        {label}
      </Label>
      <div className="flex min-w-0 flex-col gap-1" aria-describedby={hint ? hintId : undefined}>
        {children}
        {hint ? (
          <p id={hintId} className="text-[11px] text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
