/**
 * Property test for the quality safety contract (run.ts header, README
 * "Quality and the write gate") on random graphs, against an independent
 * brute-force taint simulation.
 *
 * The contract: a value is `good` (and so written by `signal.out`) only if
 * every external reading that influenced it, along any path including delays
 * and loop state, was `good` when consumed, and no node on that path faulted
 * (or substituted a missing value) since — except that a loop's *state* may
 * survive a non-good period, provided the loop has had a clean scan (all its
 * outside inputs good, nothing on it faulted) since that state was read.
 *
 * The oracle does not share code with the runtime's quality rules. It tracks,
 * per value, every *taint event* that influenced it (a non-good or null
 * `signal.in` reading at scan k, a fault of node n at scan k, a substitute,
 * an unknown `initial`) and, per event, the loops whose state it passed
 * through and when. An event is *excused* once one of those loops has had a
 * clean scan after the event was last read out of its state. Loops are found
 * by brute-force reachability (not Tarjan), and a stateful block is its own
 * one-node loop. Then, every scan:
 *   - safety: every source the runtime calls `good` (non-null), and every
 *     `signal.out` write, has only excused events;
 *   - sync: the runtime's null-ness matches the oracle's (the simulation is in step);
 *   - liveness: after a quiet stretch (all inputs good, no faults) every
 *     non-null value whose events are all excused is `good`, and every
 *     `signal.out` with such an input has written its current value.
 *
 * Parameters: FLOW_FUZZ_SEED (default fixed), FLOW_FUZZ_RUNS (graphs),
 * FLOW_FUZZ_SCANS (scans per graph). A failure prints the seed, run and graph.
 */

import type { SignalQuality } from '@holodeck/sdk';
import { describe, expect, it } from 'vitest';
import type { FlowBlockDefinition, FlowState } from './block';
import { compileFlow } from './compile';
import { createFlowRun, type FlowRun, type FlowScan } from './run';
import { graph, node, registryWith, wire } from './test-helpers';
import type { FlowValue } from './values';

const SEED = Number(process.env.FLOW_FUZZ_SEED ?? 0x5eed_f10e);
const RUNS = Number(process.env.FLOW_FUZZ_RUNS ?? 400);
const SCANS = Number(process.env.FLOW_FUZZ_SCANS ?? 60);
const SCAN_MS = 100;

/** mulberry32: tiny seeded PRNG, so every failure is reproducible from (seed, run). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generic block: two `any` inputs and one `number` input (so an `any` null
 * is substituted), output never null. `faults` lists the scans in which it
 * throws (the clock is `(scan - 1) * SCAN_MS`); `stateful` folds the previous
 * output in through block state; `broken` makes `initialState` throw.
 */
const mixBlock: FlowBlockDefinition = {
  id: 'fuzz.mix',
  label: 'Mix',
  category: 'Fuzz',
  inputs: [
    { name: 'a', type: 'any' },
    { name: 'b', type: 'any' },
    { name: 'n', type: 'number' },
  ],
  outputs: [{ name: 'out', type: 'any' }],
  params: { faults: { type: 'string', default: '' }, stateful: { type: 'bool', default: false }, broken: { type: 'bool', default: false } },
  initialState: (params) => {
    if (params.broken) throw new Error('broken');
    return params.stateful ? 0 : null;
  },
  evaluate: ({ inputs, params, state, nowMs }) => {
    const scan = nowMs / SCAN_MS + 1;
    if (String(params.faults).split(',').includes(String(scan))) throw new Error(`fault at scan ${scan}`);
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    const out = (num(inputs.a) * 3 + num(inputs.b) * 5 + num(inputs.n) * 7 + num(state) + 1) % 1009;
    return { outputs: { out }, state: (params.stateful ? out : state) as FlowState };
  },
};
const registry = registryWith([mixBlock]);

// -----------------------------------------------------------------------------
// Random graphs
// -----------------------------------------------------------------------------

