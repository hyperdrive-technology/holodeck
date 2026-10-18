import { ContributionRegistry, HOLODECK_KINDS, PROVIDER_KIND, ProviderHub, type HolodeckProvider, type ProviderSession } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import { connectionFingerprint } from './fingerprint';
import { sessionBoundRegistry } from './session-secrets';

/**
 * A provider whose sessions ask for their secret only after `release()`:
 * the race the review found (a slow session asking after the connection
 * moved to another endpoint).
 */
function delayedProvider() {
  const gates: Array<() => void> = [];
  const received: Array<{ url: unknown; token: string | undefined }> = [];
  const provider: HolodeckProvider = {
    id: 'test.delayed',
    label: 'Delayed',
    capabilities: { read: true },
    secrets: [{ key: 'token', label: 'Token' }],
    async connect(config, ctx) {
      await new Promise<void>((resolve) => gates.push(resolve));
      received.push({ url: config.url, token: await ctx.secret('token') });
      const session: ProviderSession = {
        status: () => ({ state: 'live', since: 0 }),
        onStatus: () => () => undefined,
        subscribe: () => () => undefined,
        close: async () => undefined,
      };
      return session;
    },
  };
  return { provider, received, releaseAll: () => gates.splice(0).forEach((g) => g()) };
}

function setup() {
  const base = new ContributionRegistry();
  base.registerKind(PROVIDER_KIND);
  const delayed = delayedProvider();
  base.install({ id: 'test.pkg', version: '1.0.0', contributions: { [HOLODECK_KINDS.provider]: [delayed.provider] } });
  return { base, ...delayed };
}

const A = { id: 'api', provider: 'test.delayed', config: { url: 'https://a.example' } };
const B = { id: 'api', provider: 'test.delayed', config: { url: 'https://b.example' } };

describe('sessionBoundRegistry (holodeck#166, review of #163)', () => {
  it('a session opened for endpoint A never receives the secret entered for endpoint B', async () => {
    const { base, received, releaseAll } = setup();
    // The store holds only B's secret (the user just re-entered it after moving the connection).
    const lookup = (_id: string, key: string, fingerprint: string) => (key === 'token' && fingerprint === connectionFingerprint(B) ? 'B-SECRET' : undefined);
    const hub = new ProviderHub({ registry: sessionBoundRegistry(base, lookup) });
    hub.setConnections([A]); // slow session for A starts
    hub.setConnections([B]); // the document moves to B before A asked
    releaseAll();
    await hub.settled();
    expect(received).toEqual(
      expect.arrayContaining([
        { url: 'https://a.example', token: undefined },
        { url: 'https://b.example', token: 'B-SECRET' },
      ]),
    );
    await hub.dispose();
  });

  it('even a live (not aborted) session for A asks with A’s fingerprint', async () => {
    const { base, received, releaseAll } = setup();
    const asked: string[] = [];
    const lookup = (_id: string, _key: string, fingerprint: string) => {
      asked.push(fingerprint);
      return fingerprint === connectionFingerprint(A) ? 'A-SECRET' : undefined;
    };
    const hub = new ProviderHub({ registry: sessionBoundRegistry(base, lookup) });
    hub.setConnections([A]);
    releaseAll();
    await hub.settled();
    expect(asked).toEqual([connectionFingerprint(A)]);
    expect(received).toEqual([{ url: 'https://a.example', token: 'A-SECRET' }]);
    await hub.dispose();
  });

  it('keeps providers’ identity stable and passes other kinds through', () => {
    const { base } = setup();
    const view = sessionBoundRegistry(base, () => undefined);
    expect(view.get(HOLODECK_KINDS.provider, 'test.delayed')).toBe(view.get(HOLODECK_KINDS.provider, 'test.delayed'));
    expect(view.list(HOLODECK_KINDS.provider)).toHaveLength(1);
    expect(view.get<HolodeckProvider>(HOLODECK_KINDS.provider, 'test.delayed')?.label).toBe('Delayed');
    expect(view.get(HOLODECK_KINDS.provider, 'missing')).toBeUndefined();
  });

  // #171: frozen providers and the full registry interface.
  it('wraps a frozen provider and still binds its secrets', async () => {
    const base = new ContributionRegistry();
    base.registerKind(PROVIDER_KIND);
    const { provider, received, releaseAll } = delayedProvider();
    base.install({ id: 'test.pkg', version: '1.0.0', contributions: { [HOLODECK_KINDS.provider]: [Object.freeze(provider)] } });
    const view = sessionBoundRegistry(base, (_c, _k, fp) => (fp === connectionFingerprint(A) ? 'A-SECRET' : undefined));
    expect(() => view.get(HOLODECK_KINDS.provider, 'test.delayed')).not.toThrow();
    const hub = new ProviderHub({ registry: view });
    hub.setConnections([A]);
    releaseAll();
    await hub.settled();
    expect(received).toEqual([{ url: 'https://a.example', token: 'A-SECRET' }]);
    await hub.dispose();
  });

  it('exposes the whole registry interface, bound to the real registry', () => {
    const { base } = setup();
    const view = sessionBoundRegistry(base, () => undefined);
    expect(view.hasKind(HOLODECK_KINDS.provider)).toBe(true);
    expect(view.ownerOf(HOLODECK_KINDS.provider, 'test.delayed')).toBe('test.pkg');
    expect(view.installedExtensions().map((e) => e.id)).toEqual(['test.pkg']);
    expect(typeof view.subscribe(() => undefined)).toBe('function');
  });
});
