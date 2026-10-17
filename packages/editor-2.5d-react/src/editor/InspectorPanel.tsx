import type { CSSProperties, ReactNode } from 'react';
import type { ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import { useIsoInspectorPanels } from '../registry/react';
import type { IsoInspectorSlot, IsoPartDefinition, IsoPartParamSpec } from '../registry/types';
import { ACCENT, FIELD_BG, FONT, MUTED, PANEL, SIDEBAR, SIDEBAR_TEXT, fieldStyle, linkBtn } from './editor-styles';

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

/**
 * Right-hand panel (edit mode). Order: part header, position / rotation
 * readout, one control per param spec, actions, the host's `inspector`
 * slot, then every `holodeck.iso.inspector` contribution.
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
}: {
  registry: ContributionRegistry;
  def: IsoPartDefinition | undefined;
  selected: IsoPlacement | undefined;
  slot?: IsoInspectorSlot;
  onParam: (param: string, value: unknown) => void;
  onPatch: (patch: Partial<IsoPlacement>) => void;
  onRotate: (direction: 1 | -1) => void;
  onDelete: () => void;
}) {
  const panels = useIsoInspectorPanels(registry);
  if (!selected) {
    return (
      <aside data-testid="inspector" style={{ ...panelStyle, padding: 16, color: MUTED }}>
        Select a part to edit it.
      </aside>
    );
  }
  const hostSlot = typeof slot === 'function' ? slot(selected) : slot;
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
      <Row label="actions">
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
