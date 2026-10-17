import { useSelector } from '@tanstack/react-store';
import { CopyIcon, FileJsonIcon, ImageIcon, Loader2Icon, SheetIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { embedSnippet, embedUrl } from '../embed/snippet';
import { notify } from '../layout/ui-state';
import { activeDocumentStore, shellStore } from './active-document';

/** PNG scales offered (output px per canvas px). The engine accepts up to 8. */
export const IMAGE_SCALES = [1, 2, 4] as const;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Same test as the engine's `useWebGPUSupport`: the canvas (and so PNG export) needs `navigator.gpu`. */
const hasWebGPU = () => typeof navigator !== 'undefined' && 'gpu' in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);

const setOpen = (exportOpen: boolean) => shellStore.setState((s) => ({ ...s, exportOpen }));

/**
 * Export (header button, Mod+Shift+E): the document as JSON, its components
 * as CSV, the canvas as a high-resolution PNG, or an embed link.
 */
export function ExportDialog({ documentName }: { documentName: string }) {
  const open = useSelector(shellStore, (s) => s.exportOpen);
  const active = useSelector(activeDocumentStore);
  const [scale, setScale] = useState<number>(2);
  const [rendering, setRendering] = useState(false);
  const [parentOrigin, setParentOrigin] = useState('');
  const abort = useRef<AbortController | null>(null);

  // Closing the dialog (or the document) cancels a running PNG export.
  useEffect(() => {
    if (open && active) return;
    abort.current?.abort(new DOMException('export cancelled', 'AbortError'));
  }, [open, active]);
  if (!active) return null;

  const done = (title: string) => {
    notify({ tone: 'info', title });
    setOpen(false);
  };
  const run = (what: string, fn: () => string | void) => {
    try {
      fn();
      done(`Exported ${what}`);
    } catch (error) {
      notify({ tone: 'error', title: `Could not export ${what}`, details: [messageOf(error)] });
    }
  };
  const exportImage = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setRendering(true);
    try {
      const image = await active.exportImage(scale, controller.signal);
      done(`Exported ${image.name} (${image.width} × ${image.height} px)`);
    } catch (error) {
      if (!controller.signal.aborted) notify({ tone: 'error', title: 'Could not export the image', details: [messageOf(error)] });
    } finally {
      if (abort.current === controller) abort.current = null;
      setRendering(false);
    }
  };
  const url = embedUrl(window.location.origin, active.id, parentOrigin);
  const snippet = embedSnippet(url, documentName);
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => notify({ tone: 'info', title: `Copied the ${what}` }),
      (error: unknown) => notify({ tone: 'error', title: `Could not copy the ${what}`, details: [messageOf(error)] }),
    );
  const webgpu = hasWebGPU();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby="export-description" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription id="export-description">Download “{documentName}” or embed it read-only with live data.</DialogDescription>
        </DialogHeader>

        <section className="flex items-center gap-3 border-b pb-3">
          <FileJsonIcon className="size-5 text-muted-foreground" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Document</div>
            <div className="text-muted-foreground">The whole document (.holodeck.json); imports back into any Holodeck host.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => run('the document', active.exportFile)}>
            Download JSON
          </Button>
        </section>

        <section className="flex items-center gap-3 border-b pb-3">
          <SheetIcon className="size-5 text-muted-foreground" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Components</div>
            <div className="text-muted-foreground">One row per object with position, layer, params and metadata (.csv).</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => run('the components', active.exportComponents)}>
            Download CSV
          </Button>
        </section>

        <section className="flex flex-col gap-2 border-b pb-3">
          <div className="flex items-center gap-3">
            <ImageIcon className="size-5 text-muted-foreground" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Image</div>
              <div className="text-muted-foreground">
                {webgpu ? 'The current view as a PNG, rendered at a multiple of the canvas size.' : 'Needs WebGPU, which this browser does not provide.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-8">
            <div role="radiogroup" aria-label="Image scale" className="flex gap-1">
              {IMAGE_SCALES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant="outline"
                  role="radio"
                  aria-checked={scale === s}
                  disabled={rendering}
                  className={cn(scale === s && 'border-primary bg-accent')}
                  onClick={() => setScale(s)}
                >
                  {s}×
                </Button>
              ))}
            </div>
            <div className="flex-1" />
            {rendering ? (
              <Button size="sm" variant="ghost" onClick={() => abort.current?.abort(new DOMException('export cancelled', 'AbortError'))}>
                Cancel
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={!webgpu || rendering} onClick={() => void exportImage()} data-testid="export-png">
              {rendering ? <Loader2Icon className="animate-spin" /> : null}
              {rendering ? 'Rendering…' : 'Download PNG'}
            </Button>
          </div>
        </section>

        <section className="flex flex-col gap-2 text-sm">
          <div className="font-medium">Embed</div>
          <p className="text-muted-foreground">
            A read-only live view for an iframe. Pages on another origin can drive it with <code>postMessage</code> (for example{' '}
            <code>setObjectState</code>) once their origin is named below.
          </p>
          <Label htmlFor="embed-parent-origin">Embedding page origin (optional)</Label>
          <Input
            id="embed-parent-origin"
            placeholder="https://app.example.com"
            value={parentOrigin}
            onChange={(e) => setParentOrigin(e.target.value)}
          />
          <Label htmlFor="embed-url">Embed URL</Label>
          <div className="flex gap-2">
            <Input id="embed-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="embed-url" />
            <Button size="icon-sm" variant="ghost" aria-label="Copy the embed URL" onClick={() => void copy(url, 'embed URL')}>
              <CopyIcon />
            </Button>
          </div>
          <Button size="sm" variant="outline" className="self-start" onClick={() => void copy(snippet, 'iframe snippet')}>
            <CopyIcon /> Copy iframe snippet
          </Button>
        </section>
      </DialogContent>
    </Dialog>
  );
}
