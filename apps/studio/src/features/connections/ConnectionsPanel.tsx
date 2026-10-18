import { HOLODECK_KINDS, type ConnectionState, type HolodeckDocument, type HolodeckHost, type HolodeckProvider, type ProviderConnection } from '@holodeck/sdk';
import type { IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { PencilIcon, PlugIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { connectionUsages } from '../../connections/bindings';
import type { SessionSecretStore } from '../../connections/secrets';
import { ConnectionDialog, type ConnectionSubmit } from './ConnectionDialog';
import { StatusBadge } from './StatusBadge';

/**
 * The document's provider connections: status, add / edit / remove. A
 * connection that bindings still use cannot be removed (the document would
 * no longer validate); the panel lists where it is used instead.
 */
export function ConnectionsPanel({
  host,
  doc,
  statuses,
  secrets,
  onSave,
  onRemove,
}: {
  host: HolodeckHost;
  doc: HolodeckDocument<IsoSceneFile>;
  statuses: Readonly<Record<string, ConnectionState>>;
  secrets: SessionSecretStore;
  onSave: (submit: ConnectionSubmit, isNew: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ProviderConnection | 'new' | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; usages: string[] } | null>(null);
  // Re-render when secrets change (the "set" markers).
  useSyncExternalStore(secrets.subscribe, secrets.getVersion);
  const connections = doc.connections ?? [];
  const providerLabel = (id: string) => host.registry.get<HolodeckProvider>(HOLODECK_KINDS.provider, id)?.label ?? `${id} (not installed)`;
  /**
   * Secrets this tab does not have, worth pointing out: required ones always,
   * optional ones once the connection is failing (an HTTP token is optional
   * in the schema but the configured auth scheme may need it).
   */
  const missingSecrets = (c: ProviderConnection) => {
    const unset = (host.registry.get<HolodeckProvider>(HOLODECK_KINDS.provider, c.provider)?.secrets ?? []).filter(
      (s) => !secrets.has(doc.id, c.id, s.key),
    );
    return statuses[c.id]?.status.state === 'error' ? unset : unset.filter((s) => !s.optional);
  };

  return (
    <section aria-labelledby="connections-heading" className="flex flex-col gap-2 px-4 pb-4" data-testid="connections-panel">
      <header className="flex items-center gap-2 pt-4">
        <h2 id="connections-heading" className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Connections
        </h2>
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}>
          <PlusIcon /> Add
        </Button>
      </header>
      {connections.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <PlugIcon className="mr-1 inline size-3" />
          No connections yet. Add one, then bind object parameters to its signals in the inspector.
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {connections.map((c) => (
          <li key={c.id} className="rounded-md border p-2 text-sm" data-testid={`connection-${c.id}`}>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium" title={c.id}>
                {c.label ?? c.id}
              </span>
              <StatusBadge state={statuses[c.id]} testId={`connection-status-${c.id}`} />
              <Button variant="ghost" size="icon-sm" aria-label={`Edit connection ${c.id}`} onClick={() => setEditing(c)}>
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove connection ${c.id}`}
                onClick={() => {
                  const usages = connectionUsages(doc.body, c.id);
                  if (usages.length) setBlocked({ id: c.id, usages });
                  else onRemove(c.id);
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              <code>{c.id}</code> · {providerLabel(c.provider)}
            </p>
            {statuses[c.id]?.status.message ? <p className="truncate text-xs text-muted-foreground">{statuses[c.id]!.status.message}</p> : null}
            {missingSecrets(c).length ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Not set in this tab: {missingSecrets(c).map((s) => s.label).join(', ')} (secrets are never saved with the document; edit the
                connection to enter them).
              </p>
            ) : null}
            {blocked?.id === c.id ? (
              <p role="alert" className="text-xs text-destructive">
                Still used by {blocked.usages.join(', ')}. Remove those bindings first.
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {editing ? (
        <ConnectionDialog
          host={host}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          {...(editing === 'new' ? {} : { existing: editing })}
          takenIds={connections.map((c) => c.id).filter((id) => editing === 'new' || id !== editing.id)}
          secretIsSet={(key) => editing !== 'new' && secrets.has(doc.id, editing.id, key)}
          onSubmit={(submit) => {
            onSave(submit, editing === 'new');
            setEditing(null);
          }}
        />
      ) : null}
    </section>
  );
}
