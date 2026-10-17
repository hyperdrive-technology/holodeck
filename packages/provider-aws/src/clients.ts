/**
 * AWS SDK v3 clients for one session: credentials, the HTTP handler that
 * routes every AWS request through `ProviderContext.fetch` with the origin
 * allowlist applied, and one CloudWatch + Tagging client per region.
 *
 * Why `ctx.fetch` and not the SDK's default handler: a host enforces its
 * network policy (and tests fake the backend) at `ctx.fetch`. The SDK's own
 * `FetchHttpHandler` is browser-native and takes a `customFetch`, so the
 * same code path runs in browsers and Node.
 */

import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { CognitoIdentityClient, GetCredentialsForIdentityCommand, GetIdCommand } from '@aws-sdk/client-cognito-identity';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { originMatches, type ProviderContext } from '@holodeck/sdk';
import { FetchHttpHandler, streamCollector } from '@smithy/fetch-http-handler';
import type { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@smithy/types';
import type { AwsConnectionConfig } from './config';
import { AwsProviderError } from './errors';
import type { Redactor } from './redact';

/**
 * Origins the provider contacts (CloudWatch, Resource Groups Tagging API, STS
 * for assumeRole, Cognito Identity), in commercial/GovCloud and China
 * partitions. Declared as the package's `permissions.network` and enforced on
 * every request.
 *
 * Browser note for the next agent (not verifiable without a real AWS account,
 * which tests must not use): calling these endpoints from a web page needs
 * them to answer CORS preflights. CloudWatch, STS and Cognito Identity are
 * documented as usable from the browser SDK; whether the Resource Groups
 * Tagging API (`discover`) does is unconfirmed. If a browser host sees CORS
 * failures for `tagging.*`, route that call through the host (a
 * `ProviderContext.fetch` that proxies) rather than widening permissions.
 */
export const AWS_ORIGINS: readonly string[] = Object.freeze([
  'https://monitoring.*.amazonaws.com',
  'https://tagging.*.amazonaws.com',
  'https://sts.*.amazonaws.com',
  'https://sts.amazonaws.com',
  'https://cognito-identity.*.amazonaws.com',
  'https://monitoring.*.amazonaws.com.cn',
  'https://tagging.*.amazonaws.com.cn',
  'https://sts.*.amazonaws.com.cn',
  'https://cognito-identity.*.amazonaws.com.cn',
]);

/** What a host callback receives when it is asked for credentials. */
export interface AwsCredentialRequest {
  connectionId: string;
  /** Default region of the connection. */
  region: string;
}

/**
 * Host-supplied credentials (`credentials.type: "host"`, or the source
 * identity of `assumeRole` when no static secrets are set). Called whenever
 * the previous credentials expire (`expiration`) or, without an expiration,
 * once per session. The returned values are redacted from all output.
 */
export type AwsCredentialCallback = (request: AwsCredentialRequest) => Promise<AwsCredentialIdentity> | AwsCredentialIdentity;

export interface AwsClients {
  cloudwatch(region: string): CloudWatchClient;
  tagging(region: string): ResourceGroupsTaggingAPIClient;
  destroy(): void;
}

export interface ClientDeps {
  config: AwsConnectionConfig;
  ctx: ProviderContext;
  redact: Redactor;
  origins: readonly string[];
  hostCredentials?: AwsCredentialCallback;
  /** Aborted when the session closes: cancels STS / Cognito exchanges in flight. */
  signal: AbortSignal;
}

/**
 * Refresh credentials this long before they expire, or at half their
 * remaining lifetime when that is shorter. Without the "half" rule,
 * credentials issued with less than 5 minutes left would be re-fetched on
 * every request: the SDK asks for an identity several times per call.
 */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Silent SDK logger: the SDK never writes to the console on our behalf. */
const SILENT_LOGGER = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

/**
 * `ctx.fetch` with the origin allowlist and no redirects. A request to any
 * other origin fails before it is sent.
 */
export function guardedFetch(ctx: ProviderContext, origins: readonly string[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let origin: string;
    try {
      origin = new URL(href).origin;
    } catch {
      throw new AwsProviderError('request URL is invalid', 'network');
    }
    if (!origins.some((pattern) => originMatches(pattern, origin))) {
      throw new AwsProviderError(`origin ${origin} is not in this provider's allowed origins`, 'network');
    }
    return ctx.fetch(input, init);
  }) as typeof fetch;
}

