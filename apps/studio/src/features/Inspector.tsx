import { HOLODECK_KINDS, type HolodeckDocument } from '@holodeck/sdk';
import type { IsoPartDefinition, IsoPartParamSpec, IsoPlacement, IsoSceneFile } from '@holodeck/editor-2.5d-react';
import { RotateCcwIcon, RotateCwIcon, Trash2Icon } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useStudio } from '../studio-context';
import { DraftField, ReadonlyField } from './fields';
import { coerceCoordinate, coerceParam, paramValue, rotationDegrees, visibleParams } from './inspector.logic';

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** Defensive: stored metadata predating validation may not parse; show it raw instead of throwing. */
export const formatTime = (iso: string | undefined) => {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isFinite(at.getTime()) ? timeFormat.format(at) : iso;
};

/** What the object inspector can change, as editor actions understand it. */
export type InspectorEdit =
  | { kind: 'move'; patch: { x?: number; y?: number } }
  | { kind: 'rotate'; direction: 1 | -1 }
  | { kind: 'param'; name: string; value: unknown };

export interface InspectorProps {
  doc: HolodeckDocument<IsoSceneFile>;
  selectedId: string | null;
  onRename: (name: string) => void;
  /** One object edit; the workspace runs it through the editor (undoable). */
  onEdit: (id: string, edit: InspectorEdit) => void;
  /** Delete through the editor (connector anchors detach, hosted parts follow: holodeck#124). */
  onDeleteObject: (id: string) => void;
  onDeleteDocument: () => void;
}

