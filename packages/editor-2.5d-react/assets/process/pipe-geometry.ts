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
  flangeScale = PIPE_FLANGE_SCALE,
  flangeLen = PIPE_FLANGE_LEN,
}: {
  length: number;
  radius?: number;
  sides?: number;
  endFlanges?: boolean;
  flangeScale?: number;
  flangeLen?: number;
}): BufferGeometry {
  const len = Math.max(length, 0.01);
  // Round 3: the body is ONE lathe whose profile carries the joint bumps (radius r -> r*scale -> r over
  // PIPE_RING_LEN), instead of body cylinder + overlapping ring cylinders. A ring cylinder has two 90 degree
  // end caps, so every joint drew TWO lines (the "ladder" busyness vs reference). A bi-conical bump has a
  // ~22 degree crease at each foot and ~44 degrees at the crest: with style.edges.thresholds.pipe = 30 only the
  // crest draws, one line per joint. LatheGeometry samples phi like CylinderGeometry (x = r sin, z = r cos), so
  // the 8 facets line up with the flange rings below.
  const profile: Vector2[] = [new Vector2(0, -len / 2), new Vector2(radius, -len / 2)];
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
  profile.push(new Vector2(radius, len / 2), new Vector2(0, len / 2));
  const parts: BufferGeometry[] = [new LatheGeometry(profile, sides)];
  const ring = (y: number, scale: number, ringLen: number) => {
    const g = new CylinderGeometry(radius * scale, radius * scale, ringLen, sides);
    g.translate(0, y, 0);
    parts.push(g);
  };
  if (endFlanges) {
    ring(-len / 2, flangeScale, flangeLen);
    ring(len / 2, flangeScale, flangeLen);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  if (!merged) {
    throw new Error('buildPipeGeometry: mergeGeometries failed (attribute mismatch)');
  }
  return merged;
}
