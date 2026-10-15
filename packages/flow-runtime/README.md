# @holodeck/flow-runtime

The engine-independent half of Holodeck's flow engine (`holodeck.flow`, milestone M3):

- the **flow block contract**: `FlowBlockDefinition`, kind `holodeck.flow.block`;
- the **graph body** `holodeck.flow.graph.v1` and its validator;
- a **cyclic dataflow** compiler and scheduler (FBD semantics, not Node-RED message passing);
- the built-in structural blocks `flow.const`, `flow.delay`, `signal.in` and `signal.out`;
- the **`holodeck.flow.local` provider**, which deploys a flow document and runs it in this JavaScript realm;
- **signal bridges**, which connect `signal.in` / `signal.out` to the document's other provider connections.

It is pure TypeScript with no React, and it depends only on `@holodeck/sdk`. The editor (xyflow canvas, node
renderers, deploy button) lives in `@holodeck/editor-2d-react` (lane F2). The logic library (AND/OR, timers,
latches …) is `@holodeck/library-logic` (lane F3). Contract: `@holodeck/sdk` `docs/PACKAGING.md` §7.

```ts
import { createLocalFlowProvider, createHubSignalBridge, compileFlow, createFlowRun } from '@holodeck/flow-runtime';
```

## Blocks

A block is data plus an evaluator. The runtime calls `evaluate` once per scan for every node of that block:

```ts
import type { FlowBlockDefinition } from '@holodeck/flow-runtime';

export const and: FlowBlockDefinition = {
  id: 'logic.and',
  label: 'AND',
  category: 'Logic',
  inputs: [{ name: 'in', type: 'bool', variadic: true, min: 2, max: 16, default: true }],
  outputs: [{ name: 'out', type: 'bool' }],
  evaluate: ({ inputs }) => ({ outputs: { out: (inputs.in as boolean[]).every(Boolean) } }),
};

/** On-delay timer: `q` turns on after `in` has been on for `preset` ms. */
export const ton: FlowBlockDefinition<{ elapsed: number }> = {
  id: 'logic.ton',
  label: 'TON',
  category: 'Timers',
  inputs: [{ name: 'in', type: 'bool' }],
  outputs: [{ name: 'q', type: 'bool' }, { name: 'et', type: 'number' }],
  params: { preset: { type: 'number', default: 1000, min: 0, unit: 'ms' } },
  initialState: () => ({ elapsed: 0 }),
  evaluate: ({ inputs, params, state, dtMs }) => {
    const elapsed = inputs.in ? Math.min(state.elapsed + dtMs, params.preset as number) : 0;
    return { outputs: { q: elapsed >= (params.preset as number) && inputs.in === true, et: elapsed }, state: { elapsed } };
  },
};
```

| Field | Rule |
|---|---|
| `id` | Dotted, lowercase namespace first: `logic.and`, `acme.pump.startStop`. ≤ 128 characters. |
| `label`, `category` | Non-empty; `category` groups the palette. |
| `inputs`, `outputs` | Port specs `{ name, type, label?, description? }`. Names are identifiers (`[A-Za-z_][A-Za-z0-9_]*`, not `__proto__`), unique per side. At most 64 per side. |
| port `type` | `bool`, `number` (finite), `string` or `any` (any JSON scalar, including `null`). |
| input `default` | Value while unconnected. Default: the type default `false` / `0` / `''` / `null`. |
| input `variadic`, `min`, `max` | See below. Inputs only. |
| `params` | `name → spec`: `{ type: 'bool' | 'number' | 'string' | 'any', default?, required?, label?, description? }`. Numbers may add `min`, `max`, `integer`, `step`, `unit`; strings may add `options` and `maxLength`. A param without a `default` whose type default fails its own spec is invalid unless `required`. |
| `checkParams(params)` | Optional cross-param check. Returns problem strings. |
| `initialState(params)` | Optional. The first state of a node. Default `null`. If it throws, the node is never evaluated and stays faulted (`initialState failed: …`) until the next deploy. |
| `evaluate(args)` | Required. See below. |

**`evaluate({ inputs, params, state, dtMs, nowMs }) → { outputs, state? }`** must be pure apart from the state it
returns: no I/O, no timers, no promises, and no mutation. Its arguments are frozen, so mutating one throws and
faults the node.