export function Inspector(props: InspectorProps) {
  const selected = props.selectedId ? props.doc.body.objects.find((o) => o.id === props.selectedId) : undefined;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="inspector">
      {selected ? <ObjectInspector {...props} placement={selected} /> : <DocumentInspector {...props} />}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

function DocumentInspector({ doc, onRename, onDeleteDocument }: InspectorProps) {
  const [confirming, setConfirming] = useState(false);
  const requires = Object.entries(doc.requires ?? {});
  return (
    <>
      <SectionTitle>Document</SectionTitle>
      <div className="flex flex-col gap-2 px-4">
        <DraftField
          label="Name"
          value={doc.name}
          coerce={(s) => (s.trim() ? { ok: true, value: s.trim() } : { ok: false, reason: 'a name is required' })}
          onCommit={(name) => onRename(name as string)}
          inputProps={{ 'aria-label': 'Document name' }}
        />
        <ReadonlyField label="Engine" value={`${doc.engine}${doc.engineVersion ? ` ${doc.engineVersion}` : ''}`} />
        <ReadonlyField label="Objects" value={doc.body.objects.length} testId="inspector-object-count" />
        <ReadonlyField label="Created" value={formatTime(doc.metadata?.created)} />
        <ReadonlyField label="Updated" value={formatTime(doc.metadata?.updated)} />
        <ReadonlyField label="Id" value={<code className="text-xs">{doc.id}</code>} />
      </div>
      <Separator className="my-4" />
      <SectionTitle>Packages used</SectionTitle>
      <ul className="px-4 text-sm">
        {requires.length === 0 ? <li className="text-xs text-muted-foreground">None yet.</li> : null}
        {requires.map(([id, range]) => (
          <li key={id} className="flex justify-between">
            <code className="text-xs">{id}</code>
            <span className="text-xs text-muted-foreground">{range}</span>
          </li>
        ))}
      </ul>
      <p className="px-4 pt-4 text-xs text-muted-foreground">Select an object on the canvas to edit it.</p>
      <div className="mt-auto p-4">
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={() => setConfirming(true)}>
          <Trash2Icon /> Delete document
        </Button>
      </div>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{doc.name}”?</DialogTitle>
            <DialogDescription>It is removed from this browser. Export it first if you want to keep a copy.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(false);
                onDeleteDocument();
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ObjectInspector({ placement, onEdit, onDeleteObject }: InspectorProps & { placement: IsoPlacement }) {
  const { host } = useStudio();
  const def = host.registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, placement.object);
  const owner = host.registry.ownerOf(HOLODECK_KINDS.isoPart, placement.object);
  const edit = (e: InspectorEdit) => onEdit(placement.id, e);
  return (
    <>
      <SectionTitle>{def?.label ?? placement.object}</SectionTitle>
      <div className="flex flex-col gap-2 px-4">
        <ReadonlyField label="Id" value={<code className="text-xs">{placement.id}</code>} testId="inspector-selected-id" />
        <ReadonlyField label="Part" value={<code className="text-xs">{placement.object}</code>} />
        {owner ? <ReadonlyField label="Package" value={host.package(owner)?.manifest.name ?? owner} /> : null}
        <DraftField label="X" type="number" value={String(placement.x)} coerce={coerceCoordinate} onCommit={(x) => edit({ kind: 'move', patch: { x: x as number } })} />
        <DraftField label="Y" type="number" value={String(placement.y)} coerce={coerceCoordinate} onCommit={(y) => edit({ kind: 'move', patch: { y: y as number } })} />
        <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Rotation</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Rotate left" onClick={() => edit({ kind: 'rotate', direction: -1 })}>
              <RotateCcwIcon />
            </Button>
            <span className="w-10 text-center text-sm tabular-nums" data-testid="inspector-rotation">
              {rotationDegrees(placement.rotation)}°
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Rotate right" onClick={() => edit({ kind: 'rotate', direction: 1 })}>
              <RotateCwIcon />
            </Button>
          </div>
        </div>
      </div>
      {def && visibleParams(def.params).length ? (
        <>
          <Separator className="my-4" />
          <SectionTitle>Parameters</SectionTitle>
          <div className="flex flex-col gap-2 px-4">
            {visibleParams(def.params).map(([name, spec]) => (
              <ParamField key={name} name={name} spec={spec} value={paramValue(placement, name, spec)} onCommit={(value) => edit({ kind: 'param', name, value })} />
            ))}
          </div>
        </>
      ) : null}
      {!def ? <p className="px-4 pt-3 text-xs text-destructive">Part “{placement.object}” is not installed.</p> : null}
      <div className="mt-auto p-4">
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={() => onDeleteObject(placement.id)}>
          <Trash2Icon /> Delete object
        </Button>
      </div>
    </>
  );
}

function ParamField({ name, spec, value, onCommit }: { name: string; spec: IsoPartParamSpec; value: unknown; onCommit: (value: unknown) => void }) {
  const id = useId();
  const label = spec.label || name;
  switch (spec.type) {
    case 'boolean':
      return (
        <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          <input id={id} type="checkbox" className="size-4 accent-primary" checked={value === true} onChange={(e) => onCommit(e.target.checked)} />
        </div>
      );
    case 'enum':
      return (
        <div className="grid grid-cols-[6rem_1fr] items-center gap-2">
          <Label htmlFor={id}>{label}</Label>
          <select
            id={id}
            value={String(value)}
            onChange={(e) => {
              const result = coerceParam(spec, e.target.value);
              if (result.ok) onCommit(result.value);
            }}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {(spec.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      );
    case 'number':
      return (
        <DraftField
          label={label}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          suffix={spec.unit}
          coerce={(s) => coerceParam(spec, s)}
          onCommit={onCommit}
          inputProps={{ min: spec.min, max: spec.max, step: spec.step ?? 'any' }}
        />
      );
    case 'string':
      return <DraftField label={label} value={typeof value === 'string' ? value : ''} coerce={(s) => coerceParam(spec, s)} onCommit={onCommit} />;
    case 'color':
      return (
        <DraftField
          label={label}
          value={typeof value === 'string' ? value : ''}
          coerce={(s) => coerceParam(spec, s)}
          onCommit={onCommit}
          inputProps={{ placeholder: '#rrggbb, empty = theme colour' }}
        />
      );
    default:
      return <ReadonlyField label={label} value={<code className="text-xs">{JSON.stringify(value)}</code>} />;
  }
}
