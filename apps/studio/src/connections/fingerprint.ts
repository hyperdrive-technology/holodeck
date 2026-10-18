/**
 * Which endpoint a connection's secrets were entered for (holodeck#166).
 *
 * A secret is stored with the fingerprint of its connection at entry time and
 * only handed out while the connection still has that fingerprint. Changing
 * where a connection points (the HTTP origin or auth scheme, the AWS region,
 * role or identity pool) therefore asks for the secrets again instead of
 * sending them to the new place; so does a document imported later under the
 * same id with a different endpoint.
 *
 * Known providers fingerprint only what decides where credentials go, so
 * tuning a poll interval keeps them. Unknown providers fingerprint the whole
 * config (fail closed: any change asks again).
 */

import type { ProviderConnection } from '@holodeck/sdk';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys, so equal objects give equal strings. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObj(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

function originOf(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    return new URL(url).origin;
  } catch {
    return url; // Unparsable: the whole string (any change differs).
  }
}

export function connectionFingerprint(connection: Pick<ProviderConnection, 'provider' | 'config'>): string {
  const config = isObj(connection.config) ? connection.config : {};
  switch (connection.provider) {
    case 'holodeck.http': {
      const write = isObj(config.write) ? config.write : {};
      // A write URL may be absolute (same origin is enforced by the provider, but be strict).
      return stable({ p: connection.provider, origin: originOf(config.url), auth: config.auth ?? null, writeOrigin: typeof write.url === 'string' && /^[a-z]+:/i.test(write.url) ? originOf(write.url) : null });
    }
    case 'aws.cloudwatch': {
      const creds = isObj(config.credentials) ? config.credentials : { type: 'static' };
      return stable({ p: connection.provider, region: config.region ?? null, regions: config.regions ?? null, type: creds.type ?? null, roleArn: creds.roleArn ?? null, identityPoolId: creds.identityPoolId ?? null });
    }
    default:
      return stable({ p: connection.provider, config });
  }
}