export function createRequestHandler(ctx: ProviderContext, origins: readonly string[], timeoutMs: number): FetchHttpHandler {
  return new FetchHttpHandler({
    customFetch: guardedFetch(ctx, origins),
    requestTimeout: timeoutMs,
    // AWS APIs do not redirect; a redirect would be a misconfigured proxy, and
    // following one could carry a signed request elsewhere.
    requestInit: () => ({ redirect: 'error' }),
  });
}

/**
 * Wrap a credential provider so that (a) every value it yields is added to the
 * redactor, (b) one result is shared by all clients of the session until it
 * nears expiry, and (c) concurrent callers wait for one in-flight fetch.
 *
 * Go comparison: this is a `sync.Once`-style memo with expiry; in JS one
 * shared Promise plays the role of the mutex-protected result.
 */
export function memoizeCredentials(
  load: () => Promise<AwsCredentialIdentity>,
  redact: Redactor,
  now: () => number,
): AwsCredentialIdentityProvider {
  let current: Promise<AwsCredentialIdentity> | undefined;
  let refreshAt = Infinity;
  return async () => {
    if (!current || now() >= refreshAt) {
      const pending = (async () => {
        const creds = await load();
        if (!creds || typeof creds.accessKeyId !== 'string' || typeof creds.secretAccessKey !== 'string' || !creds.accessKeyId || !creds.secretAccessKey) {
          throw new AwsProviderError('credentials are incomplete (need accessKeyId and secretAccessKey)', 'auth');
        }
        redact.add(creds.accessKeyId, creds.secretAccessKey, creds.sessionToken);
        const loadedAt = now();
        const expiresAt = creds.expiration instanceof Date ? creds.expiration.getTime() : Infinity;
        refreshAt = expiresAt - Math.min(EXPIRY_MARGIN_MS, Math.max(0, (expiresAt - loadedAt) / 2));
        return creds;
      })();
      current = pending;
      // A failed load is not cached: the next request tries again.
      pending.catch(() => {
        if (current === pending) current = undefined;
      });
    }
    return current;
  };
}

async function staticSecrets(ctx: ProviderContext, redact: Redactor): Promise<AwsCredentialIdentity | undefined> {
  const [accessKeyId, secretAccessKey, sessionToken] = await Promise.all([
    ctx.secret('accessKeyId'),
    ctx.secret('secretAccessKey'),
    ctx.secret('sessionToken'),
  ]);
  // Redact before validating, so even a half-entered pair never shows up in a message.
  redact.add(accessKeyId, secretAccessKey, sessionToken);
  if (!accessKeyId && !secretAccessKey) return undefined;
  if (!accessKeyId || !secretAccessKey) {
    throw new AwsProviderError('secrets accessKeyId and secretAccessKey must both be set', 'config');
  }
  for (const [key, value] of [['accessKeyId', accessKeyId], ['secretAccessKey', secretAccessKey], ['sessionToken', sessionToken]] as const) {
    if (value !== undefined && /[\s\0]/.test(value)) throw new AwsProviderError(`secret "${key}" must not contain whitespace`, 'config');
  }
  return sessionToken ? { accessKeyId, secretAccessKey, sessionToken } : { accessKeyId, secretAccessKey };
}

function hostProvider(deps: ClientDeps): () => Promise<AwsCredentialIdentity> {
  const { hostCredentials, ctx, config } = deps;
  if (!hostCredentials) {
    throw new AwsProviderError('credentials type needs a host credentials callback (AwsProviderOptions.credentials), and none is installed', 'config');
  }
  return async () => hostCredentials({ connectionId: ctx.connectionId, region: config.region });
}

/** A session's credentials, plus the STS / Cognito client (if any) to destroy on close. */
export interface ResolvedCredentials {
  credentials: AwsCredentialIdentityProvider;
  destroy(): void;
}

const NO_CREDENTIALS: AwsCredentialIdentityProvider = async () => {
  // Cognito GetId / GetCredentialsForIdentity are unsigned (`smithy.api#noAuth`).
  // An explicit provider stops the SDK from ever falling back to its default
  // chain (environment, ~/.aws, instance metadata) in Node.
  throw new AwsProviderError('this request must not need credentials', 'auth');
};

/**
 * Resolve the session's credential provider. Static secrets are read now (so
 * a missing secret fails `connect`); STS / Cognito exchanges happen lazily on
 * the first request and are retried by the poller's backoff when they fail.
 *
 * STS and Cognito are called with their own modular clients rather than
 * `@aws-sdk/credential-providers`: that package's browser build is selected
 * through an extension-less `browser` field mapping that esbuild (and so Vite's
 * pre-bundling) does not apply, which pulls Node-only providers (`node:fs`,
 * `node:child_process`) into browser bundles. `scripts/browser-bundle-check.mjs`
 * guards against that regression.
 */
