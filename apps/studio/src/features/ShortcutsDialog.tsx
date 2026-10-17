import { formatForDisplay } from '@tanstack/react-hotkeys';
import { useSelector } from '@tanstack/react-store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { CANVAS_SHORTCUTS, STUDIO_SHORTCUTS } from '../shortcuts/shortcuts';
import { shellStore } from './active-document';

export function ShortcutsDialog() {
  const open = useSelector(shellStore, (s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={(shortcutsOpen) => shellStore.setState((s) => ({ ...s, shortcutsOpen }))}>
      <DialogContent aria-describedby="shortcuts-description">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription id="shortcuts-description">Studio commands, then the canvas tools.</DialogDescription>
        </DialogHeader>
        <ShortcutTable rows={STUDIO_SHORTCUTS.map((s) => ({ keys: formatForDisplay(s.hotkey), label: s.label }))} />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Canvas</h3>
        <ShortcutTable rows={CANVAS_SHORTCUTS.map((s) => ({ keys: s.keys.includes('Mod') ? formatForDisplay(s.keys) : s.keys, label: s.label }))} />
      </DialogContent>
    </Dialog>
  );
}

function ShortcutTable({ rows }: { rows: ReadonlyArray<{ keys: string; label: string }> }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-b last:border-0">
            <td className="py-1.5">{row.label}</td>
            <td className="py-1.5 text-right">
              <Kbd>{row.keys}</Kbd>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
