import { PlusIcon, UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openImportPicker } from './file-io';
import { useStudioActions } from './use-studio-actions';

/** `/`: nothing open yet. */
export function Welcome() {
  const { newDocument, newFromSample } = useStudioActions();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center" data-testid="welcome">
      <h1 className="text-xl font-semibold">Holodeck Studio</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Create a document, or import a <code>.holodeck.json</code> file. Documents are saved in this browser.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => void newDocument()}>
          <PlusIcon /> New document
        </Button>
        <Button variant="outline" onClick={openImportPicker}>
          <UploadIcon /> Import
        </Button>
      </div>
      <Button variant="outline" onClick={() => void newFromSample()}>
        New from sample: Three-tier web app
      </Button>
    </main>
  );
}
