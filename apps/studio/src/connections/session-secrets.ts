/**
 * Secrets bound to the provider SESSION that asks for them (review of
 * holodeck#163 @ f39c7e5).
 *
 * The SDK hub gives providers `ctx.secret(key)`, which it answers with
 * `options.secret(connectionId, key)`: no session identity. Looking up "the
 * connection's current fingerprint" is therefore racy: a slow session still
 * connecting to endpoint A could ask after the document moved to endpoint B,
 * and get the secret just entered for B.
 *
 * Without changing the SDK, the studio gives its hub a registry view whose
 * providers wrap `connect`: each `connect(config, ctx)` call (one per session)
 * gets a `ctx.secret` bound to the fingerprint of THAT call's `config`, the
 * hub's private, immutable copy for the session. A session can only ever
 * receive secrets entered for the endpoint it was opened with.
 */

import { HOLODECK_KINDS, type ContributionRegistry, type HolodeckProvider } from '@holodeck/sdk';
import { connectionFingerprint } from './fingerprint';

/** (connectionId, secret key, fingerprint of the requesting session) -> secret. */
export type SessionSecretLookup = (connectionId: string, key: string, fingerprint: string) => string | undefined;

/**
 * A registry view for `new ProviderHub({ registry })`: the same contributions,
 * with every provider's `connect` handing the session a fingerprint-bound
 * `ctx.secret`. Wrapped providers are cached per original, so the hub's
 * "provider changed" check (identity) keeps working.
 *
 * Only `get`, `list` and `subscribe` are used by `ProviderHub` (and providers'
 * `ctx.registry`); the cast documents that this is a read-only view.
 */
export function sessionBoundRegistry(registry: ContributionRegistry, lookup: SessionSecretLookup): ContributionRegistry {
  const wrapped = new WeakMap<HolodeckProvider, HolodeckProvider>();
  const wrap = (provider: HolodeckProvider): HolodeckProvider => {
    let w = wrapped.get(provider);
    if (!w) {
      w = Object.assign(Object.create(provider) as HolodeckProvider, {
        connect: (config: Record<string, unknown>, ctx: Parameters<HolodeckProvider['connect']>[1]) => {
          // Fixed for this session: computed from the config this session was opened with.
          const fingerprint = connectionFingerprint({ provider: provider.id, config });
          return provider.connect(config, {
            ...ctx,
            secret: async (key: string) => (ctx.signal.aborted ? undefined : lookup(ctx.connectionId, key, fingerprint)),
          });
        },
      });
      wrapped.set(provider, w);
    }
    return w;
  };
  const view = {
    get: <T,>(kind: string, id: string): T | undefined => {
      const item = registry.get(kind, id);
      return (kind === HOLODECK_KINDS.provider && item ? wrap(item as HolodeckProvider) : item) as T | undefined;
    },
    list: <T,>(kind: string): readonly T[] => {
      const items = registry.list(kind);
      return (kind === HOLODECK_KINDS.provider ? items.map((p) => wrap(p as HolodeckProvider)) : items) as readonly T[];
    },
    subscribe: registry.subscribe.bind(registry),
  };
  return view as unknown as ContributionRegistry;
}
