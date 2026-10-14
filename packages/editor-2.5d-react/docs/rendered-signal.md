# Render readiness when embedding

`IsoCanvas` calls `onRendered(revision)` after the current scene and camera
have settled and a frame has been submitted. Its container exposes
`data-holodeck-revision`, `data-holodeck-rendered`, and `data-render-state`
(`pending`, `ready`, or `unsupported`). Screenshot consumers should wait for
`data-render-state="ready"` and matching current/rendered revisions.

All GLBs loaded by `HolodeckModel` hold this signal automatically, including
direct public API use with a host's null Suspense fallback:

```tsx
import { Suspense } from 'react';
import { HolodeckModel, IsoCanvas } from '@holodeck/editor-2.5d-react';

<IsoCanvas onRendered={captureScene}>
  <Suspense fallback={null}>
    <HolodeckModel url={modelUrl} />
  </Suspense>
</IsoCanvas>
```

The model registers a hold before suspending on the loader's cached promise.
Each canvas tracks shared requests independently; retries and multiple models
sharing a request do not accumulate extra holds. Overlapping requests keep the
signal pending until all settle. A failed load releases its hold at once. A successful load keeps it until the
model commits (the promise settles before React retries the suspended tree, so
releasing on settle could report a frame without the model); a 2 s safety
timeout releases it if the model never mounts. Loading errors still propagate to the
host's error boundary; readiness is not a load-success/error reporting API.
Cached models add no pending load hold. Outside `IsoCanvas`, `HolodeckModel`
continues to use normal Suspense loading without readiness bookkeeping.

Hosts must bump an explicit `revision` whenever scene content changes. Without
one, `IsoCanvas` derives revisions from its inputs, including children identity.
Custom loaders outside `HolodeckModel` and asynchronous host work (such as fitting
a view) must keep `holdRender` true until their content has mounted and their
view changes are applied. `ProcessEditor` manages revisions and fitting itself
and exposes the same attributes on `[data-testid="process-editor"]`.
