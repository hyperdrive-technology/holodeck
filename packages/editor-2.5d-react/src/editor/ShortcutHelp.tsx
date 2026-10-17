import { useEffect, useRef } from 'react';
import { ACCENT, FIELD_BG, FONT, MUTED, SIDEBAR, SIDEBAR_TEXT, linkBtn } from './editor-styles';
import { POINTER_GESTURES, SHORTCUTS, formatCombo, isMacPlatform, type ShortcutGroup } from './shortcuts';

const GROUPS: readonly ShortcutGroup[] = ['Tools', 'Edit', 'Arrange', 'View'];

function Keys({ spec, mac }: { spec: string; mac: boolean }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {formatCombo(spec, mac).map((k, i) => (
        <kbd
          key={i}
          style={{
            minWidth: 18,
            padding: '1px 5px',
            borderRadius: 3,
            background: FIELD_BG,
            border: `1px solid ${MUTED}`,
            font: '12px/1.4 ui-monospace, monospace',
            textAlign: 'center',
          }}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Keyboard shortcut overlay (`?`). Rendered from the same `SHORTCUTS` table
 * the key handler uses. Closes on Escape (ProcessEditor), the close button or
 * a click on the backdrop.
 */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const mac = isMacPlatform();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div
      data-testid="shortcut-help-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        background: 'rgba(16, 20, 26, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcut-help"
        style={{
          background: SIDEBAR,
          color: SIDEBAR_TEXT,
          font: FONT,
          borderRadius: 8,
          padding: '16px 20px',
          maxWidth: 'min(860px, 92%)',
          maxHeight: '86%',
          overflow: 'auto',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Keyboard shortcuts</div>
          <button ref={closeRef} type="button" onClick={onClose} style={{ ...linkBtn, marginLeft: 'auto' }} aria-label="Close shortcuts">
            close
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '4px 28px' }}>
          {GROUPS.map((group) => (
            <section key={group} aria-label={group}>
              <div style={{ color: ACCENT, fontWeight: 600, margin: '10px 0 6px' }}>{group}</div>
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} data-shortcut={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, margin: '5px 0' }}>
                  <span>{s.label}</span>
                  <span style={{ display: 'inline-flex', gap: 6, flex: 'none' }}>
                    {s.keys.map((k) => (
                      <Keys key={k} spec={k} mac={mac} />
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <section aria-label="Mouse">
            <div style={{ color: ACCENT, fontWeight: 600, margin: '10px 0 6px' }}>Mouse</div>
            {POINTER_GESTURES.map((g) => (
              <div key={g.keys} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, margin: '5px 0' }}>
                <span>{g.label}</span>
                <Keys spec={g.keys} mac={mac} />
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