type Kind = 'in' | 'mix' | 'delay' | 'out';
interface Src {
  readonly node: string;
  readonly port: string;
}
interface Input {
  readonly port: string;
  readonly typed: boolean; // a `number` input (substitutes null and unparsable strings)
  readonly from: Src;
}
interface NodeSpec {
  readonly id: string;
  readonly kind: Kind;
  readonly inputs: Input[];
  readonly stateful?: boolean;
  readonly broken?: boolean;
  readonly faults?: Set<number>;
  readonly initial?: number | null;
}
interface Spec {
  readonly nodes: NodeSpec[];
  readonly quiet: readonly [start: number, end: number];
}

const outPort: Record<Kind, string> = { in: 'value', mix: 'out', delay: 'out', out: '' };

function randomSpec(rand: () => number): Spec {
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
  const ins = Array.from({ length: int(1, 3) }, (_, i) => `in${i}`);
  const mixes = Array.from({ length: int(1, 6) }, (_, i) => `m${i}`);
  const delays = Array.from({ length: int(0, 4) || int(0, 2) }, (_, i) => `d${i}`);
  const outs = Array.from({ length: int(1, 3) }, (_, i) => `o${i}`);
  const src = (id: string, kind: Kind): Src => ({ node: id, port: outPort[kind] });
  const allSources = [...ins.map((id) => src(id, 'in')), ...mixes.map((id) => src(id, 'mix')), ...delays.map((id) => src(id, 'delay'))];
  const quietLen = ins.length + mixes.length + delays.length + 3;
  const quietStart = int(Math.floor(SCANS / 4), Math.max(Math.floor(SCANS / 4), SCANS - quietLen - 1));
  const quiet = [quietStart, quietStart + quietLen - 1] as const;
  const nodes: NodeSpec[] = [];
  for (const id of ins) nodes.push({ id, kind: 'in', inputs: [] });
  mixes.forEach((id, j) => {
    // Main-phase sources only from earlier mixes, so the only cycles go through delays (or state).
    const candidates = [...ins.map((s) => src(s, 'in')), ...mixes.slice(0, j).map((s) => src(s, 'mix')), ...delays.map((s) => src(s, 'delay'))];
    const inputs: Input[] = [];
    if (rand() > 0.1) inputs.push({ port: 'a', typed: false, from: pick(candidates) });
    if (rand() > 0.3) inputs.push({ port: 'b', typed: false, from: pick(candidates) });
    if (rand() > 0.5) inputs.push({ port: 'n', typed: true, from: pick(candidates) });
    const faults = new Set<number>();
    for (let s = 1; s <= SCANS; s++) if (rand() < 0.04 && (s < quiet[0] || s > quiet[1])) faults.add(s);
    nodes.push({ id, kind: 'mix', inputs, stateful: rand() < 0.3, broken: rand() < 0.03, faults });
  });
  for (const id of delays) {
    // An unwired delay holds `null` with good quality (a constant): typed readers must still get `bad`.
    const inputs = rand() < 0.1 ? [] : [{ port: 'in', typed: false, from: pick(allSources) }];
    nodes.push({ id, kind: 'delay', inputs, initial: rand() < 0.4 ? null : int(0, 9) });
  }
  for (const id of outs) nodes.push({ id, kind: 'out', inputs: [{ port: 'value', typed: false, from: pick(allSources) }] });
  return { nodes, quiet };
}

function bodyOf(spec: Spec, rand: () => number): unknown {
  // Shuffle document order: evaluation order must not depend on it.
  const shuffled = [...spec.nodes];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const nodes = shuffled.map((n) => {
    switch (n.kind) {
      case 'in':
        return node(n.id, 'signal.in', { connection: 'c', source: n.id });
      case 'out':
        return node(n.id, 'signal.out', { connection: 'c', source: n.id });
      case 'delay':
        return node(n.id, 'flow.delay', n.initial === null ? {} : { initial: n.initial! });
      case 'mix':
        return node(n.id, 'fuzz.mix', { faults: [...n.faults!].join(','), stateful: n.stateful!, broken: n.broken! });
    }
  });
  const wires = spec.nodes.flatMap((n) => n.inputs.map((i) => wire(`${n.id}.${i.port}`, `${i.from.node}.${i.from.port}`, `${n.id}.${i.port}`)));
  return graph(nodes, wires);
}

// -----------------------------------------------------------------------------
// Oracle: brute-force taint simulation
// -----------------------------------------------------------------------------

