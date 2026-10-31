import { render } from '@testing-library/react';
import { beforeAll, beforeEach, expect, it } from 'vitest';
import type { HolodeckHost } from '@holodeck/sdk';
import { act } from 'react';
import { SessionSecretStore } from './connections/secrets';
import { openStudioDb } from './documents/db';
import type { DocumentChange } from './documents/store';
import { DocumentStore } from './documents/store';
import { createStudioHost } from './host/studio-host';
import { StudioProvider } from './studio-context';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});
beforeEach(() => window.sessionStorage.clear());

// Review of #241 round 3: one place clears a deleted document's secrets, whatever route is open.
it('StudioProvider clears this tab’s secrets for every document deleted in another tab, and only those', () => {
  let listener: ((c: DocumentChange) => void) | undefined;
  const channel = { post: () => undefined, subscribe: (l: (c: DocumentChange) => void) => ((listener = l), () => (listener = undefined)) };
  const secrets = new SessionSecretStore(window.sessionStorage);
  secrets.set('gone', 'api', 'token', 'GONE', 'fp');
  secrets.set('kept', 'api', 'token', 'KEPT', 'fp');
  const view = render(
    <StudioProvider services={{ host, store: new DocumentStore(openStudioDb('ctx-test')), channel, secrets }}>
      <div />
    </StudioProvider>,
  );
  act(() => listener?.({ type: 'saved', id: 'gone', revision: 2 }));
  expect(secrets.get('gone', 'api', 'token', 'fp')).toBe('GONE');
  act(() => listener?.({ type: 'deleted', id: 'gone' }));
  expect(secrets.get('gone', 'api', 'token', 'fp')).toBeUndefined();
  expect(secrets.get('kept', 'api', 'token', 'fp')).toBe('KEPT');
  view.unmount();
  expect(listener).toBeUndefined();
});
