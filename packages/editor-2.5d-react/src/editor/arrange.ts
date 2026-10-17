/**
 * Geometry for multi-object edits (lane E3, holodeck#37): move, align,
 * distribute and rotate a selection. Pure; the reducer turns each call into
 * one undo step.
 *
 * Alignment works in GRID axes (x = scene x, y = scene y), not screen axes:
 * the iso view can be rotated, so "left" on screen is not a stable meaning.
 * Placements that share a `group` move as one unit (their union box), so
 * aligning a group with a tank keeps the group's internal layout.
 *
 * Deltas are rounded to whole cells so integer placements stay on the grid;
 * a centre alignment between odd and even sizes is therefore within half a cell.
 */
import { HOLODECK_KINDS, type ContributionRegistry } from '@holodeck/sdk';
import { sceneBounds, type IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { isRunPlacement } from '../registry/geometry';
import { rotateOffset } from '../routing/grid';
import { rotatedFootprint, type Bounds } from '../routing/occupancy';

export type AlignEdge = 'min-x' | 'center-x' | 'max-x' | 'min-y' | 'center-y' | 'max-y';
export type DistributeAxis = 'x' | 'y';

/** Translate a placement: run ends, a connector's free anchors and waypoints travel with it; object anchors stay put. */
export function moveBy(obj: IsoPlacement, dx: number, dy: number): IsoPlacement {
  const next: IsoPlacement = { ...obj, x: obj.x + dx, y: obj.y + dy };
  if (typeof obj.toX === 'number') next.toX = obj.toX + dx;
  if (typeof obj.toY === 'number') next.toY = obj.toY + dy;
  if (obj.link) {
    const shift = (end: NonNullable<IsoPlacement['link']>['from']) =>
      end && 'x' in end ? { x: end.x + dx, y: end.y + dy } : end;
    next.link = { ...obj.link };
    if (obj.link.from) next.link.from = shift(obj.link.from);
    if (obj.link.to) next.link.to = shift(obj.link.to);
    if (obj.link.via) next.link.via = obj.link.via.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  return next;
}

/** Grid box an object covers: rotated footprint around its centre, run ends, and the part's own extent. */
export function objectBounds(obj: IsoPlacement, registry: ContributionRegistry): Bounds {
  const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, obj.object);
  // sceneBounds covers run ends, area width / height and `def.extent` (connectors, images).
  const b = sceneBounds([obj], registry);
  if (isRunPlacement(obj, def) || def?.connector) return b;
  const { w, h } = rotatedFootprint(def, obj.rotation, obj);
  return {
    minX: Math.min(b.minX, obj.x - w / 2),
    minY: Math.min(b.minY, obj.y - h / 2),
    maxX: Math.max(b.maxX, obj.x + w / 2),
    maxY: Math.max(b.maxY, obj.y + h / 2),
  };
}

export function unionBounds(boxes: readonly Bounds[]): Bounds | null {
  if (boxes.length === 0) return null;
  return boxes.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

interface Unit {
  ids: string[];
  box: Bounds;
}

/** Selected placements as move units: one per group, one per ungrouped placement. Scene order. */
function units(objects: readonly IsoPlacement[], ids: ReadonlySet<string>, registry: ContributionRegistry): Unit[] {
  const out: Unit[] = [];
  const byGroup = new Map<string, Unit>();
  for (const o of objects) {
    if (!ids.has(o.id)) continue;
    const box = objectBounds(o, registry);
    const existing = o.group ? byGroup.get(o.group) : undefined;
    if (existing) {
      existing.ids.push(o.id);
      existing.box = unionBounds([existing.box, box])!;
      continue;
    }
    const unit = { ids: [o.id], box };
    if (o.group) byGroup.set(o.group, unit);
    out.push(unit);
  }
  return out;
}

/** Apply per-id deltas; returns the same array when nothing moved. */
function applyDeltas(objects: IsoPlacement[], deltas: ReadonlyMap<string, { dx: number; dy: number }>): IsoPlacement[] {
  let changed = false;
  const next = objects.map((o) => {
    const d = deltas.get(o.id);
    if (!d || (d.dx === 0 && d.dy === 0)) return o;
    changed = true;
    return moveBy(o, d.dx, d.dy);
  });
  return changed ? next : objects;
}

/** Move every selected placement by (dx, dy). */
export function moveObjects(objects: IsoPlacement[], ids: ReadonlySet<string>, dx: number, dy: number): IsoPlacement[] {
  const deltas = new Map([...ids].map((id) => [id, { dx, dy }]));
  return applyDeltas(objects, deltas);
}

const centre = (b: Bounds, axis: DistributeAxis) => (axis === 'x' ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2);

/** Align the selection's units to one edge / centre of the selection's box. Needs two or more units. */
export function alignObjects(
  objects: IsoPlacement[],
  ids: ReadonlySet<string>,
  edge: AlignEdge,
  registry: ContributionRegistry,
): IsoPlacement[] {
  const list = units(objects, ids, registry);
  if (list.length < 2) return objects;
  const all = unionBounds(list.map((u) => u.box))!;
  const axis: DistributeAxis = edge.endsWith('x') ? 'x' : 'y';
  const deltas = new Map<string, { dx: number; dy: number }>();
  for (const u of list) {
    let d: number;
    if (edge === 'min-x') d = all.minX - u.box.minX;
    else if (edge === 'max-x') d = all.maxX - u.box.maxX;
    else if (edge === 'min-y') d = all.minY - u.box.minY;
    else if (edge === 'max-y') d = all.maxY - u.box.maxY;
    else d = centre(all, axis) - centre(u.box, axis);
    const step = Math.round(d);
    for (const id of u.ids) deltas.set(id, axis === 'x' ? { dx: step, dy: 0 } : { dx: 0, dy: step });
  }
  return applyDeltas(objects, deltas);
}

/**
 * Space the selection's units evenly along `axis` by centre: the first and
 * last (by centre) stay put. Needs three or more units.
 */
export function distributeObjects(
  objects: IsoPlacement[],
  ids: ReadonlySet<string>,
  axis: DistributeAxis,
  registry: ContributionRegistry,
): IsoPlacement[] {
  const list = units(objects, ids, registry).sort((a, b) => centre(a.box, axis) - centre(b.box, axis));
  if (list.length < 3) return objects;
  const first = centre(list[0]!.box, axis);
  const last = centre(list[list.length - 1]!.box, axis);
  const gap = (last - first) / (list.length - 1);
  const deltas = new Map<string, { dx: number; dy: number }>();
  list.forEach((u, i) => {
    const step = Math.round(first + gap * i - centre(u.box, axis));
    for (const id of u.ids) deltas.set(id, axis === 'x' ? { dx: step, dy: 0 } : { dx: 0, dy: step });
  });
  return applyDeltas(objects, deltas);
}

/**
 * Rotate the selection a quarter turn around the (cell-rounded) centre of its
 * box: positions, run ends, free connector anchors and waypoints turn with
 * it, and each part's own `rotation` gains the same quarter turn (runs and
 * connectors have no meaningful yaw and are left alone). `direction` +1 is
 * the same sense as `rotate-selected` +1 (a part's yaw + pi/2).
 */
export function rotateObjectsAbout(
  objects: IsoPlacement[],
  ids: ReadonlySet<string>,
  direction: 1 | -1,
  registry: ContributionRegistry,
): IsoPlacement[] {
  const selected = objects.filter((o) => ids.has(o.id));
  const box = unionBounds(selected.map((o) => objectBounds(o, registry)));
  if (!box) return objects;
  const px = Math.round((box.minX + box.maxX) / 2);
  const py = Math.round((box.minY + box.maxY) / 2);
  const turn = direction * (Math.PI / 2);
  const rot = (x: number, y: number) => {
    const r = rotateOffset(x - px, y - py, turn);
    return { x: px + r.x, y: py + r.y };
  };
  return objects.map((o) => {
    if (!ids.has(o.id)) return o;
    const def = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, o.object);
    const p = rot(o.x, o.y);
    const next: IsoPlacement = { ...o, x: p.x, y: p.y };
    if (typeof o.toX === 'number' && typeof o.toY === 'number') {
      const t = rot(o.toX, o.toY);
      next.toX = t.x;
      next.toY = t.y;
    }
    if (o.link) {
      const turnEnd = (end: NonNullable<IsoPlacement['link']>['from']) => (end && 'x' in end ? rot(end.x, end.y) : end);
      next.link = { ...o.link };
      if (o.link.from) next.link.from = turnEnd(o.link.from);
      if (o.link.to) next.link.to = turnEnd(o.link.to);
      if (o.link.via) next.link.via = o.link.via.map((v) => rot(v.x, v.y));
    }
    if (!isRunPlacement(o, def) && !def?.connector) next.rotation = (o.rotation ?? 0) + turn;
    return next;
  });
}
