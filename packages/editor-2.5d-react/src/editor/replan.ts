/**
 * Replace one pipe run with a fresh route. Pure; shared by "Reroute" (R) and
 * by pipes following a dragged part (follow.ts), so the two can never
 * disagree about inline parts, retained branches, locked layers or the
 * fields a replacement inherits. Design notes: docs/routing.md.
 */
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPipeAttach } from '../objects/validate';
import type { IsoPartDefinition } from '../registry/types';
import { attachRecord, withPipeAttach } from '../routing/attach';
import type { RouteOptions } from '../routing/astar';
import { headingOf, pipeArmsAt } from '../routing/elbows';
import { rotateOffset, type GridPoint, type Heading } from '../routing/grid';
import {
  carryHostedParts,
  chainFrom,
  findHostPipe,
  hostPipeOf,
  inlineBodyLength,
  isPipePlacement,
  positionOnPipe,
  segOf,
  splitChainAtParts,
  type PipeSeg,
} from '../routing/inline';
import { resolveRouteEnd } from '../routing/ports';
import { isInlinePart, isPipeRider, type PipeRun } from '../routing/run';
import { collapsePath } from '../routing/to-placements';
import { entryNode, routeToPlacements } from './routing';
import { sameCell } from './snap';

export const REROUTE_FAILED_NOTICE = 'Could not reroute — original run kept';
/** Rerouting is atomic when the carried parts cannot fit on the new run. */
export const INLINE_PARTS_NO_ROUTE_NOTICE = 'No clear route — inline parts do not fit';
/** Reroute refused because part of the run (or a part on it) is on a locked or hidden layer. */
export const REROUTE_LOCKED_NOTICE = 'Reroute rejected — part of the run is on a locked or hidden layer';
export const RETAINED_CONNECTIONS_NO_ROUTE_NOTICE = 'Reroute rejected — could not verify retained connections';

/**
 * A run end given by the caller instead of resolved from the scene (follow:
 * the moved port, and the far end exactly as it was). `point` is exact and
 * may be off-grid; the route joins it with a straight stub (`entryNode`).
 */
export interface RunEndSpec {
  point: GridPoint;
  /** Outward direction from the end into the run (port `dir`, or the old pipe's direction). */
  heading?: Heading;
  /** Attachment to record on the new terminal pipe end (absent = none). */
  attach?: IsoPipeAttach;
}

export interface ReplanOptions {
  /** Placements the user may change (unlocked, visible layers). */
  editable: (o: IsoPlacement) => boolean;
  /** Override the run's resolved ends (both given = follow). */
  ends?: { start: RunEndSpec; end: RunEndSpec };
  /**
   * Follow mode: replacements reuse the run's pipe / elbow ids in run order
   * (hosts bind tags and flow animation to them), keep their own fields, and
   * take the run's place in scene order instead of moving to the end.
   */
  keepIds?: boolean;
  /**
   * Treat single-node parts lying strictly inside a run pipe as hosted even
   * without `onPipe` (hand-authored scenes, e.g. core's brewery valves).
   */
  inferHosted?: boolean;
  /** Any manhattan-L fallback fails (follow never commits an unverified route). */
  strict?: boolean;
  route?: RouteOptions;
  nextId: (prefix: string, objects: readonly IsoPlacement[]) => string;
}

export type ReplanResult =
  | { ok: true; objects: IsoPlacement[]; firstId: string | null }
  | { ok: false; reason: 'locked' | 'no-route' | 'inline' | 'retained'; notice: string };

const fail = (reason: Exclude<ReplanResult, { ok: true }>['reason'], notice: string): ReplanResult => ({ ok: false, reason, notice });

