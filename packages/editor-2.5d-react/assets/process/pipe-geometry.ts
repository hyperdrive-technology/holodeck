import { BufferGeometry, CylinderGeometry, LatheGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  PIPE_FLANGE_LEN,
  PIPE_FLANGE_SCALE,
  PIPE_RADIUS,
  PIPE_RING_LEN,
  PIPE_RING_SCALE,
  PIPE_RING_SPACING,
  PIPE_SIDES,
} from './pipe-math';

/**
 * How one end of a run is finished:
 * - `flange`: the stub-end collar ring (default).
 * - `plain`: closed disc, no collar (the west nipple, which draws its own).
 * - `cut`: open cut section where a pipe runs into a vessel's cut-away
 *   window (routing/vessel-ports.ts `clipPipeEnd`). The tube wall shows as a
 *   ring from PIPE_CUT_INNER * r to r and the bore is left open for
 *   `buildPipeBoreGeometry`, like the tank's own cut wall.
 */
export type PipeEndStyle = 'flange' | 'plain' | 'cut';

/**
 * Inner radius of a cut pipe's wall, as a fraction of the pipe radius. The
 * tank's own wall is drawn ~1% thick (linerRatio 0.99), which on a 0.2 pipe
 * would be a sub-pixel ring; 0.72 keeps the tube wall readable at the app
 * zoom while the bore still reads as the hole.
 */
export const PIPE_CUT_INNER = 0.72;

/** Resolve the two end styles from the options (`ends` wins over the legacy `endFlanges` flag). */
export function pipeEndStyles(
  endFlanges: boolean,
  ends?: { from?: PipeEndStyle; to?: PipeEndStyle },
): { from: PipeEndStyle; to: PipeEndStyle } {
  const fallback: PipeEndStyle = endFlanges ? 'flange' : 'plain';
  return { from: ends?.from ?? fallback, to: ends?.to ?? fallback };
}

/**
 * Wire-mesh tube for one pipe run: the body 8-gon plus short joint rings
 * every ~PIPE_RING_SPACING cells and (optionally) flange rings at both ends,
 * merged into ONE geometry along local Y, centred on the origin, in real
 * units (no Y scale).
 *
 * Why merged geometry instead of a scaled unit cylinder: EdgesGeometry only
 * draws creases, and a cylinder with extra height segments has none. The
 * Arcentry "segment joints" only exist as outline if the joints are real
 * steps in the surface, so each is a slightly fatter ring. Why not scale:
 * a Y-scaled unit cylinder would stretch the rings with the run length.
 *
 * Rust-style note for Des: this is a pure function (length in, geometry out),
 * the caller memoises it; there is no hidden state like a Go struct cache.
 */
export function buildPipeGeometry({
  length,
  radius = PIPE_RADIUS,
  sides = PIPE_SIDES,
  endFlanges = true,
  ends,
  flangeScale = PIPE_FLANGE_SCALE,
  flangeLen = PIPE_FLANGE_LEN,
}: {
  length: number;
  radius?: number;
  sides?: number;
  endFlanges?: boolean;
  /** Per-end finish; local -Y is the run's `from` end, +Y its `to` end (see `pipePose`). */
  ends?: { from?: PipeEndStyle; to?: PipeEndStyle };
  flangeScale?: number;
  flangeLen?: number;
}): BufferGeometry {
  const len = Math.max(length, 0.01);
  const style = pipeEndStyles(endFlanges, ends);
  const inner = radius * PIPE_CUT_INNER;
  // Round 3: the body is ONE lathe whose profile carries the joint bumps (radius r -> r*scale -> r over
  // PIPE_RING_LEN), instead of body cylinder + overlapping ring cylinders. A ring cylinder has two 90 degree
  // end caps, so every joint drew TWO lines (the "ladder" busyness vs reference). A bi-conical bump has a
  // ~22 degree crease at each foot and ~44 degrees at the crest: with style.edges.thresholds.pipe = 30 only the
  // crest draws, one line per joint. LatheGeometry samples phi like CylinderGeometry (x = r sin, z = r cos), so
  // the 8 facets line up with the flange rings below.
  // A closed end runs the profile to the axis (a disc); a cut end stops at the
  // bore radius, so the end is the tube-wall ring and the bore stays open.
  const profile: Vector2[] = [new Vector2(style.from === 'cut' ? inner : 0, -len / 2), new Vector2(radius, -len / 2)];
  const joints = Math.max(1, Math.round(len / PIPE_RING_SPACING));
  // Even split, so the end segments are not a stub: n segments, n-1 interior joints.
  for (let i = 1; i < joints; i++) {
    const y = -len / 2 + (i * len) / joints;
    profile.push(
      new Vector2(radius, y - PIPE_RING_LEN / 2),
      new Vector2(radius * PIPE_RING_SCALE, y),
      new Vector2(radius, y + PIPE_RING_LEN / 2),
    );
  }
  profile.push(new Vector2(radius, len / 2), new Vector2(style.to === 'cut' ? inner : 0, len / 2));
  const parts: BufferGeometry[] = [new LatheGeometry(profile, sides)];
  const ring = (y: number, scale: number, ringLen: number) => {
    const g = new CylinderGeometry(radius * scale, radius * scale, ringLen, sides);
    g.translate(0, y, 0);
    parts.push(g);
  };
  if (style.from === 'flange') ring(-len / 2, flangeScale, flangeLen);
  if (style.to === 'flange') ring(len / 2, flangeScale, flangeLen);
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) {
    throw new Error('buildPipeGeometry: mergeGeometries failed (attribute mismatch)');
  }
  return merged;
}

/**
 * The open bore of each `cut` end: a disc of PIPE_CUT_INNER * radius in the
 * end plane, in the same local frame as `buildPipeGeometry` (drawn in the
 * style's `bore` colour). Null when neither end is cut.
 */
export function buildPipeBoreGeometry({
  length,
  radius = PIPE_RADIUS,
  sides = PIPE_SIDES,
  ends,
}: {
  length: number;
  radius?: number;
  sides?: number;
  ends?: { from?: PipeEndStyle; to?: PipeEndStyle };
}): BufferGeometry | null {
  const len = Math.max(length, 0.01);
  const inner = radius * PIPE_CUT_INNER;
  const parts: BufferGeometry[] = [];
  // Same profile direction as the body's end segment, so the disc faces outward like the ring around it.
  if (ends?.from === 'cut') parts.push(new LatheGeometry([new Vector2(0, -len / 2), new Vector2(inner, -len / 2)], sides));
  if (ends?.to === 'cut') parts.push(new LatheGeometry([new Vector2(inner, len / 2), new Vector2(0, len / 2)], sides));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return merged;
}