/** A taint event and, per loop it was read out of the state of, the last scan that state was stored. */
interface Entry {
  readonly ev: string;
  readonly latch: ReadonlyMap<string, number>;
}
type Taint = Map<string, Entry>;
interface Slot {
  nul: boolean;
  /** A string that does not parse as a number (a `number` input substitutes 0). */
  junk: boolean;
  taint: Taint;
}

const isJunk = (v: FlowValue) => typeof v === 'string' && (v.trim() === '' || !Number.isFinite(Number(v)));

const keyOf = (e: Entry) => `${e.ev}#${[...e.latch.keys()].sort().join(',')}`;

function addTo(into: Taint, from: Iterable<Entry>, latchLoop?: string, latchScan?: number): void {
  for (const e of from) {
    let latch = e.latch;
    if (latchLoop !== undefined) {
      const next = new Map(latch);
      next.set(latchLoop, Math.max(next.get(latchLoop) ?? -1, latchScan!));
      latch = next;
    }
    const entry = { ev: e.ev, latch };
    const key = keyOf(entry);
    const old = into.get(key);
    if (!old) into.set(key, entry);
    else {
      // Same event through the same loops: keep the *latest* storage per loop (the strictest).
      const merged = new Map(old.latch);
      for (const [l, j] of latch) merged.set(l, Math.max(merged.get(l) ?? -1, j));
      into.set(key, { ev: e.ev, latch: merged });
    }
  }
}

const fresh = (ev: string): Entry => ({ ev, latch: new Map() });

class Oracle {
  readonly slots = new Map<string, Slot>();
  /** Loop id per node (`L:` + members), from mutual reachability. */
  readonly loopOf = new Map<string, string>();
  /** Graph loops and stateful blocks' own loops, upstream first. */
  readonly loopOrder: string[] = [];
  readonly lastClean = new Map<string, number>();
  /** Per node: the graph loops it is on or downstream of. */
  readonly upstreamLoops = new Map<string, Set<string>>();
  private readonly byId: Map<string, NodeSpec>;
  private state = new Map<string, Taint>();
  private ext = new Set<string>();
  private signal = new Map<string, { value: FlowValue; quality: SignalQuality }>();
  // Per scan, per loop: a local problem, and the taints read from outside the loop.
  private localBad = new Set<string>();
  private outside = new Map<string, Taint[]>();

  constructor(readonly spec: Spec) {
    this.byId = new Map(spec.nodes.map((n) => [n.id, n]));
    const ids = spec.nodes.map((n) => n.id);
    const succ = new Map(ids.map((id) => [id, new Set<string>()]));
    for (const n of spec.nodes) for (const i of n.inputs) succ.get(i.from.node)!.add(n.id);
    const reach = new Map<string, Set<string>>();
    for (const id of ids) {
      const seen = new Set<string>();
      const stack = [...succ.get(id)!];
      while (stack.length) {
        const x = stack.pop()!;
        if (seen.has(x)) continue;
        seen.add(x);
        stack.push(...succ.get(x)!);
      }
      reach.set(id, seen);
    }
    const ancestors = (id: string) => ids.filter((x) => reach.get(x)!.has(id)).length;
    const loops = new Map<string, number>();
    for (const id of ids) {
      if (!reach.get(id)!.has(id)) continue;
      const members = ids.filter((x) => reach.get(id)!.has(x) && reach.get(x)!.has(id)).sort();
      const loop = `L:${members.join(',')}`;
      this.loopOf.set(id, loop);
      loops.set(loop, ancestors(id) * 2);
    }
    for (const n of spec.nodes) if (n.kind === 'mix' && n.stateful) loops.set(`S:${n.id}`, ancestors(n.id) * 2 + 1);
    for (const id of ids) {
      const upstream = new Set<string>();
      for (const [member, loop] of this.loopOf) if (member === id || reach.get(member)!.has(id)) upstream.add(loop);
      this.upstreamLoops.set(id, upstream);
    }
    this.loopOrder = [...loops.keys()].sort((a, b) => loops.get(a)! - loops.get(b)!);

    for (const n of spec.nodes) {
      if (n.kind === 'in') this.slots.set(`${n.id}.value`, { nul: true, junk: false, taint: new Map() });
      if (n.kind === 'mix') this.slots.set(`${n.id}.out`, { nul: true, junk: false, taint: new Map() });
      if (n.kind === 'delay') {
        const taint: Taint = new Map();
        if (n.initial === null) addTo(taint, [fresh(`init:${n.id}`)]);
        this.slots.set(`${n.id}.out`, { nul: n.initial === null, junk: false, taint });
      }
      if (n.kind === 'mix' && n.stateful) this.state.set(n.id, new Map());
    }
  }