export function replanRun(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  run: PipeRun,
  opts: ReplanOptions,
): ReplanResult {
  const startPoint = opts.ends?.start.point ?? run.start;
  const endPoint = opts.ends?.end.point ?? run.end;
  if (sameCell(startPoint, endPoint)) return fail('no-route', REROUTE_FAILED_NOTICE); // closed loop: no replacement
  const ids = new Set(run.ids);
  // Inline parts drawn on the run's pipes (holodeck#22) ride along unless a
  // retained pipe pins them in place. Movable parts are excluded as obstacles
  // and re-seated near the same fraction, with room for every carried body.
  const runPipes = objects.filter((o) => ids.has(o.id) && isPipePlacement(o));
  const hosted = hostedOnRun(objects, registry, ids, opts.inferHosted === true);
  const hostedIds = new Set(hosted.map((o) => o.id));
  // holodeck#122: a reroute replaces every run member and rewrites the parts
  // hosted on it. If any of them is on a locked or hidden layer, refuse rather
  // than silently replacing it with an unlocked, visible copy.
  if (objects.some((o) => (ids.has(o.id) || hostedIds.has(o.id)) && !opts.editable(o))) {
    return fail('locked', REROUTE_LOCKED_NOTICE);
  }
  const retainedPipes = objects.filter((o) => !ids.has(o.id) && isPipePlacement(o));
  // An onPipe attachment does not imply that this is the part's only
  // connection. Retained branches (including a second pipe passing through
  // the part) pin it in place; split the old chain there before routing.
  // Check the centre AND every declared port in world space. Keep exact
  // offsets: rounding a half-cell port would miss its retained branch.
  const fixed = hosted.filter((part) => {
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, part.object);
    const connections = [part, ...Object.values(def?.ports ?? {}).map((port) => {
      const off = rotateOffset(port.x, port.y, part.rotation);
      return { x: part.x + off.x, y: part.y + off.y };
    })];
    return connections.some((point) => pipeArmsAt(retainedPipes, point).length > 0
      || retainedPipes.some((pipe) => positionOnPipe(segOf(pipe), point.x, point.y) !== null));
  });
  const fixedIds = new Set(fixed.map((o) => o.id));
  const movable = hosted.filter((o) => !fixedIds.has(o.id));
  const movableIds = new Set(movable.map((o) => o.id));
  const rest = objects.filter((o) => !ids.has(o.id) && !movableIds.has(o.id)).map((o) => {
    if (!fixedIds.has(o.id)) return o;
    // The fixed part becomes a joint between new pipes, rather than being
    // hosted strictly inside one. Do not leave an attachment to the old ID.
    const { onPipe: _onPipe, at: _at, ...joint } = o;
    return joint;
  });
  const chain = chainFrom(runPipes.map(segOf), run.start);
  // splitChainAtParts reads `onPipe`, so give it the (possibly inferred) hosts.
  const sections = splitChainAtParts(chain, fixed);
  const band = objects.find((o) => o.id === run.ids[0])?.band;
  // Obstacle exclusion must not release IDs belonging to carried parts. With
  // keepIds the run's own ids stay reserved too: they are handed back below.
  const reservedObjects = opts.keepIds ? [...objects] : objects.filter((o) => !ids.has(o.id));
  const placements: IsoPlacement[] = [];
  const carried: IsoPlacement[] = [];
  const bodyLength = (part: IsoPlacement) =>
    inlineBodyLength(registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, part.object), part);
  for (const [i, section] of sections.entries()) {
    const first = section[0]!;
    const last = section[section.length - 1]!;
    const without = { objects: [...rest, ...placements] };
    // Outward headings of the ORIGINAL run at this section's two ends.
    const firstOut = headingOf(first.to.x - first.from.x, first.to.y - first.from.y) ?? undefined;
    const lastOut = headingOf(last.from.x - last.to.x, last.from.y - last.to.y) ?? undefined;
    const stubs: { start?: GridPoint; end?: GridPoint } = {};
    let from: { cell: GridPoint; heading?: Heading };
    let to: { cell: GridPoint; heading?: Heading };
    const spec = (s: RunEndSpec): { cell: GridPoint; heading?: Heading; stub?: GridPoint } | null => {
      const node = entryNode(s.point, s.heading);
      if (!node) return null;
      return { cell: node, heading: s.heading, stub: sameCell(node, s.point) ? undefined : s.point };
    };
    if (i === 0 && opts.ends) {
      const s = spec(opts.ends.start);
      if (!s) return fail('no-route', REROUTE_FAILED_NOTICE);
      from = { cell: s.cell, heading: s.heading };
      stubs.start = s.stub;
    } else if (i === 0) {
      // `prefer` disambiguates coincident declared ports (holodeck#47): a part
      // with east and west ports both at its centre keeps the side the run used.
      from = resolveRouteEnd(without, registry, run.start, { prefer: firstOut });
      from.heading ??= run.startHeading;
    } else {
      from = { cell: first.from, heading: firstOut };
    }
    const lastSection = i === sections.length - 1;
    if (lastSection && opts.ends) {
      const s = spec(opts.ends.end);
      if (!s) return fail('no-route', REROUTE_FAILED_NOTICE);
      to = { cell: s.cell, heading: s.heading };
      stubs.end = s.stub;
    } else if (lastSection) {
      to = resolveRouteEnd(without, registry, run.end, { prefer: lastOut });
      to.heading ??= run.endHeading;
    } else {
      to = { cell: last.to, heading: lastOut };
    }
    const route = routeToPlacements(without, registry, from, to, opts.nextId, {
      band, reservedObjects: [...reservedObjects, ...placements], route: opts.route,
      stubs: stubs.start || stubs.end ? stubs : undefined,
    });
    // Both blocked and off-grid fallbacks skip heading/obstacle guarantees:
    // half-cell endpoints set fallback=true but noRoute=false. Conservatively
    // reject them for fixed sections and retained endpoint ports/flanges;
    // staged placements must never partially replace the original run.
    if (route.placements.length === 0) return fail('no-route', REROUTE_FAILED_NOTICE);
    if (route.fallback && (opts.strict || fixed.length > 0 || from.heading !== undefined || to.heading !== undefined)) {
      return fail('retained', RETAINED_CONNECTIONS_NO_ROUTE_NOTICE);
    }
    // Every turn of a route must be a real 90 degree elbow (stubs can meet the
    // search head-on when two ends nearly touch; never commit a U-turn).
    const pipesOut = route.placements.filter(isPipePlacement);
    if (pipesOut.length - 1 !== route.placements.length - pipesOut.length) return fail('no-route', REROUTE_FAILED_NOTICE);
    // Per-part body lengths (holodeck#54): retained endpoint parts and carried
    // parts each reserve their own inline length, not the built-in valve's.
    const endpointLength = (cell: GridPoint) => Math.max(0, ...rest
      .filter((o) => sameCell(o, cell) && isInlinePart(o, registry))
      .map(bodyLength));
    const carry = (snap: boolean) => carryHostedParts(
      movable.filter((part) => section.some((seg) => seg.id === part.onPipe && positionOnPipe(seg, part.x, part.y) !== null)),
      section,
      pipesOut.map(segOf),
      { start: endpointLength(stubs.start ?? from.cell), end: endpointLength(stubs.end ?? to.cell) },
      // Snap: land carried parts where a click can hit them, so a branch
      // drawn to one connects and pins it on the next reroute (holodeck#53).
      { bodyLength, snap },
    );
    // Follow (strict) prefers a clickable spot but would rather keep a dense
    // run (brewery: valve + 2-cell pump + valve on 5.8 cells) than refuse the
    // move; Reroute keeps the snapped-only behaviour (holodeck#206 tracks it).
    const parts = carry(true) ?? (opts.strict ? carry(false) : null);
    // A failed plan (even one offering an obstructed L) must not replace a
    // working run; invalid resolved ports can also produce no geometry.
    if (route.noRoute) return fail('no-route', REROUTE_FAILED_NOTICE);
    if (parts === null) return fail('inline', INLINE_PARTS_NO_ROUTE_NOTICE);
    placements.push(...route.placements);
    carried.push(...parts);
  }
  if (carried.length !== movable.length) return fail('inline', INLINE_PARTS_NO_ROUTE_NOTICE);
  const originals = objects.filter((o) => ids.has(o.id));
  let replacements = inheritRunFields(placements, originals);
  let carriedOut = carried;
  if (opts.keepIds) {
    const adopted = adoptRunIds(replacements, originals, chain);
    replacements = adopted.placements;
    carriedOut = carried.map((p) => (p.onPipe && adopted.rename.has(p.onPipe) ? { ...p, onPipe: adopted.rename.get(p.onPipe)! } : p));
  }
  // Follow records the ends it was given; Reroute keeps whatever explicit
  // records the old terminal pipes had (geometry re-validates them anyway).
  replacements = attachTerminals(
    replacements,
    opts.ends?.start.attach ?? terminalAttach(runPipes, run.start),
    opts.ends?.end.attach ?? terminalAttach(runPipes, run.end),
  );
  const firstId = replacements[0]?.id ?? null;
  if (!opts.keepIds) return { ok: true, objects: [...rest, ...replacements, ...carriedOut], firstId };
  return { ok: true, objects: spliceRun(objects, rest, ids, replacements, carriedOut), firstId };
}

