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
  // Review of #163 @ 7e01b65: relative write URLs.
  { name: 'HTTP relative write.url with api_key', provider: 'holodeck.http', config: { url: 'https://x.test/a', write: { url: 'write?api_key=SECRET' } } },
  { name: 'HTTP scheme-relative write.url with userinfo', provider: 'holodeck.http', config: { url: 'https://x.test/a', write: { url: '//admin:SECRET@x.test/write' } } },
  // holodeck#168: more names, params and token shapes.
  { name: 'HTTP X-Auth-Key header', provider: 'holodeck.http', config: { url: 'https://x.test/a', headers: { 'X-Auth-Key': 'SECRET' } } },
  { name: 'HTTP Ocp-Apim-Subscription-Key header', provider: 'holodeck.http', config: { url: 'https://x.test/a', headers: { 'Ocp-Apim-Subscription-Key': 'SECRET' } } },
  { name: 'HTTP X-Functions-Key header', provider: 'holodeck.http', config: { url: 'https://x.test/a', headers: { 'X-Functions-Key': 'SECRET' } } },
  { name: 'HTTP Google key= param', provider: 'holodeck.http', config: { url: 'https://x.test/a?key=SECRET' } },
  { name: 'HTTP Azure SAS sig= param', provider: 'holodeck.http', config: { url: 'https://x.test/a?sv=2024&sig=SECRET' } },
  { name: 'HTTP Azure Functions code= param', provider: 'holodeck.http', config: { url: 'https://x.test/a?code=SECRET' } },
  { name: 'HTTP Firebase auth= param', provider: 'holodeck.http', config: { url: 'https://x.test/a.json?auth=SECRET' } },
  { name: 'HTTP sloppy userinfo https:/u:p@h', provider: 'holodeck.http', config: { url: 'https://x.test/a', write: { url: 'https:/admin:SECRET@x.test/w' } } },
  { name: 'HTTP header value with a GitHub token', provider: 'holodeck.http', config: { url: 'https://x.test/a', headers: { 'X-Custom': 'ghp_SECRETabcdefghijklmnopqrstu' } } },
  { name: 'HTTP body with a JWT', provider: 'holodeck.http', config: { url: 'https://x.test/a', method: 'POST', body: { q: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTRUNSRVQifQ.c2lnbmF0dXJl' } } },
];

/**
 * Configs that must NOT be refused (holodeck#169): paging / quota words next
 * to "token", references to secrets, non-web userinfo, "Basic" in prose.
 */
export const CLEAN_CASES: ReadonlyArray<{ name: string; provider: string; config: Record<string, unknown> }> = [
  { name: 'HTTP X-Token-Count header', provider: 'holodeck.http', config: { url: 'https://x.test/a', headers: { 'X-Token-Count': '3', Accept: 'application/json' } } },
  { name: 'HTTP paging body keys', provider: 'holodeck.http', config: { url: 'https://x.test/a', method: 'POST', body: { nextToken: 'abc', maxTokens: 100, csrfTokenHeader: 'X-CSRF' } } },
  { name: 'HTTP page_token / tokenizer params', provider: 'holodeck.http', config: { url: 'https://x.test/a?page_token=2&tokenizer=bpe&limit=10' } },
  { name: 'HTTP relative write.url without credentials', provider: 'holodeck.http', config: { url: 'https://x.test/a', write: { url: 'write/{source}' } } },
  { name: 'HTTP header auth scheme naming a header', provider: 'holodeck.http', config: { url: 'https://x.test/a', auth: { scheme: 'header', name: 'X-Api-Key' } } },
  { name: 'AWS discover tags (key/values)', provider: 'aws.cloudwatch', config: { region: 'eu-west-1', discover: { tags: [{ key: 'team', values: ['ops'] }] } } },
  { name: 'unknown provider: secret reference names, ssh user, prose', provider: 'acme.custom', config: { secretName: 'prod/db', SecretsManagerRequests: 5, repo: 'ssh://git@git.example/x.git', plan: 'Basic tier', note: 'Bearer of bad news' } },
];