- `inputs`: one value per input, and a frozen array per variadic input. Values arriving from an `any` output are
  converted to the input's type (table below).
- `params`: every declared param, with defaults applied.
- `state`: what the previous scan returned. It is JSON-like data only: no functions, class instances, cycles or
  non-finite numbers. It may hold up to 10 000 values, nested at most 32 deep. The runtime deep-copies and freezes
  it after every scan.
- `dtMs`: milliseconds since the previous scan. It is 0 on the first scan, and 0 if the clock goes backwards.
- `nowMs`: the run's clock.
- Return `outputs` by port name. An output that is left out, or set to `undefined`, keeps its previous value.
  Return `state` to replace the state. Leave it out to keep the current state, or return `null` to clear it.

**Variadic inputs.** An input `{ name: 'in', variadic: true, min: 2, max: 8 }` is the family of ports `in1` … `in8`
(1-based, no leading zeros). Wires target the instance names. A node has `max(min, highest wired index)`
instances. Unwired instances inside that range read the input's default: give AND `default: true` and OR
`default: false`. `evaluate` receives `inputs.in` as an array of that length. A variadic name may not end in a
digit, and no other input may be named `<variadic><digits>`, so every port name has exactly one meaning. Defaults
are `min` 2 and `max` 16, and `max` can be at most 64. An editor shows `count + 1` handles (up to `max`) so that
there is always a free one.

`FLOW_BLOCK_KIND` (`{ kind: 'holodeck.flow.block', validate: isFlowBlockDefinition }`) passes the SDK's
`runContributionKindConformance`. `flowBlockDefinitionProblems(def)` lists every problem with a definition.

### Built-in blocks

