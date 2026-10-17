import type { CSSProperties, ReactNode } from 'react';
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import { useIsoInspectorPanels } from '../registry/react';
import type { IsoInspectorSlot, IsoPartDefinition, IsoPartParamSpec } from '../registry/types';
import { MAX_META_ENTRIES, type IsoLayer, type IsoMetaValue } from '../objects/validate';
import type { AlignEdge } from './arrange';
import type { EditorAction } from './editor-state';
import { ACCENT, FIELD_BG, FONT, MUTED, PANEL, SIDEBAR, SIDEBAR_TEXT, fieldStyle, linkBtn } from './editor-styles';
import { DEFAULT_LAYER_ID } from './layers';

/** Radians -> whole degrees in [0, 360), for the rotation readout. */
export function rotationDegrees(rotation: number | undefined): number {
  const deg = Math.round((((rotation ?? 0) * 180) / Math.PI) % 360);
  return deg < 0 ? deg + 360 : deg;
}

/** One control for one param spec. `value` is the effective value (placement or default). */
export function ParamControl({
  name,
  spec,
  value,
  onChange,
}: {
  name: string;
  spec: IsoPartParamSpec;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `param-${name}`;
  let control: ReactNode;
  switch (spec.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(spec.default) || 0;
      const common = { min: spec.min, max: spec.max, step: spec.step ?? 'any' } as const;
      control = (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {spec.min !== undefined && spec.max !== undefined ? (
            <input
              type="range"
              aria-label={`${spec.label} slider`}
              value={n}
              {...common}
              onChange={(event) => onChange(event.target.valueAsNumber)}
              style={{ flex: 1, minWidth: 0 }}
            />
          ) : null}
          <input
            id={id}
            type="number"
            value={n}
            {...common}
            onChange={(event) => {
              // An empty / half-typed field gives NaN; keep the old value rather than store it.
              if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber);
            }}
            style={{ ...fieldStyle, width: 72 }}
          />
          {spec.unit ? <span style={{ color: MUTED }}>{spec.unit}</span> : null}
        </span>
      );
      break;
    }
    case 'boolean':
      control = (
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      );
      break;
    case 'enum':
      control = (
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)} style={fieldStyle}>
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    case 'color': {
      // '' = the theme's colour. <input type=color> cannot show "unset", so a
      // "theme" button clears it and the swatch shows the last explicit colour.
      const hex = typeof value === 'string' ? value : '';
      control = (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            id={id}
            type="color"
            aria-label={`${spec.label} colour`}
            // The colour input only takes #rrggbb.
            value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000'}
            onChange={(event) => onChange(event.target.value)}
          />
          <span style={{ color: MUTED }}>{hex || 'theme'}</span>
          {hex ? (
            <button type="button" onClick={() => onChange('')} style={linkBtn}>
              theme
            </button>
          ) : null}
        </span>
      );
      break;
    }
    case 'string':
      control = (
        <input id={id} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} style={fieldStyle} />
      );
      break;
  }
  return (
    <label htmlFor={id} style={{ display: 'block', margin: '12px 0' }}>
      <div style={{ color: MUTED, marginBottom: 6 }}>{spec.label}</div>
      {control}
    </label>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0' }}>
      <span style={{ color: MUTED }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

const panelStyle: CSSProperties = {
  width: PANEL,
  boxSizing: 'border-box',
  flex: 'none',
  background: SIDEBAR,
  color: SIDEBAR_TEXT,
  font: FONT,
  overflow: 'auto',
  minHeight: 0,
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} style={{ borderTop: `1px solid ${FIELD_BG}`, marginTop: 12, paddingTop: 8 }}>
      <div style={{ color: ACCENT, marginBottom: 4, fontWeight: 600 }}>{title}</div>
      {children}
    </section>
  );
}

const smallBtn: CSSProperties = { ...linkBtn, padding: '2px 5px' };

/** Text of a metadata value in its input. */
const metaText = (v: IsoMetaValue): string => String(v);

/**
 * Parse an edited metadata value, keeping the row's original type when the
 * text still fits it (`3` stays a number, `true` a boolean); otherwise a string.
 */