/**
 * Parts riding on the run's pipes: a valid `onPipe` to a run pipe, or (with
 * `infer`) a pipe rider lying strictly inside one with no valid `onPipe`
 * (`isPipeRider`). Inferred ones come back with `onPipe` / `at` filled in.
 */
export function hostedOnRun(
  objects: readonly IsoPlacement[],
  registry: ContributionRegistry,
  runIds: ReadonlySet<string>,
  infer: boolean,
): IsoPlacement[] {
  const runPipes = objects.filter((o) => runIds.has(o.id) && isPipePlacement(o));
  const out: IsoPlacement[] = [];
  for (const o of objects) {
    if (runIds.has(o.id)) continue;
    const host = hostPipeOf(o, objects);
    if (host !== null) {
      if (runIds.has(host.id)) out.push(o);
      continue;
    }
    if (!infer) continue;
    const found = findHostPipe(runPipes, o.x, o.y);
    const seg = found ? runPipes.find((p) => p.id === found.onPipe) : undefined;
    if (found && seg && isPipeRider(o, registry, segOf(seg))) out.push({ ...o, ...found });
  }
  return out;
}

/**
 * Follow mode keeps scene order: the replacements take the slot of the first
 * run member, carried parts stay where they were. Draw-order ties and the
 * "later placement wins" port lookup then do not shuffle on every drag frame.
 */