| Block | Ports | Params | Behaviour |
|---|---|---|---|
| `flow.const` | → `value: any` | `type` (`bool`/`number`/`string`, default `number`), `value` | A constant, converted to `type` |
| `flow.delay` | `in: any` → `out: any` | `initial` (default `null`) | One-scan delay of the value. Quality: a time shift outside a loop, the loop's health on one (see [Quality](#quality-and-the-write-gate)). **This is the only legal way to close a loop.** |
| `signal.in` | → `value: any` | `connection`, `source` (required) | Latest value of a provider signal; `null` until the first sample |
| `signal.out` | `value: any` → | `connection`, `source` (required) | Writes its input to a provider signal when it changes, **only while the input is `good` and non-null** (see [Quality](#quality-and-the-write-gate)); an unwired one never writes |

The runtime always uses these definitions for these ids. A registry entry with the same id never replaces them.

## Graph body (`holodeck.flow.graph.v1`)

```json
{
  "nodes": [
    { "id": "level", "block": "signal.in", "params": { "connection": "plant", "source": "sine:10" }, "position": { "x": 0, "y": 0 } },
    { "id": "high", "block": "logic.gt", "params": { "limit": 80 }, "position": { "x": 200, "y": 0 }, "label": "Too high" },
    { "id": "alarm", "block": "signal.out", "params": { "connection": "plant", "source": "mem:alarm" }, "position": { "x": 400, "y": 0 } }
  ],
  "wires": [
    { "id": "w1", "from": { "node": "level", "port": "value" }, "to": { "node": "high", "port": "in" } },
    { "id": "w2", "from": { "node": "high", "port": "out" }, "to": { "node": "alarm", "port": "value" } }
  ]
}
```

Ids are 1–128 characters with no control characters. Param values are JSON scalars. Unknown fields on the body,
nodes and wires are ignored, so editors may keep UI data there. `validateFlowGraph(body, registry)` returns every
problem as `{ severity, code, message, node?, wire?, path? }` and never throws:

| Code | Meaning |
|---|---|
| `INVALID_BODY`, `INVALID_NODE`, `INVALID_WIRE` | Wrong shape (including non-finite positions, unreadable Proxies) |
| `TOO_LARGE` | More than 10 000 nodes or 20 000 wires |
| `DUPLICATE_ID` | A node or wire id is used twice; the message names both positions |
| `UNKNOWN_BLOCK`, `INVALID_BLOCK` | The block is not installed, or its definition is broken |
| `UNKNOWN_NODE`, `UNKNOWN_PORT` | A wire names a missing node or port, or a variadic instance outside `1..max` |
| `TYPE_MISMATCH` | The output and input types differ, and neither is `any` |
| `MULTIPLE_DRIVERS` | More than one wire drives an input |
| `UNKNOWN_PARAM`, `MISSING_PARAM`, `INVALID_PARAM` | A param is unknown, missing, or fails its spec or `checkParams` |
| `CYCLE_WITHOUT_DELAY` | A loop that does not pass through `flow.delay`. `path` lists the loop (`a → b → c → a`) |
| `DUPLICATE_SIGNAL_TARGET` | *Warning:* two `signal.out` nodes write the same signal |
| `TOO_MANY_PROBLEMS` | Only the first 1000 problems are listed; this entry counts the rest. It is an error only if it stands for an error, so an overflow of warnings alone does not block a deploy |

The body is read exactly once into a private snapshot, so the graph that validation sees is the graph that the
compiler builds. Ids such as `__proto__` are plain data: every dictionary has a null prototype, and composite keys
are JSON-encoded.

## Semantics

`compileFlow(body, registry)` returns an immutable `FlowPlan`, or throws `FlowGraphError` (`code: 'INVALID_GRAPH'`,
`problems`). `tryCompileFlow` returns `{ plan, problems }` instead of throwing. The plan's evaluation order is every
non-delay node in topological order (ties in document order), followed by every `flow.delay`.

Each scan of `createFlowRun(plan, { scanMs, now, schedule })`:

1. reads the clock;
2. evaluates every non-delay node in order. Each node reads the current value of the output wired to each input,
   or the input's default when it is unconnected;
3. gives every output of step 2 its quality (see [Quality](#quality-and-the-write-gate));
4. evaluates every delay against those values, then commits all delay outputs together. Readers therefore always
   see the previous scan's value, and a chain of delays shifts by one scan per delay;
5. tells listeners which outputs changed, which nodes are faulted, and which `signal.out` values changed.

Values from `any` outputs are converted into typed inputs as follows:

| to \ from | boolean | number | string | null |
|---|---|---|---|---|
| `bool` | itself | `n !== 0` | `"true"` → true; `"false"` → false; numeric → `n !== 0`; else false *(subst.)* | false *(subst.)* |
| `number` | 1 / 0 | itself | `Number(s)` if non-empty and finite, else 0 *(subst.)* | 0 *(subst.)* |
| `string` | `"true"` / `"false"` | `String(n)` | itself | `""` *(subst.)* |

A block always receives a value of its input's type, but a cell marked *(subst.)* is a **substitute** for a value
that is not there: the reading's quality becomes `bad`, so it can never be written as if it were real
(`convertReading(type, value)` returns `{ value, exact }`; `convertTo` is its value part).

A node whose `evaluate` throws, returns a promise, returns an unknown output, or returns a value of the wrong type
(including `NaN` and strings over 64 KiB) is **faulted** for that scan. None of its outputs or state change, its
outputs' quality becomes `bad`, and `flow:<id>.$fault` carries the message. The other nodes keep running, and the
next good scan clears the fault. Output quality is `uncertain` before the first scan; after that it follows the
rules below.

### Quality and the write gate

`signal.out` writes into real PLC and provider tags, so the runtime never writes a value derived from unknown,
stale or faulted data. Every output carries a quality, ordered `good` < `uncertain` < `bad`.

**The safety contract.** A value is written by `signal.out` only if every external reading that influenced it,
along any path through the graph (through delays and loop state too), was `good` at the scan it was consumed,
and no node on that path faulted (or substituted a missing value) since the influencing value was produced.
There is **one deliberate exception**: a feedback loop's *state* may persist across a non-good period (PLC latch
behaviour: a latch stays latched, an integrator keeps its total), but nothing read from the loop is `good` until
every input the loop takes from outside has been `good`, and nothing on the loop has faulted, for at least one
whole scan after the disturbance. A block's own state (`initialState` / `state`) is the one-node case of the
same exception.

The rules that implement it:

| Output of | Quality |
|---|---|
| A faulted node (`evaluate` failed, `initialState` failed, or `reportFault` set) | `bad` (its held value is kept) |
| Any other block outside a feedback loop | The **worst** quality among the readings it consumed this scan (every wired input instance, variadic ones included). Its own state does not count |
| An unconnected input, `flow.const`, a block with no inputs | Counts as `good` |
| An `any` value converted to a typed input with a *substitute* (table above) | That reading counts as `bad` |
| `signal.in` | The sample's quality. A `null` value (no sample yet, or a provider reporting "no value") is at best `uncertain` |
| `flow.delay` outside any loop | A plain time shift: the quality its input had in the previous scan, delayed with the value. Before the first scan, a non-null `initial` is `good` (configuration) and `initial: null` is `uncertain` |
| A node on a feedback loop (block or `flow.delay`) | The loop's **health** (below). A loop delay shows the health of the scan that stored its value, and is at best `uncertain` while it holds `null` |

**Loop health.** A feedback loop is a strongly connected component of the wire graph (delays included): every
node on it influences every other one, through the loop's delays. Each scan the loop gets one health: the worst
of every reading its nodes take from **outside** the loop, `bad` if any node on it is faulted or reads a
substitute, and `uncertain` if any node on it reads a `null` from inside the loop. Readings *inside* the loop
count as `good` otherwise, which is what keeps one bad scan from circulating forever. Every node on the loop
publishes that health, so a reader outside the loop, whether it taps a block on the loop or one of its delays,
never sees `good` while anything feeding the loop is not good. Loops are handled upstream first, so a loop fed by
another loop is only as good as that loop.

`signal.out` (`FlowScan.writes` / `holds`) follows these rules:

1. It writes only a reading that is `good` **and** non-null. The first scan of a deploy therefore writes nothing
   until the inputs it depends on have real, good samples.
2. While the reading is anything else, it **holds**: nothing is written, the target keeps the last value written
   to it, and no substitute is ever written. The scan in which a node starts holding lists it once in
   `FlowScan.holds`. The provider then drops that node's pending or retried write, so a failed write of a value
   that is now in doubt is not retried.
3. When the reading is `good` again, it writes the current value, even if that equals the last write (the target
   may have changed while the flow was not in control). After that it writes on every change, as before.

`signal.out` reads its input after the delay phase, so a `signal.out` wired to a delay sees the value that delay
stored in this scan, with this scan's quality.

What this means in practice:

- A connection that goes down (the hub bridge holds the last value as `uncertain`) stops every write derived
  from it, on any connection, until the connection is back, including writes from loops that it feeds.
- Startup is safe: the first scans read `signal.in`s with no sample yet, so the loops they feed are not healthy
  and nothing derived from them is written, even from a loop delay with `initial: null` that has meanwhile stored
  a substitute-built value.
- A loop recovers in the first scan in which all its outside inputs are `good` (and nothing on it is faulted):
  that scan's outputs, and the values its delays store, are `good`, and `signal.out` re-sends the current value
  (rule 3). An input that stays bad keeps every output of the loop bad for as long as it is bad.
- A delay outside any loop is a time shift, so a `bad` reading stays `bad` one scan later and is never written
  then, including a loop delay's bad value shifted through one.
- The flip side of the exception, as in a PLC: state built while an input was not `good` (a latch set by an
  `uncertain` sample, a total that integrated a bad rate, a timer that ran on one) is kept and is written once the
  loop is healthy again. Anything that must not trust such state needs explicit logic for it (e.g. reset on a
  quality edge), not the propagation rule.
- A non-null `initial` is configuration, trusted like a constant until the delay stores its first value. In a
  loop with `initial: null`, typed readers get a `bad` substitute in the first scan, which costs one scan of health.

This contract is checked by a property test (`src/quality.property.test.ts`) that runs random graphs (signals,
blocks with and without state, delays, loops, chains, faults, substitutes, random per-scan qualities) against an
independent taint simulation.

`step()` runs one scan, which makes tests deterministic with an injected `now`. `start()` / `stop()` drive scans
with `schedule`, which defaults to `setInterval`; `createManualSchedule()` from the SDK fits. `dispose()` is final.
Other methods are `setSignal(nodeId, value, quality)` for `signal.in`, `reportFault(nodeId, message | null)`,
`read(source)`, `snapshot()` and `subscribe(listener)`. Listeners run inside the scan, so `step()` from a listener
throws `FlowRunError` `BUSY`. Errors in listeners and scheduled scans go to `onError`, never into the timer.
Everything returned is frozen.

## `holodeck.flow.local`

```ts
const provider = createLocalFlowProvider({ signals, scanMs: 100 });  // capabilities: deploy, read, browse
const session = await provider.connect({ scanMs: 50 }, ctx);           // or hub.session(connectionId)
const { ok, diagnostics, sources } = await session.deploy(doc);
session.subscribe(['flow:high.out'], (samples) => render(samples));
```

`deploy(doc)` works in four steps:

1. It snapshots the document as plain data. More than 1 000 000 values or nesting deeper than 64 gives
   `INVALID_DOCUMENT`.
2. It checks the envelope. Problems give `INVALID_DOCUMENT`, an engine other than `holodeck.flow` gives
   `WRONG_ENGINE`, and an `engineVersion` outside `^1.0` gives `UNSUPPORTED_ENGINE_VERSION`.
3. It validates the body against `ctx.registry`, then checks that every `signal.in` / `signal.out` names one of the
   document's `connections` (`UNKNOWN_CONNECTION`).
4. It compiles the graph, stops the previous run, starts the new one, and runs the first scan at once.

Diagnostics use the SDK's `Diagnostic` with these codes, and `objectId` is the node id. A failed deploy changes
nothing: the previous flow keeps running. Warnings (`NO_SIGNAL_BRIDGE`, `SIGNAL_SUBSCRIBE_FAILED`,
`DUPLICATE_SIGNAL_TARGET`) do not stop a deploy. A deploy runs synchronously inside the call. Two deploys, or a
deploy and a `close()`, therefore never interleave. If a callback made during the deploy (a status listener,
subscriber or bridge) deploys again or closes the session, the outer deploy stops and returns `SUPERSEDED`.

- **Sources** are `flow:<nodeId>.<port>` for every output, and `flow:<nodeId>.$fault` for every node. Port names
  never contain a dot, so splitting at the last dot recovers the node id.
- **subscribe** delivers current values immediately and again after every deploy, then the changed values after
  each scan. A source the running flow does not publish reads `null` with quality `bad`.
- **browse()** lists the nodes. **browse(nodeId)** lists that node's outputs and `$fault`.
- **status** is `live` (`no flow deployed`, or `running "<name>"`), then `disconnected` after `close()`.
- **close()** stops the run and every bridge subscription, and disposes a bridge that the session created itself.
  Aborting `ctx.signal` closes the session too.
- **Config** is `{ scanMs? }`, an integer from 10 to 3 600 000. Unknown fields are refused.
- **Provider options** are `signals`, `scanMs`, `schedule`, `now`, `writeRetryMs` and `writeTimeoutMs`. Both
  `createLocalFlowProvider(options)` and `createFlowRuntimePackage(options)` read them once, so later edits to the
  object change nothing.
- **Logging** goes through `ctx.log`. A logger that throws is ignored and never breaks a scan, deploy or close.

Block definitions are captured when you deploy. Installing or uninstalling a block package does not change a
running flow until the next deploy.

### Signals and bridges

```ts
interface SignalBridge {
  subscribe(connection: string, source: string, onSample: (sample: Sample) => void): () => void;
  write(connection: string, source: string, value: SignalValue): Promise<void>;
}
```

`createHubSignalBridge(hub)` uses the sessions that a `ProviderHub` already holds for the document's connections,
so a flow and the diagram next to it share one session per connection. It handles connections coming and going:

- When the hub replaces a session (because the config changed, the provider was installed or reinstalled, or the
  connection was re-added), the bridge moves the subscription to the new session.
- **While a connection is down** (no session, or a status of `connecting`, `disconnected` or `error`), `signal.in`
  holds its last value with quality `uncertain`. Writes reject with `ProviderHubError` `NOT_CONNECTED`. The
  `signal.out` node is faulted and retries its latest value at most once per `writeRetryMs` (default 1 s). A
  write with no answer after `writeTimeoutMs` (default 10 s) counts as failed, and its late answer is ignored.
- When the connection is up again, the bridge subscribes afresh, so the provider's first delivery brings back the
  current value.
- Dispose the bridge before, or together with, the hub.

`signal.out` keeps at most one write in flight. The newest value wins, and a value equal to the last successful
write is not sent again (a hold resets this: after a hold the value is sent again, and a write still in flight
during the hold does not count as the target's value). If the value returns to the last successful write after a failed one, the fault clears
without a write, because the failed value never landed. One bridge subscription serves every `signal.in` that reads the same signal. Without a
bridge, `signal.in` reads `null`/`bad`, `signal.out` is faulted, and deploy warns `NO_SIGNAL_BRIDGE`.

The bridge depends on a document's hub, but the provider is installed per host, so a host passes a factory. The
factory is called once per `connect`, and the session disposes the bridge it returned:

```ts
let hub: ProviderHub;
await host.installPackage(FLOW_RUNTIME_PACKAGE_MANIFEST, createFlowRuntimePackage({ signals: () => createHubSignalBridge(hub) }));
hub = host.createProviderHub();
hub.setConnections(doc.connections);           // includes { id: 'run', provider: 'holodeck.flow.local' }
await hub.settled();
await hub.session('run')!.deploy!(doc);
```

`createMemorySignalBridge()` is the test double. It has `set`, `get` and a `writes` log, and its writes loop back.

## Engine helpers (for `holodeck.flow` in editor-2d-react)

This package does not register the engine. Lane F2 builds the descriptor from these exports:

```ts
const flowEngine: HolodeckEngine<FlowGraphBody> = {
  id: FLOW_ENGINE_ID,                     // 'holodeck.flow'
  label: 'Holodeck flow',
  apiVersion: FLOW_ENGINE_API_VERSION,    // '1.0.0'
  documentFormat: flowGraphFormat,        // 'holodeck.flow.graph.v1'
  kinds: [FLOW_BLOCK_KIND, flowNodeTypeKind, flowEdgeTypeKind, flowPaletteKind /* , flow theme */],
  validateBody: (body) => validateFlowBody(body),
  collectBindings: (body) => collectFlowBindings(body),
};
```

- `validateFlowBody(body, registry?)` returns error messages. Without a registry it checks structure, ids, wires,
  multiple drivers, delay-free cycles and the built-in blocks, but it does not look up other blocks. With a
  registry it checks everything.
- `collectFlowBindings(body)`: flow documents bind to other providers through blocks, not object params. Every
  complete `signal.in` / `signal.out` node yields `{ objectId: nodeId, param: 'value', binding: { connection, source } }`.
  - A `ProviderHub` then opens and subscribes those connections, so the editor can show each signal's live value
    on its node.
  - `validateBindings(doc, refs)` reports connections that are missing from the document.
  - `hub.write(nodeId, 'value', v)` forces a target by hand.
  - The flow's own outputs (`flow:…`) are not bindings, because they belong to the deploy connection, which the
    body does not name. To show live values on wires, bind to them on that connection or subscribe to its session.

## Package

`holodeck.package.json` declares id `holodeck.flow-runtime`, contributes `holodeck.flow.block` and
`holodeck.provider`, targets `engines: { "holodeck.flow": "^1.0" }`, and lists `providers: ["holodeck.flow.local"]`.
The entry is `dist/holodeck-package.js`, which is also importable as `@holodeck/flow-runtime/holodeck-package` and
re-exported from the main entry.

The package is **ESM only** (`"type": "module"`, an `import`-only exports map). A CommonJS build would load a
second module instance, with its own built-in blocks, next to the ESM one (holodeck#60). The code has no
top-level await, so Node's `require(esm)` of a file path, such as `require('…/dist/index.js')`, still works. Before a host registers the `holodeck.flow` engine, the blocks wait as `pending`.
The provider works regardless, because it resolves the built-in blocks itself.

## Limits

| Limit | Value |
|---|---|
| Nodes / wires per graph | 10 000 / 20 000 (work per scan is bounded by these) |
| Id length; label length; string params | 128; 256; 4096 characters |
| Params per node; ports per side and params per block | 64; 64 |
| Variadic instances | 64 |
| String values on ports | 64 KiB |
| Block state | 10 000 values, depth 32 |
| Problems listed | 1000 |
| Scan period | 10 ms – 1 h (default 100 ms) |

The runtime cannot pre-empt a block. An `evaluate` that loops forever blocks the realm it runs in.

## Checks

```sh
pnpm install --frozen-lockfile
pnpm type-check
pnpm exec vitest run
pnpm build && pnpm smoke     # dist import (ESM + CJS) and Holodeck package entry install + deploy
```