export async function resolveCredentials(deps: ClientDeps, handler: FetchHttpHandler): Promise<ResolvedCredentials> {
  const { config, ctx, redact, signal } = deps;
  const now = () => ctx.now();
  const creds = config.credentials;
  const clientCommon = { requestHandler: handler, streamCollector, maxAttempts: config.maxAttempts, retryMode: 'standard' as const, logger: SILENT_LOGGER };
  switch (creds.type) {
    case 'static': {
      const identity = await staticSecrets(ctx, redact);
      if (!identity) throw new AwsProviderError('credentials type static needs the secrets accessKeyId and secretAccessKey', 'config');
      return { credentials: memoizeCredentials(async () => identity, redact, now), destroy() {} };
    }
    case 'host':
      return { credentials: memoizeCredentials(hostProvider(deps), redact, now), destroy() {} };
    case 'assumeRole': {
      const base = await staticSecrets(ctx, redact);
      const externalId = await ctx.secret('externalId');
      redact.add(externalId);
      const source: AwsCredentialIdentityProvider = base ? async () => base : memoizeCredentials(hostProvider(deps), redact, now);
      // Regional STS endpoint in the connection's region (sts.<region>.amazonaws.com).
      const sts = new STSClient({ ...clientCommon, region: config.region, credentials: source });
      const load = async (): Promise<AwsCredentialIdentity> => {
        const res = await sts.send(
          new AssumeRoleCommand({
            RoleArn: creds.roleArn,
            RoleSessionName: creds.sessionName,
            DurationSeconds: creds.durationS,
            ...(externalId ? { ExternalId: externalId } : {}),
          }),
          { abortSignal: signal },
        );
        const c = res.Credentials;
        if (!c?.AccessKeyId || !c.SecretAccessKey) throw new AwsProviderError('AssumeRole returned no credentials', 'auth');
        return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
      };
      return { credentials: memoizeCredentials(load, redact, now), destroy: () => sts.destroy() };
    }
    case 'cognito': {
      const poolRegion = creds.identityPoolId.slice(0, creds.identityPoolId.indexOf(':'));
      const cognito = new CognitoIdentityClient({ ...clientCommon, region: poolRegion, credentials: NO_CREDENTIALS });
      // The identity id is not a secret, but it is per browser/session: keep it in memory only.
      let identityId: string | undefined;
      const load = async (): Promise<AwsCredentialIdentity> => {
        if (!identityId) {
          const res = await cognito.send(new GetIdCommand({ IdentityPoolId: creds.identityPoolId }), { abortSignal: signal });
          if (!res.IdentityId) throw new AwsProviderError('Cognito GetId returned no identity', 'auth');
          identityId = res.IdentityId;
        }
        const res = await cognito.send(new GetCredentialsForIdentityCommand({ IdentityId: identityId }), { abortSignal: signal });
        const c = res.Credentials;
        if (!c?.AccessKeyId || !c.SecretKey) throw new AwsProviderError('Cognito returned no credentials', 'auth');
        return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretKey, sessionToken: c.SessionToken, expiration: c.Expiration };
      };
      return { credentials: memoizeCredentials(load, redact, now), destroy: () => cognito.destroy() };
    }
  }
}

export function createClients(config: AwsConnectionConfig, handler: FetchHttpHandler, credentials: AwsCredentialIdentityProvider): AwsClients {
  const cw = new Map<string, CloudWatchClient>();
  const tg = new Map<string, ResourceGroupsTaggingAPIClient>();
  const common = (region: string) => ({
    region,
    credentials,
    requestHandler: handler,
    // Node's default stream collector expects Node streams; fetch returns web streams.
    streamCollector,
    maxAttempts: config.maxAttempts,
    // `standard` retries throttling and transient errors with jittered
    // exponential backoff; `adaptive` would add a client-side rate limiter that
    // keeps state across calls, which a polling loop with its own backoff does not need.
    retryMode: 'standard',
    logger: SILENT_LOGGER,
  });
  return {
    cloudwatch(region) {
      let client = cw.get(region);
      if (!client) cw.set(region, (client = new CloudWatchClient(common(region))));
      return client;
    },
    tagging(region) {
      let client = tg.get(region);
      if (!client) tg.set(region, (client = new ResourceGroupsTaggingAPIClient(common(region))));
      return client;
    },
    destroy() {
      for (const client of [...cw.values(), ...tg.values()]) client.destroy();
      cw.clear();
      tg.clear();
    },
  };
}
