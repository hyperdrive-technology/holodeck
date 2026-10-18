import type { HolodeckHost } from '@holodeck/sdk';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createIsoDocument } from '../documents/new-document';
import { createStudioHost } from '../host/studio-host';
import { withPart } from '../test-support';
import { SessionSecretStore } from './secrets';
import { useConnectionHub } from './use-connection-hub';

let host: HolodeckHost;
beforeAll(async () => {
  host = await createStudioHost();
});

function simDoc(source = 'const:0.42') {
  const doc = createIsoDocument('Live', 'live');
  const { scene } = withPart(doc.body, host.registry, 'tank');
  scene.objects[0]!.bindings = { level: { connection: 'sim', source } };
  return { ...doc, body: scene, connections: [{ id: 'sim', provider: 'holodeck.sim' }] };
}

describe('useConnectionHub', () => {
  it('streams bound values from holodeck.sim into metrics and reports the connection live', async () => {
    // Stable inputs, as in the workspace (state, not new objects per render).
    const secrets = new SessionSecretStore(null);
    const { result } = renderHook(({ doc }) => useConnectionHub(host, doc, secrets), { initialProps: { doc: simDoc() } });
    await waitFor(() => expect(result.current.metrics['tank-1']?.level).toBe(0.42));
    expect(result.current.statuses.sim?.status.state).toBe('live');
  });

  it('follows binding changes', async () => {
    const secrets = new SessionSecretStore(null);
    const { result, rerender } = renderHook(({ doc }) => useConnectionHub(host, doc, secrets), { initialProps: { doc: simDoc() } });
    await waitFor(() => expect(result.current.metrics['tank-1']?.level).toBe(0.42));
    rerender({ doc: simDoc('const:0.9') });
    await waitFor(() => expect(result.current.metrics['tank-1']?.level).toBe(0.9));
  });

  it('asks the secret store, scoped to the document, and reconnect re-asks', async () => {
    const secrets = new SessionSecretStore(null);
    const get = vi.spyOn(secrets, 'forDocument');
    const doc = simDoc();
    const { result } = renderHook(() => useConnectionHub(host, doc, secrets));
    await waitFor(() => expect(result.current.statuses.sim?.status.state).toBe('live'));
    expect(get).toHaveBeenCalledWith('live');
    act(() => result.current.reconnect('sim'));
    await waitFor(() => expect(result.current.statuses.sim?.status.state).toBe('live'));
  });

  it('disposes the hub on unmount', async () => {
    const doc = simDoc();
    const secrets = new SessionSecretStore(null);
    const { result, unmount } = renderHook(() => useConnectionHub(host, doc, secrets));
    await waitFor(() => expect(result.current.hub).toBeDefined());
    const dispose = vi.spyOn(result.current.hub!, 'dispose');
    unmount();
    expect(dispose).toHaveBeenCalled();
  });
});
