# @holodeck/provider-http

`holodeck.http`: a generic JSON provider for Holodeck documents. External systems publish object state as JSON, and
documents bind object parameters (colour, label, level …) to values inside those messages. It is Holodeck's
equivalent of Arcentry's "API" feature (`docs/ARCENTRY_PARITY.md`, lane P2).

- **Transports:** HTTP polling, Server-Sent Events, WebSocket.
- **Sources:** JSON pointer (`/pumps/0/rpm`) or JSONPath-lite (`$.pumps[0].rpm`), optionally on another endpoint of
  the same origin (`/api/line2#/speed`).
- **Writes:** optional, over HTTP (`POST`, `PUT` or `PATCH`).
- **Capabilities:** `subscribe`, `read`, `write`, `browse` (signal picker over the live JSON).

Pure TypeScript, ESM only, no React. Runs in browsers and Node ≥ 22 (global `fetch` and `WebSocket`). The only
runtime dependency besides `@holodeck/sdk` is [`eventsource-parser`](https://github.com/rexxars/eventsource-parser).
Contract: `@holodeck/sdk` `docs/PACKAGING.md` §6.

## Install into a host

```ts
import { HolodeckHost } from '@holodeck/sdk';
import manifest from '@holodeck/provider-http/holodeck.package.json';
import httpProviderPackage from '@holodeck/provider-http/holodeck-package';

const host = new HolodeckHost({ name: 'studio' });
await host.installPackage(manifest, httpProviderPackage);

const hub = host.createProviderHub({ secret: (connectionId, key) => vault.get(connectionId, key) });
hub.setConnections([{ id: 'plant', provider: 'holodeck.http', config: { url: 'https://plant.example.com/api/status' } }]);
hub.setBindings([
  { objectId: 'pump1', param: 'color', binding: { connection: 'plant', source: '$.pumps[0].state',
    transform: { kind: 'map', cases: { RUN: '#2ecc71', FAULT: '#e74c3c' }, default: '#bdc3c7' } } },
]);
```

## Sources

```
source   := [ endpoint "#" ] selector  |  jsonpath
endpoint := "/" path [ "?" query ]      on the connection URL's origin
selector := json-pointer | jsonpath
```

| Source | Reads |
|---|---|
| `/temperature` | `temperature` of the default endpoint's message |
| `/pumps/0/rpm` | RFC 6901 pointer; `~1` is `/`, `~0` is `~` |
| `$.pumps[0].rpm` | JSONPath-lite: `.name`, `[0]`, `[-1]` (from the end), `['any key']` |
| `/api/line2#/speed` | `speed` from `GET /api/line2` (polled or streamed separately) |
| `#/a#b` | key `a#b` on the default endpoint (a pointer containing `#` needs the explicit `#` prefix) |

"Lite" means no wildcards, filters, recursion or slices: one source names one value, because a Holodeck signal is
one scalar. Values must be JSON scalars (number, string, boolean, null). A path that resolves to an object or array,
or that is missing from a polled response, gives `{ value: null, quality: 'bad' }`. Streaming messages may be
partial: a source missing from an SSE/WebSocket message is not updated.

Endpoints can never leave the connection's origin, so a document cannot send this connection's credentials elsewhere.

## Connection config

Non-secret settings only (they are stored in the document). `HTTP_CONFIG_SCHEMA` is the JSON Schema; unknown keys are
errors.

| Key | Default | Meaning |
|---|---|---|
| `url` | (required) | Default endpoint: `http(s)://` for `poll`/`sse`, `ws(s)://` for `websocket` |
| `mode` | `poll` | `poll`, `sse` or `websocket` |
| `intervalMs` | `5000` | Poll period (min 50). The next poll starts after the previous one finishes. |
| `timeoutMs` | `10000` | Per request; for streams, the time allowed to open the stream |
| `backoff` | `{ initialMs: 1000, maxMs: 30000, factor: 2, jitter: 0.2 }` | Retry delays after failures |
| `headers` | `{}` | Extra headers. `Authorization`, `Cookie`, `Proxy-Authorization` are refused: use `auth`. |
| `auth` | none | `{scheme:'bearer'}`, `{scheme:'header',name}`, `{scheme:'query',name}`, `{scheme:'basic',username}` |
| `method`, `body` | `GET` | Poll with `POST` and a JSON body (GraphQL-style APIs) |
| `timestamp` | receive time | Selector of the message timestamp (epoch ms or ISO 8601) |
| `events` | all | SSE: event names to accept (unnamed events are `message`) |
| `subscribe` | none | WebSocket: JSON sent after every (re)connect |
| `protocols` | none | WebSocket subprotocols |
| `write` | disabled | `{ method?: 'POST'\|'PUT'\|'PATCH', url?: '/tags/{selector}', body?: 'envelope'\|'value' }` |
| `maxBytes` | 4 MiB | Largest response, SSE event or WebSocket message accepted |
| `followRedirects` | `false` | A redirect is an error unless enabled |

### Writes

`session.write(source, value)` sends `{"source": "<source>", "value": <value>}` (`body: 'envelope'`) or the bare JSON
value (`body: 'value'`) to `write.url` (default: the connection URL, on its HTTP origin for WebSocket connections).
`{source}` and `{selector}` in `write.url` are replaced with the URI-encoded source or selector. Non-2xx responses
reject with `HTTP <status>`; the response body is never read into errors or logs.

## Secrets

Declared secrets: `token` (schemes `bearer`, `header`, `query`) and `password` (scheme `basic`). They come from
`ProviderContext.secret(key)`, are read once per session, and never appear in documents, logs, status messages or
thrown errors: every string the provider emits is passed through a redactor (raw and URL-encoded forms), and URLs
are logged as origin + path only. WebSocket connections support only the `query` scheme, because browsers cannot set
headers on a WebSocket handshake.

## Status

| State | When |
|---|---|
| `live` | Data flowing (or `idle`: no subscriptions) |
| `connecting` | First attempt in progress |
| `stale` | Was live, now failing and retrying with backoff; last values are kept |
| `error` | Never got data; retrying with backoff. The message names the cause (`HTTP 503`, `timed out after …`, `not valid JSON`) |
| `disconnected` | After `close()` or when the host aborts the session |

With several endpoints the session reports the worst one and prefixes the message with its URL. Malformed SSE or
WebSocket messages are logged (without their content) and skipped; a malformed poll response counts as a failed poll.

## Network permissions

The default package contacts whichever origin a connection's `url` names, so its `holodeck.package.json` declares no
`permissions.network`: the SDK's origin grammar has no "chosen by the user" form. A host or deployment that wants a
fixed allowlist builds a restricted package:

```ts
import { createHttpProviderPackage } from '@holodeck/provider-http';

const pkg = createHttpProviderPackage({ origins: ['https://*.example.com', 'wss://feed.example.com'] });
await host.installPackage(pkg.manifest, pkg); // manifest.permissions.network === origins
```

The restricted provider refuses to connect outside those origins (including the HTTP origin used for writes on a
WebSocket connection) and cannot enable redirects. Installing it with the default manifest fails with
`MANIFEST_MISMATCH`, because its provider's `origins` are not covered by `permissions.network`.

## Lifecycle

One channel (poller, event stream or socket) per endpoint, shared by every subscription that reads from it. The last
unsubscribe stops the channel: timer cleared, request aborted, stream cancelled, socket closed. `close()` and the
host's abort signal stop everything. The test suite proves this against a local server by counting requests and open
connections after unsubscribe.

Known limitation: Node's built-in (undici) WebSocket does not abort a handshake that is still pending when `close()`
is called; the TCP connection lingers until the server answers. The provider ignores that socket (no events, no
retries). Browsers abort the handshake.

## Tests

```sh
pnpm install && pnpm type-check && pnpm exec vitest run
pnpm build && pnpm smoke
```

All tests run against a local `node:http` + `ws` server on 127.0.0.1 (`src/test-support/server.ts`): conformance
(`runProviderConformance`) for each mode, reconnect and backoff, malformed and oversized payloads, timeouts, leaked
subscriptions, secret redaction, origin allowlists, and a `ProviderHub` end-to-end test.