export function parseMetaValue(text: string, previous: IsoMetaValue | undefined): IsoMetaValue {
  if (typeof previous === 'number') {
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) return n;
  }
  if (typeof previous === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

/** Metadata plane rows (#92): key / value table, commit on blur or Enter, max MAX_META_ENTRIES rows. */
function MetaEditor({ placement, onPatch }: { placement: IsoPlacement; onPatch: (patch: Partial<IsoPlacement>) => void }) {
  const entries = Object.entries(placement.meta ?? {});
  const write = (next: Array<[string, IsoMetaValue]>) => {
    const meta = Object.fromEntries(next);
    onPatch({ meta: next.length ? meta : undefined });
  };
  const commitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  };
  return (
    <div data-testid="meta-editor">
      {entries.map(([key, value], i) => (
        <div key={`${placement.id}:${i}:${key}`} style={{ display: 'flex', gap: 4, margin: '4px 0' }}>
          <input
            aria-label={`Metadata key ${i + 1}`}
            defaultValue={key}
            onKeyDown={commitOnEnter}
            onBlur={(event) => {
              const nextKey = event.target.value.trim();
              // Empty or duplicate keys are refused: the field snaps back to the old key.
              if (!nextKey || nextKey === key || entries.some(([k]) => k === nextKey)) {
                event.target.value = key;
                return;
              }
              write(entries.map(([k, v]) => (k === key ? [nextKey, v] : [k, v])));
            }}
            style={{ ...fieldStyle, padding: '4px 6px', flex: 1, minWidth: 0 }}
          />
          <input
            aria-label={`Metadata value ${i + 1}`}
            defaultValue={metaText(value)}
            onKeyDown={commitOnEnter}
            onBlur={(event) => {
              const next = parseMetaValue(event.target.value, value);
              if (next !== value) write(entries.map(([k, v]) => (k === key ? [k, next] : [k, v])));
            }}
            style={{ ...fieldStyle, padding: '4px 6px', flex: 1, minWidth: 0 }}
          />
          <button type="button" aria-label={`Remove metadata ${key}`} onClick={() => write(entries.filter(([k]) => k !== key))} style={smallBtn}>
            ×
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <button
          type="button"
          disabled={entries.length >= MAX_META_ENTRIES}
          onClick={() => {
            let n = entries.length + 1;
            while (entries.some(([k]) => k === `key${n}`)) n += 1;
            write([...entries, [`key${n}`, '']]);
          }}
          style={{ ...smallBtn, color: entries.length >= MAX_META_ENTRIES ? MUTED : ACCENT }}
        >
          + row
        </button>
        <span style={{ color: MUTED }}>{`${entries.length}/${MAX_META_ENTRIES}`}</span>
        {entries.length ? (
          <label style={{ marginLeft: 'auto', color: MUTED, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={!placement.metaHidden} onChange={(event) => onPatch({ metaHidden: event.target.checked ? undefined : true })} />
            on floor
          </label>
        ) : null}
      </div>
    </div>
  );
}

/** Opacity slider + number (0..1). `value` undefined = 1. */
function OpacityControl({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const v = value ?? 1;
  const set = (n: number) => {
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(1, Math.max(0, Math.round(n * 100) / 100));
    onChange(clamped === 1 ? undefined : clamped);
  };
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, marginLeft: 12 }}>
      <input type="range" aria-label="Opacity" min={0} max={1} step={0.05} value={v} onChange={(event) => set(event.target.valueAsNumber)} style={{ flex: 1, minWidth: 0 }} />
      <input type="number" aria-label="Opacity value" min={0} max={1} step={0.05} value={v} onChange={(event) => set(event.target.valueAsNumber)} style={{ ...fieldStyle, width: 60, padding: 4 }} />
    </span>
  );
}

function ZOrderButtons({ z, onAction }: { z: number | undefined; onAction: (a: EditorAction) => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
      {z !== undefined ? <span data-testid="z-readout" style={{ color: MUTED, marginRight: 4 }}>{z}</span> : null}
      <button type="button" title="Send to back" onClick={() => onAction({ type: 'z-order', to: 'back' })} style={smallBtn}>back</button>
      <button type="button" title="Send backward" aria-label="Send backward" onClick={() => onAction({ type: 'z-order', to: 'backward' })} style={smallBtn}>−</button>
      <button type="button" title="Bring forward" aria-label="Bring forward" onClick={() => onAction({ type: 'z-order', to: 'forward' })} style={smallBtn}>+</button>
      <button type="button" title="Bring to front" onClick={() => onAction({ type: 'z-order', to: 'front' })} style={smallBtn}>front</button>
    </span>
  );
}

function LayerSelect({ value, layers, onAction }: { value: string | null; layers: readonly IsoLayer[]; onAction: (a: EditorAction) => void }) {
  return (
    <select
      aria-label="Layer"
      value={value ?? ''}
      onChange={(event) => onAction({ type: 'assign-layer', layer: event.target.value })}
      style={{ ...fieldStyle, width: 150, padding: 4 }}
    >
      {value === null ? <option value="">(mixed)</option> : null}
      {layers.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name || l.id}
        </option>
      ))}
    </select>
  );
}