function spliceRun(
  objects: readonly IsoPlacement[],
  rest: readonly IsoPlacement[],
  runIds: ReadonlySet<string>,
  replacements: readonly IsoPlacement[],
  carried: readonly IsoPlacement[],
): IsoPlacement[] {
  const restById = new Map(rest.map((o) => [o.id, o]));
  const carriedById = new Map(carried.map((o) => [o.id, o]));
  const out: IsoPlacement[] = [];
  let placed = false;
  for (const o of objects) {
    if (runIds.has(o.id)) {
      if (!placed) out.push(...replacements);
      placed = true;
      continue;
    }
    out.push(carriedById.get(o.id) ?? restById.get(o.id) ?? o);
  }
  if (!placed) out.push(...replacements);
  return out;
}

/** Set the new run's terminal pipe ends to the given attachments (the first pipe's x,y; the last pipe's toX,toY). */
function attachTerminals(placements: IsoPlacement[], start: IsoPipeAttach | undefined, end: IsoPipeAttach | undefined): IsoPlacement[] {
  const pipes = placements.filter(isPipePlacement);
  const first = pipes[0];
  const last = pipes[pipes.length - 1];
  if (!first || !last) return placements;
  return placements.map((p) => {
    let next = p;
    if (p.id === first.id) next = withPipeAttach(next, 'from', start ? attachRecord(start) : null);
    if (p.id === last.id) next = withPipeAttach(next, 'to', end ? attachRecord(end) : null);
    return next;
  });
}

/** The explicit record on whichever run pipe end lies at `point`. */
function terminalAttach(runPipes: readonly IsoPlacement[], point: GridPoint): IsoPipeAttach | undefined {
  for (const p of runPipes) {
    if (p.x === point.x && p.y === point.y && p.attach?.from) return p.attach.from;
    if (p.toX === point.x && p.toY === point.y && p.attach?.to) return p.attach.to;
  }
  return undefined;
}

/**
 * Give the replacement pipes / elbows the old run's ids, in run order (the
 * chain from the run start; elbows by the order of their joint along it).
 * A replacement with a reused id keeps that placement's own fields (band,
 * bindings, meta...); extra segments keep the template `inheritRunFields`
 * gave them; surplus old ids disappear with their placements. `rename` maps
 * the freshly allocated ids to the adopted ones (carried parts' `onPipe`).
 */