  setSignal(id: string, value: FlowValue, quality: SignalQuality): void {
    this.signal.set(id, { value, quality });
  }

  toggleFault(id: string): void {
    if (this.ext.has(id)) this.ext.delete(id);
    else this.ext.add(id);
  }

  hasFault(id: string): boolean {
    return this.ext.has(id);
  }

  clearFaults(): void {
    this.ext.clear();
  }

  /** The loops `reader` belongs to, for the clean-scan bookkeeping. */
  private loopsOf(reader: NodeSpec): string[] {
    const loops: string[] = [];
    const loop = this.loopOf.get(reader.id);
    if (loop) loops.push(loop);
    if (reader.kind === 'mix' && reader.stateful) loops.push(`S:${reader.id}`);
    return loops;
  }

  private bad(reader: NodeSpec): void {
    for (const l of this.loopsOf(reader)) this.localBad.add(l);
  }

  /** Read an input at scan `w`, latching events that come out of the reader's loop state. */
  private read(reader: NodeSpec, input: Input, w: number, into: Taint): Slot {
    const slot = this.slots.get(`${input.from.node}.${input.from.port}`)!;
    const producer = this.byId.get(input.from.node)!;
    const loop = this.loopOf.get(reader.id);
    const internal = loop !== undefined && this.loopOf.get(producer.id) === loop;
    const reading: Taint = new Map();
    if (internal && producer.kind === 'delay') addTo(reading, slot.taint.values(), loop, w - 1);
    else addTo(reading, slot.taint.values());
    addTo(into, reading.values());
    if (internal) {
      if (slot.nul) this.bad(reader); // no value inside a loop
    } else if (loop) this.record(loop, reading);
    if (reader.kind === 'mix' && reader.stateful) this.record(`S:${reader.id}`, reading);
    if (input.typed && (slot.nul || slot.junk)) {
      addTo(into, [fresh(`sub:${reader.id}.${input.port}@${w}`)]);
      this.bad(reader);
    }
    return slot;
  }

  private record(loop: string, taint: Taint): void {
    let list = this.outside.get(loop);
    if (!list) this.outside.set(loop, (list = []));
    list.push(taint);
  }

  step(w: number): void {
    this.localBad = new Set();
    this.outside = new Map();
    for (const n of this.spec.nodes) {
      if (n.kind === 'in') {
        const sample = this.signal.get(n.id) ?? { value: null, quality: 'uncertain' as const };
        const taint: Taint = new Map();
        if (sample.value === null || sample.quality !== 'good') addTo(taint, [fresh(`in:${n.id}@${w}`)]);
        if (this.ext.has(n.id)) addTo(taint, [fresh(`ext:${n.id}@${w}`)]);
        this.slots.set(`${n.id}.value`, { nul: sample.value === null, junk: isJunk(sample.value), taint });
      }
      if (n.kind === 'mix') {
        const slot = this.slots.get(`${n.id}.out`)!;
        if (n.broken || n.faults!.has(w)) {
          const taint = new Map(slot.taint);
          addTo(taint, [fresh(`fault:${n.id}@${w}`)]);
          this.bad(n);
          this.slots.set(`${n.id}.out`, { nul: slot.nul, junk: false, taint });
          continue;
        }
        const taint: Taint = new Map();
        for (const input of n.inputs) this.read(n, input, w, taint);
        if (n.stateful) addTo(taint, this.state.get(n.id)!.values(), `S:${n.id}`, w - 1);
        if (this.ext.has(n.id)) {
          addTo(taint, [fresh(`ext:${n.id}@${w}`)]);
          this.bad(n);
        }
        this.slots.set(`${n.id}.out`, { nul: false, junk: false, taint });
        if (n.stateful) this.state.set(n.id, new Map(taint));
      }
    }
    // Delays read the main phase's values, then commit together.
    const delayed: Array<[string, Slot]> = [];
    for (const n of this.spec.nodes) {
      if (n.kind !== 'delay') continue;
      const taint: Taint = new Map();
      // Unwired: the input's default, a constant null.
      const read = n.inputs.length ? this.read(n, n.inputs[0]!, w, taint) : { nul: true, junk: false };
      if (this.ext.has(n.id)) {
        addTo(taint, [fresh(`ext:${n.id}@${w}`)]);
        this.bad(n);
      }
      delayed.push([`${n.id}.out`, { nul: read.nul, junk: read.junk, taint }]);
    }
    for (const [key, slot] of delayed) this.slots.set(key, slot);
    // Clean scans, upstream loops first (a downstream loop's readings may be excused by them).
    for (const loop of this.loopOrder) {
      const clean = !this.localBad.has(loop) && (this.outside.get(loop) ?? []).every((t) => this.isClean(t));
      if (clean) this.lastClean.set(loop, w);
    }
  }