const ALIGN_BUTTONS: ReadonlyArray<[AlignEdge, string, string]> = [
  ['min-x', 'x min', 'Align to the lowest x edge'],
  ['center-x', 'x mid', 'Align centres on x'],
  ['max-x', 'x max', 'Align to the highest x edge'],
  ['min-y', 'y min', 'Align to the lowest y edge'],
  ['center-y', 'y mid', 'Align centres on y'],
  ['max-y', 'y max', 'Align to the highest y edge'],
];

/** Inspector for two or more selected placements: arrange, group, shared appearance and params. */
function MultiInspector({
  registry,
  selection,
  primary: primaryProp,
  layers,
  onAction,
}: {
  registry: ContributionRegistry;
  selection: readonly IsoPlacement[];
  /** The primary selection (last clicked): its values are shown, and `set-param` edits parts of its type. */
  primary: IsoPlacement | undefined;
  layers: readonly IsoLayer[];
  onAction: (a: EditorAction) => void;
}) {
  const kinds = new Set(selection.map((o) => o.object));
  const sameKind = kinds.size === 1 ? registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, selection[0]!.object) : undefined;
  // `selection` is in scene order; the primary follows click order (PR #114 review).
  const primary = primaryProp && selection.some((o) => o.id === primaryProp.id) ? primaryProp : selection[selection.length - 1]!;
  const layerIds = new Set(selection.map((o) => (o.layer && layers.some((l) => l.id === o.layer) ? o.layer : DEFAULT_LAYER_ID)));
  const opacities = new Set(selection.map((o) => o.opacity ?? 1));
  const grouped = selection.some((o) => o.group !== undefined);
  const oneGroup = new Set(selection.map((o) => o.group ?? '')).size === 1 && primary.group !== undefined;
  return (
    <aside data-testid="inspector" data-selection-count={selection.length} style={{ ...panelStyle, padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{`${selection.length} parts selected`}</div>
      <div style={{ color: MUTED, marginBottom: 8 }}>{oneGroup ? `group ${primary.group}` : [...kinds].join(', ')}</div>
      <Section title="Arrange">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
          {ALIGN_BUTTONS.map(([edge, label, title]) => (
            <button key={edge} type="button" title={title} aria-label={title} onClick={() => onAction({ type: 'align', edge })} style={smallBtn}>
              {label}
            </button>
          ))}
          <button type="button" title="Distribute evenly along x (3 or more)" onClick={() => onAction({ type: 'distribute', axis: 'x' })} style={smallBtn}>
            spread x
          </button>
          <button type="button" title="Distribute evenly along y (3 or more)" onClick={() => onAction({ type: 'distribute', axis: 'y' })} style={smallBtn}>
            spread y
          </button>
        </div>
        <Row label="rotate">
          <button type="button" onClick={() => onAction({ type: 'rotate-selected', direction: 1 })} style={linkBtn}>left</button>
          <button type="button" onClick={() => onAction({ type: 'rotate-selected', direction: -1 })} style={linkBtn}>right</button>
        </Row>
        <Row label="group">
          <button type="button" disabled={oneGroup} onClick={() => onAction({ type: 'group-selected' })} style={{ ...linkBtn, color: oneGroup ? MUTED : ACCENT }}>group</button>
          <button type="button" disabled={!grouped} onClick={() => onAction({ type: 'ungroup-selected' })} style={{ ...linkBtn, color: grouped ? ACCENT : MUTED }}>ungroup</button>
        </Row>
      </Section>
      <Section title="Appearance">
        <Row label="opacity">
          <OpacityControl
            value={opacities.size === 1 ? primary.opacity : undefined}
            onChange={(opacity) => onAction({ type: 'patch-selection', patch: { opacity } })}
          />
        </Row>
        <Row label="z-order">
          <ZOrderButtons z={undefined} onAction={onAction} />
        </Row>
        <Row label="layer">
          <LayerSelect value={layerIds.size === 1 ? [...layerIds][0]! : null} layers={layers} onAction={onAction} />
        </Row>
      </Section>
      {sameKind ? (
        <Section title={`${sameKind.label} params (all ${selection.length})`}>
          {Object.entries(sameKind.params).filter(([, spec]) => !spec.hidden).map(([name, spec]) => (
            <ParamControl
              key={`multi:${name}`}
              name={name}
              spec={spec}
              value={primary.params?.[name] ?? spec.default}
              onChange={(value) => onAction({ type: 'set-param', param: name, value })}
            />
          ))}
        </Section>
      ) : null}
      <Row label="actions">
        <button type="button" onClick={() => onAction({ type: 'duplicate' })} style={linkBtn}>duplicate</button>
        <button type="button" onClick={() => onAction({ type: 'delete' })} style={linkBtn}>delete</button>
      </Row>
    </aside>
  );
}

/**
 * Right-hand panel (edit mode). Order: part header, position / rotation
 * readout, one control per param spec, appearance / layer / metadata
 * (holodeck#92, when `onAction` is wired), actions, the host's `inspector`
 * slot, then every `holodeck.iso.inspector` contribution. Two or more
 * selected placements switch to the multi-selection view (arrange, group,
 * shared appearance, params when they are all the same part).
 */
export function InspectorPanel({
  registry,
  def,
  selected,
  slot,
  onParam,
  onPatch,
  onRotate,
  onDelete,
  selection,
  layers,
  onAction,
}: {
  registry: ContributionRegistry;
  def: IsoPartDefinition | undefined;
  selected: IsoPlacement | undefined;
  slot?: IsoInspectorSlot;
  onParam: (param: string, value: unknown) => void;
  onPatch: (patch: Partial<IsoPlacement>) => void;
  onRotate: (direction: 1 | -1) => void;
  onDelete: () => void;
  /** Every selected placement (scene order). Two or more: the multi-selection view. */
  selection?: readonly IsoPlacement[];
  /** Scene layers in panel order (`sceneLayers`), for the layer picker. */
  layers?: readonly IsoLayer[];
  /** Editor actions (z-order, layers, grouping, align...). Omit to hide those controls. */
  onAction?: (action: EditorAction) => void;
}) {
  const panels = useIsoInspectorPanels(registry);
  if (selection && selection.length > 1 && onAction) {
    return <MultiInspector registry={registry} selection={selection} primary={selected} layers={layers ?? []} onAction={onAction} />;
  }
  if (!selected) {
    return (
      <aside data-testid="inspector" style={{ ...panelStyle, padding: 16, color: MUTED }}>
        Select a part to edit it.
      </aside>
    );
  }
  const hostSlot = typeof slot === 'function' ? slot(selected) : slot;
  const layerId = selected.layer && layers?.some((l) => l.id === selected.layer) ? selected.layer : DEFAULT_LAYER_ID;
  return (
    <aside data-testid="inspector" style={{ ...panelStyle, padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{def?.label ?? selected.object}</div>
      <div style={{ color: MUTED, marginBottom: 16 }}>{selected.id}</div>
      <Row label="position">{`${selected.x}, ${selected.y}`}</Row>
      <Row label="rotation">
        <span data-testid="rotation-readout">{`${rotationDegrees(selected.rotation)}°`}</span>
        <button type="button" onClick={() => onRotate(1)} style={linkBtn}>
          left
        </button>
        <button type="button" onClick={() => onRotate(-1)} style={linkBtn}>
          right
        </button>
      </Row>
      {def
        ? Object.entries(def.params).filter(([, spec]) => !spec.hidden).map(([name, spec]) => (
            <ParamControl
              key={`${selected.id}:${name}`}
              name={name}
              spec={spec}
              value={selected.params?.[name] ?? spec.default}
              onChange={(value) => onParam(name, value)}
            />
          ))
        : (
            <div style={{ color: MUTED }}>Part "{selected.object}" is not installed.</div>
          )}
      {onAction ? (
        <>
          <Section title="Appearance">
            <Row label="opacity">
              <OpacityControl value={selected.opacity} onChange={(opacity) => onPatch({ opacity })} />
            </Row>
            <Row label="z-order">
              <ZOrderButtons z={selected.z ?? 0} onAction={onAction} />
            </Row>
            {layers ? (
              <Row label="layer">
                <LayerSelect value={layerId} layers={layers} onAction={onAction} />
              </Row>
            ) : null}
            {selected.group ? (
              <Row label="group">
                <span style={{ color: MUTED }}>{selected.group}</span>
                <button type="button" onClick={() => onAction({ type: 'ungroup-selected' })} style={linkBtn}>
                  ungroup
                </button>
              </Row>
            ) : null}
          </Section>
          <Section title="Metadata">
            <MetaEditor placement={selected} onPatch={onPatch} />
          </Section>
        </>
      ) : null}
      <Row label="actions">
        {onAction ? (
          <button type="button" onClick={() => onAction({ type: 'duplicate' })} style={linkBtn}>
            duplicate
          </button>
        ) : null}
        <button type="button" onClick={onDelete} style={linkBtn}>
          delete
        </button>
      </Row>
      {hostSlot}
      {panels.map((panel) => (
        <section key={panel.id} aria-label={panel.label} style={{ borderTop: `1px solid ${FIELD_BG}`, marginTop: 12, paddingTop: 12 }}>
          <div style={{ color: ACCENT, marginBottom: 8, fontWeight: 600 }}>{panel.label}</div>
          <panel.component placement={selected} onChange={onPatch} />
        </section>
      ))}
    </aside>
  );
}