export function adoptRunIds(
  replacements: readonly IsoPlacement[],
  originals: readonly IsoPlacement[],
  chain: readonly PipeSeg[],
): { placements: IsoPlacement[]; rename: Map<string, string> } {
  const byId = new Map(originals.map((o) => [o.id, o]));
  const pipeIds = [...new Set(chain.map((s) => s.id))];
  // Joints in chain order: where seg i meets seg i+1.
  const jointOrder = new Map<string, number>();
  chain.forEach((s, i) => jointOrder.set(`${s.to.x},${s.to.y}`, i));
  const elbowIds = originals
    .filter((o) => o.object === 'elbow')
    .sort((a, b) => (jointOrder.get(`${a.x},${a.y}`) ?? Infinity) - (jointOrder.get(`${b.x},${b.y}`) ?? Infinity))
    .map((o) => o.id);
  const queues: Record<string, string[]> = { pipe: [...pipeIds], elbow: [...elbowIds] };
  const rename = new Map<string, string>();
  const placements = replacements.map((r) => {
    const id = queues[r.object]?.shift();
    if (!id) return r;
    rename.set(r.id, id);
    const own = byId.get(id)!;
    const mine: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(own)) if (!ROUTE_OWNED_FIELDS.has(k)) mine[k] = structuredClone(v);
    // Identity bags of this placement only (never the merged ones inheritRunFields put on the first segment).
    const next: Record<string, unknown> = { ...r };
    for (const field of ROUTE_IDENTITY_FIELDS) delete next[field];
    return { ...next, ...mine, id } as unknown as IsoPlacement;
  });
  return { placements, rename };
}

/** Fields a reroute recomputes; everything else on the old run belongs to the user and must survive. */
export const ROUTE_OWNED_FIELDS = new Set(['id', 'object', 'x', 'y', 'toX', 'toY', 'rotation', 'onPipe', 'at', 'link', 'attach']);
/**
 * Per-object data bags. Copying them onto every new segment would duplicate
 * metadata planes and live bindings, so they are merged (in run order) onto
 * the FIRST replacement of that kind instead.
 */
const ROUTE_IDENTITY_FIELDS = ['meta', 'metaHidden', 'bindings', 'extensions', 'animation'] as const;
/** Assignment fields an elbow takes from the run's pipes when the old run had no elbow. */
const ROUTE_SHARED_FIELDS = ['layer', 'group', 'opacity', 'z'] as const;

/**
 * Carry the old run's user fields onto its replacement (PR #114 review: a
 * reroute used to drop `layer` / `group`, silently moving pipes back to the
 * default layer and out of their groups). Each new pipe / elbow takes every
 * non-route field of the first old placement of the same part (`band`,
 * `params`, `layer`, `group`, `opacity`, `z`...); identity bags go to the
 * first replacement only; elbows with no old elbow take the pipes' layer,
 * group, opacity and z.
 */
export function inheritRunFields(replacements: readonly IsoPlacement[], originals: readonly IsoPlacement[]): IsoPlacement[] {
  const template = (kind: string): Record<string, unknown> | null => {
    const first = originals.find((o) => o.object === kind);
    if (!first) return null;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first)) {
      if (!ROUTE_OWNED_FIELDS.has(k) && !(ROUTE_IDENTITY_FIELDS as readonly string[]).includes(k)) out[k] = structuredClone(v);
    }
    return out;
  };
  const pipeTemplate = template('pipe');
  const templates = new Map<string, Record<string, unknown> | null>();
  const templateFor = (kind: string) => {
    if (!templates.has(kind)) {
      let t = template(kind);
      if (!t && pipeTemplate) {
        t = {};
        for (const k of ROUTE_SHARED_FIELDS) if (pipeTemplate[k] !== undefined) t[k] = pipeTemplate[k];
      }
      templates.set(kind, t);
    }
    return templates.get(kind) ?? null;
  };
  const seenKind = new Set<string>();
  return replacements.map((r) => {
    const t = templateFor(r.object);
    const next: Record<string, unknown> = t ? { ...t, ...r } : { ...r };
    // Values the router set (band from the run) win over the template except where it left them undefined.
    for (const [k, v] of Object.entries(t ?? {})) if (next[k] === undefined) next[k] = v;
    if (!seenKind.has(r.object)) {
      seenKind.add(r.object);
      for (const field of ROUTE_IDENTITY_FIELDS) {
        const merged = originals.filter((o) => o.object === r.object && o[field] !== undefined).map((o) => o[field]);
        if (merged.length === 0) continue;
        next[field] = merged.every((m) => typeof m === 'object' && m !== null)
          ? structuredClone(Object.assign({}, ...(merged as object[])))
          : merged[merged.length - 1];
      }
    }
    return next as unknown as IsoPlacement;
  });
}

/** Collapsed vertices of a run route (for previews); exported for the unroutable ghost. */
export function ghostPipes(points: readonly GridPoint[]) {
  return collapsePath(points).pipes;
}