  isClean(taint: Taint): boolean {
    for (const e of taint.values()) {
      let excused = false;
      for (const [loop, j] of e.latch) if ((this.lastClean.get(loop) ?? -1) > j) excused = true;
      if (!excused) return false;
    }
    return true;
  }

  /** Every graph loop on or upstream of `id` had a clean scan at `w` (liveness precondition). */
  loopsCleanAt(id: string, w: number): boolean {
    for (const loop of this.upstreamLoops.get(id)!) if (this.lastClean.get(loop) !== w) return false;
    return true;
  }

  unexcused(taint: Taint): string[] {
    return [...taint.values()].filter((e) => !this.isClean(new Map([['x', e]]))).map((e) => `${e.ev}[${[...e.latch].map(([l, j]) => `${l}@${j}`).join(' ')}]`);
  }
}

// -----------------------------------------------------------------------------
// The property
// -----------------------------------------------------------------------------

interface Stats {
  runs: number;
  withLoops: number;
  withStatefulLoops: number;
  goodChecked: number;
  writes: number;
  liveChecked: number;
}

/** Mostly numbers; sometimes null, a numeric string, or an unparsable one. */
function randomValue(rand: () => number): FlowValue {
  const r = rand();
  if (r < 0.1) return null;
  if (r < 0.15) return 'n/a';
  if (r < 0.2) return String(Math.floor(rand() * 20));
  return Math.floor(rand() * 20);
}

