import { type HolodeckProvider, type ProviderConnection, type ProviderHub, type SignalBinding, type SignalNode } from '@holodeck/sdk';
import { ChevronLeftIcon, ChevronRightIcon, FolderSearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { bindingProblems, formToTransform, suggestedTransformForm, TRANSFORM_KINDS, transformToForm, type ParamRange, type TransformForm } from '../../connections/bindings';

const selectClass = 'h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Bind one object parameter to a provider signal: connection, source
 * (typed, or picked with the provider's `browse`), optional transform.
 */
export function BindingDialog({
  paramLabel,
  paramRange,
  connections,
  current,
  hub,
  providerOf,
  onSave,
  onClose,
}: {
  paramLabel: string;
  /** The parameter's declared numeric range, for the transform suggested when a browse leaf is picked. */
  paramRange?: ParamRange;
  connections: readonly ProviderConnection[];
  current: SignalBinding | undefined;
  hub: ProviderHub | undefined;
  providerOf: (connection: ProviderConnection | undefined) => HolodeckProvider | undefined;
  /** `undefined` removes the binding. */
  onSave: (binding: SignalBinding | undefined) => void;
  onClose: () => void;
}) {
  const [connection, setConnection] = useState(current?.connection ?? connections[0]?.id ?? '');
  const [source, setSource] = useState(current?.source ?? '');
  const [transform, setTransform] = useState<TransformForm>(transformToForm(current?.transform));
  const [problems, setProblems] = useState<string[]>([]);
  /** Set when picking a browse leaf filled in a suggested transform (shown, so the user can change it). */
  const [suggested, setSuggested] = useState(false);
  const conn = connections.find((c) => c.id === connection);
  const provider = providerOf(conn);

  const pick = (node: SignalNode) => {
    if (!node.source) return;
    setSource(node.source);
    const next = suggestedTransformForm(node, paramRange, transform);
    if (next) {
      setTransform(next);
      setSuggested(true);
    }
  };

  const save = () => {
    const t = formToTransform(transform);
    const binding: SignalBinding = { connection, source: source.trim(), ...(t.transform ? { transform: t.transform } : {}) };
    const all = [...t.problems, ...bindingProblems(connections, binding)];
    setProblems(all);
    if (!all.length) onSave(binding);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl" data-testid="binding-dialog">
        <DialogHeader>
          <DialogTitle>Bind “{paramLabel}”</DialogTitle>
          <DialogDescription>The live value replaces the parameter while the document is open (canvas and embeds).</DialogDescription>
        </DialogHeader>
        {current && !connections.some((c) => c.id === current.connection) ? (
          <p role="alert" data-testid="binding-dangling" className="text-sm text-destructive">
            This binding uses connection “{current.connection}”, which the document no longer has. Remove the binding, or bind it to another
            connection.
          </p>
        ) : null}
        {connections.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">This document has no connections yet. Add one in the Connections tab first.</p>
            {current ? (
              <div className="flex justify-start">
                <Button type="button" variant="outline" className="text-destructive" onClick={() => onSave(undefined)}>
                  Remove binding
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
              <Label htmlFor="binding-connection">Connection</Label>
              <select id="binding-connection" className={selectClass} value={connection} onChange={(e) => setConnection(e.target.value)}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label ?? c.id} ({c.provider})
                  </option>
                ))}
              </select>
              <Label htmlFor="binding-source">Source</Label>
              <Input id="binding-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder={provider?.sourceSyntax ?? 'signal address'} />
            </div>
            {provider?.sourceSyntax ? (
              <p className="text-[11px] text-muted-foreground">
                Syntax: <code>{provider.sourceSyntax}</code>
              </p>
            ) : null}
            {provider?.capabilities.browse ? <SourceBrowser key={connection} hub={hub} connectionId={connection} onPick={pick} /> : null}
            {suggested && transform.kind === 'scale' ? (
              <p className="text-[11px] text-muted-foreground" data-testid="binding-suggested-scale">
                Scaled {transform.inMin}–{transform.inMax} to {paramLabel}’s range {transform.outMin}–{transform.outMax}. Change “in min / in max” if
                the signal uses another range.
              </p>
            ) : null}
            <TransformEditor value={transform} onChange={setTransform} />
            {problems.length ? (
              <ul role="alert" data-testid="binding-problems" className="list-disc pl-5 text-xs text-destructive">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-between gap-2 pt-2">
              {current ? (
                <Button type="button" variant="outline" className="text-destructive" onClick={() => onSave(undefined)}>
                  Remove binding
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit">Bind</Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Walks the provider's `browse` tree; picking a leaf with a `source` fills the
 * source field. The top level is listed as soon as the dialog opens when the
 * connection is already open, so the signals are discoverable without
 * knowing the provider's address syntax; otherwise "Browse" retries.
 */
function SourceBrowser({ hub, connectionId, onPick }: { hub: ProviderHub | undefined; connectionId: string; onPick: (node: SignalNode) => void }) {
  const [path, setPath] = useState<string[]>([]);
  const [nodes, setNodes] = useState<SignalNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only the newest request may apply its result (holodeck#173): a slow
  // response that lands after the user navigated elsewhere is dropped.
  const latest = useRef(0);
  useEffect(() => () => void (latest.current = -1), []); // unmount: drop anything in flight

  const load = async (stack: string[]) => {
    const request = ++latest.current;
    const session = hub?.session(connectionId);
    if (!session?.browse) {
      setError('The connection is not open yet (check its status and secrets).');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await session.browse(stack.at(-1));
      if (request !== latest.current) return;
      setNodes(result);
      setPath(stack);
    } catch (e) {
      if (request === latest.current) setError(messageOf(e));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  };

  // List the top level on open when the connection is already open (no error
  // if it is not: the user can press Browse once it is). No "already loaded"
  // guard: under StrictMode the first run's response is dropped by the
  // unmount cleanup above (latest = -1), so the second run must load again
  // (found in the browser: the list never appeared in `vite dev`).
  useEffect(() => {
    if (!hub?.session(connectionId)?.browse) return;
    void load([]);
    // `load` is recreated every render; it only reads refs and setters.
  }, [hub, connectionId]);

  return (
    <div className="rounded-md border p-2" data-testid="source-browser">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load([])}>
          <FolderSearchIcon /> Browse
        </Button>
        {path.length ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void load(path.slice(0, -1))}>
            <ChevronLeftIcon /> Up
          </Button>
        ) : null}
        <code className="truncate text-[11px] text-muted-foreground">{path.at(-1) ?? ''}</code>
      </div>
      {error ? <p className="pt-1 text-xs text-destructive">{error}</p> : null}
      {nodes ? (
        <ul className="mt-1 max-h-48 overflow-auto text-sm">
          {nodes.length === 0 ? <li className="text-xs text-muted-foreground">Nothing here (yet).</li> : null}
          {nodes.map((n) => (
            <li key={n.path}>
              <button
                type="button"
                className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-accent"
                data-browse-path={n.path}
                onClick={() => (n.source ? onPick(n) : n.hasChildren ? void load([...path, n.path]) : undefined)}
              >
                <span className="flex-1 truncate">{n.label}</span>
                {n.type ? <span className="text-[11px] text-muted-foreground">{n.type}</span> : null}
                {n.hasChildren && !n.source ? <ChevronRightIcon className="size-3" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TransformEditor({ value, onChange }: { value: TransformForm; onChange: (v: TransformForm) => void }) {
  const set = (patch: Partial<TransformForm>) => onChange({ ...value, ...patch });
  const field = (key: keyof TransformForm, label: string) => (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <Input value={String(value[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<TransformForm>)} aria-label={`Transform ${label}`} />
    </label>
  );
  return (
    <fieldset className="flex flex-col gap-2 rounded-md border p-2" data-testid="transform-editor">
      <legend className="px-1 text-xs font-semibold">Transform</legend>
      <select aria-label="Transform kind" className={selectClass} value={value.kind} onChange={(e) => set({ kind: e.target.value as TransformForm['kind'] })}>
        {TRANSFORM_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
      {value.kind === 'scale' ? (
        <div className="grid grid-cols-4 gap-2">
          {field('inMin', 'in min')}
          {field('inMax', 'in max')}
          {field('outMin', 'out min')}
          {field('outMax', 'out max')}
          <label className="col-span-4 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={value.clamp} onChange={(e) => set({ clamp: e.target.checked })} /> Clamp to the output range
          </label>
        </div>
      ) : null}
      {value.kind === 'threshold' || value.kind === 'map' ? (
        <>
          <label className="flex flex-col gap-1 text-xs">
            {value.kind === 'threshold' ? 'Steps, one "at = value" per line, ascending' : 'Cases, one "input = value" per line'}
            <textarea
              aria-label={value.kind === 'threshold' ? 'Threshold steps' : 'Map cases'}
              className="min-h-16 rounded-md border border-input bg-transparent p-2 font-mono text-xs"
              value={value.lines}
              onChange={(e) => set({ lines: e.target.value })}
            />
          </label>
          {field('fallback', value.kind === 'threshold' ? 'below the first step' : 'default')}
        </>
      ) : null}
      {value.kind === 'format' ? (
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          {field('template', 'template ({value})')}
          {field('digits', 'digits')}
        </div>
      ) : null}
    </fieldset>
  );
}

