import type { DocumentChannel } from './documents/changes';

/** A document channel that drops everything (component tests do not need cross-tab notices). */
export const NO_CHANNEL: DocumentChannel = { post: () => undefined, subscribe: () => () => undefined };

import type { ContributionRegistry } from '@holodeck/sdk';
import { stampPlacement, type IsoSceneFile } from '@holodeck/editor-2.5d-react';

/** Test fixture: `scene` with part `partId` stamped at (x, y) the way the palette would. */
export function withPart(scene: IsoSceneFile, registry: ContributionRegistry, partId: string, x = 0, y = 0): { scene: IsoSceneFile; id: string } {
  const placement = stampPlacement(registry, partId, x, y, { objects: scene.objects });
  return { scene: { ...scene, objects: [...scene.objects, placement] }, id: placement.id };
}

/**
 * Connection configs that carry credentials (holodeck#163 review). Every one
 * must be refused by the connection dialog, document save and import.
 */
export const CREDENTIAL_CASES: ReadonlyArray<{ name: string; provider: string; config: Record<string, unknown> }> = [
  { name: 'HTTP Authorization header', provider: 'holodeck.http', config: { url: 'http://x.test/a', headers: { Authorization: 'Bearer SECRET' } } },
  { name: 'HTTP authorization header (lower case)', provider: 'holodeck.http', config: { url: 'http://x.test/a', headers: { authorization: 'Bearer SECRET' } } },
  { name: 'HTTP Proxy-Authorization header', provider: 'holodeck.http', config: { url: 'http://x.test/a', headers: { 'Proxy-Authorization': 'Basic U0VDUkVU' } } },
  { name: 'HTTP Cookie header', provider: 'holodeck.http', config: { url: 'http://x.test/a', headers: { Cookie: 'session=SECRET' } } },
  { name: 'HTTP X-Api-Key header', provider: 'holodeck.http', config: { url: 'http://x.test/a', headers: { 'X-Api-Key': 'SECRET' } } },
  { name: 'HTTP URL userinfo', provider: 'holodeck.http', config: { url: 'https://user:SECRET@x.test/a' } },
  { name: 'HTTP URL api_key query', provider: 'holodeck.http', config: { url: 'https://x.test/a?api_key=SECRET' } },
  { name: 'HTTP POST body password', provider: 'holodeck.http', config: { url: 'https://x.test/a', method: 'POST', body: { password: 'SECRET' } } },
  { name: 'HTTP websocket subscribe token', provider: 'holodeck.http', config: { url: 'wss://x.test/a', mode: 'websocket', subscribe: { token: 'SECRET' } } },
  { name: 'HTTP token key', provider: 'holodeck.http', config: { url: 'https://x.test/a', token: 'SECRET' } },
  { name: 'AWS aws_secret_access_key', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', aws_secret_access_key: 'SECRET' } },
  { name: 'AWS secret', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', secret: 'SECRET' } },
  { name: 'AWS secretAccessKey', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', secretAccessKey: 'SECRET' } },
  { name: 'AWS credentials.secretAccessKey', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', credentials: { type: 'static', secretAccessKey: 'SECRET' } } },
  { name: 'AWS sessionToken', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', sessionToken: 'SECRET' } },
  { name: 'AWS access key id as a value', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', discover: { tags: [{ key: 'owner', values: ['AKIAABCDEFGHIJKLMNOP'] }] } } },
  { name: 'unknown provider with apiKey', provider: 'acme.custom', config: { endpoint: 'https://x.test', apiKey: 'SECRET' } },
];