function runOne(seed: number, run: number, stats: Stats): string | undefined {
  const rand = prng(seed ^ Math.imul(run + 1, 0x9e3779b1));
  const spec = randomSpec(rand);
  const body = bodyOf(spec, rand);
  let t = 0;
  const flow: FlowRun = createFlowRun(compileFlow(body, registry), { now: () => t, scanMs: SCAN_MS });
  const oracle = new Oracle(spec);
  stats.runs++;
  if (oracle.loopOf.size) stats.withLoops++;
  if (spec.nodes.some((n) => n.stateful && oracle.loopOf.has(n.id))) stats.withStatefulLoops++;
  const ins = spec.nodes.filter((n) => n.kind === 'in');
  const outs = spec.nodes.filter((n) => n.kind === 'out');
  const sources = spec.nodes.filter((n) => n.kind !== 'out').map((n) => `${n.id}.${outPort[n.kind]}`);
  const written = new Map<string, FlowValue>();
  const where = (w: number, what: string) => `seed ${seed} run ${run} scan ${w}: ${what}\ngraph: ${JSON.stringify(body)}`;
  const set = (id: string, value: FlowValue, quality: SignalQuality) => {
    flow.setSignal(id, value, quality);
    oracle.setSignal(id, value, quality);
  };
  if (rand() < 0.5) for (const n of ins) set(n.id, Math.floor(rand() * 20), 'good');

  for (let w = 1; w <= SCANS; w++) {
    const [qStart, qEnd] = spec.quiet;
    if (w === qStart) {
      for (const n of spec.nodes) if (oracle.hasFault(n.id)) flow.reportFault(n.id, null);
      oracle.clearFaults();
      for (const n of ins) set(n.id, 1 + Math.floor(rand() * 20), 'good');
    } else if (w < qStart || w > qEnd) {
      for (const n of ins) {
        const r = rand();
        if (r < 0.35) {
          const q = rand();
          set(n.id, randomValue(rand), q < 0.6 ? 'good' : q < 0.8 ? 'uncertain' : 'bad');
        } else if (r < 0.5) {
          const q = rand();
          const current = flow.read(`flow:${n.id}.value`)?.value ?? null;
          set(n.id, current, q < 0.5 ? 'good' : q < 0.75 ? 'uncertain' : 'bad');
        }
      }
      if (rand() < 0.08) {
        const n = spec.nodes[Math.floor(rand() * spec.nodes.length)]!;
        flow.reportFault(n.id, oracle.hasFault(n.id) ? null : 'reported');
        oracle.toggleFault(n.id);
      }
    }

    const scan: FlowScan = flow.step();
    oracle.step(w);
    t += SCAN_MS;

    for (const write of scan.writes) {
      stats.writes++;
      written.set(write.node, write.value);
      const n = spec.nodes.find((x) => x.id === write.node)!;
      const from = n.inputs[0]!.from;
      const taint = oracle.slots.get(`${from.node}.${from.port}`)!.taint;
      if (!oracle.isClean(taint)) return where(w, `${write.node} wrote ${String(write.value)} from ${from.node}, tainted by ${oracle.unexcused(taint).join(', ')}`);
    }
    for (const source of sources) {
      const reading = flow.read(`flow:${source}`)!;
      const slot = oracle.slots.get(source)!;
      if ((reading.value === null) !== slot.nul) return where(w, `${source}: runtime value ${String(reading.value)}, oracle null=${slot.nul} (simulation out of step)`);
      if (reading.quality === 'good' && reading.value !== null) {
        stats.goodChecked++;
        if (!oracle.isClean(slot.taint)) return where(w, `${source} is good but tainted by ${oracle.unexcused(slot.taint).join(', ')}`);
      }
    }
    if (w === qEnd) {
      // Liveness is only owed where every loop upstream is healthy: a loop that never has a clean
      // scan (e.g. a ring of delays circulating a null) holds everything read from it, by design.
      const live = (id: string, slot: Slot) => !slot.nul && oracle.isClean(slot.taint) && oracle.loopsCleanAt(id, w);
      for (const source of sources) {
        const slot = oracle.slots.get(source)!;
        if (!live(source.slice(0, source.indexOf('.')), slot)) continue;
        stats.liveChecked++;
        const quality = flow.read(`flow:${source}`)!.quality;
        if (quality !== 'good') return where(w, `liveness: ${source} is clean after a quiet stretch but ${quality}`);
      }
      for (const n of outs) {
        const from = n.inputs[0]!.from;
        const slot = oracle.slots.get(`${from.node}.${from.port}`)!;
        if (!live(from.node, slot)) continue;
        const current = flow.read(`flow:${from.node}.${from.port}`)!.value;
        if (written.get(n.id) !== current) return where(w, `liveness: ${n.id} has not written the clean value ${String(current)}`);
      }
    }
  }
  return undefined;
}

describe('quality safety contract (property test against a taint oracle)', () => {
  it(`holds on ${RUNS} random graphs × ${SCANS} scans (seed ${SEED})`, () => {
    const stats: Stats = { runs: 0, withLoops: 0, withStatefulLoops: 0, goodChecked: 0, writes: 0, liveChecked: 0 };
    for (let run = 0; run < RUNS; run++) {
      const failure = runOne(SEED, run, stats);
      expect(failure, failure).toBeUndefined();
    }
    // The generator must actually exercise loops, writes and recovery, or the property is vacuous.
    expect(stats.withLoops).toBeGreaterThan(RUNS * 0.3);
    expect(stats.withStatefulLoops).toBeGreaterThan(RUNS * 0.05);
    expect(stats.writes).toBeGreaterThan(RUNS * 5);
    expect(stats.liveChecked).toBeGreaterThan(RUNS * 2);
    expect(stats.goodChecked).toBeGreaterThan(RUNS * SCANS * 0.5);
    if (process.env.FLOW_FUZZ_STATS) console.log(JSON.stringify({ seed: SEED, scans: SCANS, ...stats }));
  }, 120_000);
});
