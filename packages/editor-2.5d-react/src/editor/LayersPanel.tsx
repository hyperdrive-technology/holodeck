import { useState } from 'react';
import type { IsoSceneFile } from '../iso/scene';
import type { EditorAction } from './editor-state';
import { ACCENT, FIELD_BG, FONT, MUTED, SIDEBAR_TEXT, fieldStyle, linkBtn } from './editor-styles';
import { DEFAULT_LAYER_ID, layerIdOf, sceneLayers } from './layers';

/**
 * Layers list (lane E3): show / hide, lock, rename, make active (new parts
 * go there), move the selection here, add and remove. Every change is a
 * reducer action, so each one is an undo step (except "active", which is
 * editor state and not part of the document).
 */
export function LayersPanel({
  scene,
  activeLayer,
  hasSelection,
  onAction,
}: {
  scene: IsoSceneFile;
  activeLayer: string;
  hasSelection: boolean;
  onAction: (action: EditorAction) => void;
}) {
  const layers = sceneLayers(scene);
  const counts = new Map<string, number>();
  for (const o of scene.objects) {
    const id = layerIdOf(scene, o);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div data-testid="layers-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, font: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 14px 8px' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Layers</div>
        <button type="button" style={{ ...linkBtn, marginLeft: 'auto' }} onClick={() => onAction({ type: 'add-layer' })}>
          + layer
        </button>
      </div>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: '0 8px 12px', overflow: 'auto', flex: 1, minHeight: 0 }}>
        {layers.map((layer) => {
          const active = layer.id === activeLayer;
          return (
            <li
              key={layer.id}
              data-layer={layer.id}
              aria-current={active ? 'true' : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                padding: '6px 6px',
                margin: '2px 0',
                borderRadius: 4,
                background: active ? FIELD_BG : 'transparent',
                borderLeft: `3px solid ${active ? ACCENT : 'transparent'}`,
                opacity: layer.hidden ? 0.65 : 1,
              }}
            >
              <button
                type="button"
                aria-label={`${layer.hidden ? 'Show' : 'Hide'} layer ${layer.name}`}
                aria-pressed={!layer.hidden}
                title={layer.hidden ? 'Show' : 'Hide'}
                onClick={() => onAction({ type: 'update-layer', id: layer.id, patch: { hidden: !layer.hidden } })}
                style={{ ...linkBtn, padding: '0 4px', color: layer.hidden ? MUTED : ACCENT, width: 50, flex: 'none', textAlign: 'left' }}
              >
                {layer.hidden ? 'hidden' : 'shown'}
              </button>
              <button
                type="button"
                aria-label={`${layer.locked ? 'Unlock' : 'Lock'} layer ${layer.name}`}
                aria-pressed={Boolean(layer.locked)}
                title={layer.locked ? 'Unlock' : 'Lock'}
                onClick={() => onAction({ type: 'update-layer', id: layer.id, patch: { locked: !layer.locked } })}
                style={{ ...linkBtn, padding: '0 4px', color: layer.locked ? ACCENT : MUTED, width: 50, flex: 'none', textAlign: 'left' }}
              >
                {layer.locked ? 'locked' : 'lock'}
              </button>
              {renaming === layer.id ? (
                <input
                  autoFocus
                  aria-label={`Rename layer ${layer.name}`}
                  defaultValue={layer.name}
                  onBlur={(event) => {
                    setRenaming(null);
                    const name = event.target.value.trim();
                    if (name && name !== layer.name) onAction({ type: 'update-layer', id: layer.id, patch: { name } });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    if (event.key === 'Escape') setRenaming(null);
                  }}
                  style={{ ...fieldStyle, padding: '2px 6px', flex: 1, minWidth: 0 }}
                />
              ) : (
                <button
                  type="button"
                  title="Click: make active (new parts go here). Double-click: rename."
                  onClick={() => onAction({ type: 'set-active-layer', id: layer.id })}
                  onDoubleClick={() => setRenaming(layer.id)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    color: SIDEBAR_TEXT,
                    font: FONT,
                    cursor: 'pointer',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    padding: '0 4px',
                  }}
                >
                  {layer.name || layer.id}
                </button>
              )}
              <span style={{ color: MUTED, minWidth: 18, textAlign: 'right' }} aria-label={`${counts.get(layer.id) ?? 0} parts`}>
                {counts.get(layer.id) ?? 0}
              </span>
              <button
                type="button"
                disabled={!hasSelection}
                aria-label={`Move selection to layer ${layer.name}`}
                title="Move the selection to this layer"
                onClick={() => onAction({ type: 'assign-layer', layer: layer.id })}
                style={{ ...linkBtn, padding: '0 4px', color: hasSelection ? ACCENT : MUTED, cursor: hasSelection ? 'pointer' : 'default' }}
              >
                move
              </button>
              {layer.id === DEFAULT_LAYER_ID ? null : (
                <button
                  type="button"
                  aria-label={`Remove layer ${layer.name}`}
                  title="Remove the layer (its parts move to the default layer)"
                  onClick={() => onAction({ type: 'remove-layer', id: layer.id })}
                  style={{ ...linkBtn, padding: '0 4px' }}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
