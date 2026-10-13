import { HOLODECK_KINDS } from '@holodeck/sdk';
import { createIsoRegistry } from '../registry/kinds';
import { describe, expect, it } from 'vitest';
import { PIPE_RADIUS, pipeWorldY } from '../../assets/process/pipe-math';
import {
  DEFAULT_TANK_PARAMS,
  MIXER_WINDOW_DEG,
  MIXER_WINDOW_YAW,
  TANK_WINDOW_DEG,
  TANK_WINDOW_YAW,
  tankWindow,
} from '../../assets/process/tank-params';
import type { IsoPlacement } from '../iso/scene';
import type { IsoPartDefinition } from '../registry/types';
import { HEADINGS, HEADING_VECTOR } from './grid';
import { resolveRouteEnd } from './ports';
import { pipe, registry, tank } from './test-helpers';
import {
  angularDistanceDeg,
  clipPipeEnd,
  cutoutFromWindow,
  findWindowConnections,
  headingWallAngleDeg,
  overlapsCutout,
  pipeAxisDistance,
  pipeHalfAngleDeg,
  portWallAngleDeg,
  resolvePipeClips,
  vesselCutout,
  vesselRadius,
  vesselWall,
  vesselWallSpan,
  wallAngleDeg,
  wrapDeg,
  type VesselWall,
} from './vessel-ports';

const tankDef = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, 'tank')!;
const mixerDef = registry.get<IsoPartDefinition>(HOLODECK_KINDS.isoPart, 'mixer')!;
const HALF = pipeHalfAngleDeg(1); // pipe band on a radius-1 vessel

describe('wall angles (Tank cylinder theta: s = 0, e = 90, n = 180, w = 270)', () => {
  it('maps grid headings', () => {
    expect(HEADINGS.map(headingWallAngleDeg)).toEqual([180, 90, 0, 270]);
    expect(wallAngleDeg(1, 1)).toBeCloseTo(45);
    expect(wallAngleDeg(-1, -1)).toBeCloseTo(225);
  });

  it('matches where Tank cuts its window: tankWindow removes [yaw - w/2, yaw + w/2]', () => {
    // CylinderGeometry: (x, z) = (sin theta, cos theta); the keep arc starts at the window's far jamb.
    const { keepStart, keepLen, windowStart, windowRad } = tankWindow(TANK_WINDOW_DEG, TANK_WINDOW_YAW);
    const c = cutoutFromWindow(TANK_WINDOW_YAW, TANK_WINDOW_DEG);
    expect(wrapDeg((windowStart * 180) / Math.PI)).toBeCloseTo(wrapDeg(c.centerDeg - c.widthDeg / 2));
    expect((windowRad * 180) / Math.PI).toBeCloseTo(c.widthDeg);
    expect(wrapDeg(((keepStart + keepLen) * 180) / Math.PI)).toBeCloseTo(wrapDeg(c.centerDeg - c.widthDeg / 2));
  });

  it('wraps and measures angular distance across 0/360', () => {
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(725)).toBe(5);
    expect(Object.is(wrapDeg(-0), 0)).toBe(true);
    expect(angularDistanceDeg(350, 10)).toBe(20);
    expect(angularDistanceDeg(10, 350)).toBe(20);
    expect(angularDistanceDeg(0, 180)).toBe(180);
  });

  it('pipe band half-angle is asin(rp / R)', () => {
    expect(pipeHalfAngleDeg(1, 0.2)).toBeCloseTo((Math.asin(0.2) * 180) / Math.PI);
    expect(pipeHalfAngleDeg(0.1, 0.2)).toBe(90);
    expect(pipeHalfAngleDeg(0)).toBe(90);
  });
});

describe('overlapsCutout', () => {
  const tankCut = cutoutFromWindow(TANK_WINDOW_YAW, TANK_WINDOW_DEG); // [-0.5, 90.5]

  it('the default tank window takes the e and s sides, not n and w', () => {
    expect(overlapsCutout(tankCut, 90, HALF)).toBe(true);
    expect(overlapsCutout(tankCut, 0, HALF)).toBe(true);
    expect(overlapsCutout(tankCut, 180, HALF)).toBe(false);
    expect(overlapsCutout(tankCut, 270, HALF)).toBe(false);
  });

  it('counts the pipe band, not just its centreline', () => {
    // 95 deg is outside the arc, but a 0.2 pipe on a radius-1 wall spans 95 +- 11.5.
    expect(overlapsCutout(tankCut, 95, 0)).toBe(false);
    expect(overlapsCutout(tankCut, 95, HALF)).toBe(true);
    expect(overlapsCutout(tankCut, 90.5 + HALF + 0.01, HALF)).toBe(false);
  });

  it('a band exactly touching the jamb is allowed', () => {
    expect(overlapsCutout({ centerDeg: 90, widthDeg: 20 }, 110, 10)).toBe(false);
    expect(overlapsCutout({ centerDeg: 90, widthDeg: 20 }, 109.9, 10)).toBe(true);
  });

  it('handles an arc that wraps past 360', () => {
    const wrap = cutoutFromWindow(350, 40); // [330, 10]
    expect(wrap.centerDeg).toBe(350);
    expect(overlapsCutout(wrap, 0)).toBe(true);
    expect(overlapsCutout(wrap, 5)).toBe(true);
    expect(overlapsCutout(wrap, 335)).toBe(true);
    expect(overlapsCutout(wrap, 15)).toBe(false);
    expect(overlapsCutout(wrap, 320)).toBe(false);
    // Yaw pushed past 360 by the placement rotation lands on the same arc.
    expect(cutoutFromWindow(260, 40, Math.PI / 2).centerDeg).toBeCloseTo(350);
    expect(cutoutFromWindow(-10, 40).centerDeg).toBe(350);
  });

  it('degenerate arcs: none, zero width, full circle', () => {
    expect(overlapsCutout(null, 90, HALF)).toBe(false);
    expect(overlapsCutout({ centerDeg: 90, widthDeg: 0 }, 90)).toBe(false);
    expect(overlapsCutout(cutoutFromWindow(0, 400), 123)).toBe(true);
  });
});

describe('vesselCutout sources', () => {
  it('built-in tank and mixer read their window from tank-params', () => {
    expect(vesselCutout(tankDef, { id: 't' })).toEqual({
      centerDeg: DEFAULT_TANK_PARAMS.windowYawDeg,
      widthDeg: DEFAULT_TANK_PARAMS.windowDeg,
    });
    expect(vesselCutout(mixerDef, { id: 'm' })).toEqual({ centerDeg: MIXER_WINDOW_YAW, widthDeg: MIXER_WINDOW_DEG });
  });

  it('rotates with the placement (yaw adds to theta)', () => {
    expect(vesselCutout(tankDef, { id: 't', rotation: Math.PI })!.centerDeg).toBeCloseTo(225);
    expect(vesselCutout(tankDef, { id: 't', rotation: -Math.PI / 2 })!.centerDeg).toBeCloseTo(315);
  });

  it('windowYaw / windowDeg params win over the part cutout, from defaults or the placement', () => {
    const def: Pick<IsoPartDefinition, 'params' | 'cutout'> = {
      cutout: { windowYawDeg: 45, windowDeg: 91 },
      params: {
        windowYaw: { type: 'number', label: 'Window yaw', default: 200 },
        windowDeg: { type: 'number', label: 'Window', default: 60 },
      },
    };
    expect(vesselCutout(def, { id: 'v' })).toEqual({ centerDeg: 200, widthDeg: 60 });
    expect(vesselCutout(def, { id: 'v', params: { windowYaw: 10 } })).toEqual({ centerDeg: 10, widthDeg: 60 });
    // TankParams spelling is accepted too.
    expect(vesselCutout({ params: {} }, { id: 'v', params: { windowYawDeg: 30, windowDeg: 20 } })).toEqual({
      centerDeg: 30,
      widthDeg: 20,
    });
  });

  it('no cutout without both numbers', () => {
    expect(vesselCutout({ params: {} }, { id: 'v' })).toBeNull();
    expect(vesselCutout({ params: {} }, { id: 'v', params: { windowYaw: 30 } })).toBeNull();
    expect(vesselCutout({ params: {} }, { id: 'v', params: { windowYaw: 'x', windowDeg: 20 } })).toBeNull();
  });

  it('radius: a radius param, else half the smaller footprint side', () => {
    const at = (params?: Record<string, unknown>): IsoPlacement => ({ id: 'v', object: 'v', x: 0, y: 0, params });
    expect(vesselRadius(tankDef, at())).toBe(1);
    expect(vesselRadius({ footprint: { w: 3, h: 2 }, params: {} }, at())).toBe(1);
    expect(vesselRadius({ footprint: { w: 2, h: 2 }, params: {} }, at({ radius: 0.63 }))).toBe(0.63);
    // A part that sizes itself (footprintOf) is measured by the placement's footprint.
    const sized = { footprint: { w: 2, h: 2 }, footprintOf: () => ({ w: 4, h: 4 }), params: {} };
    expect(vesselRadius(sized, at())).toBe(2);
  });
});

describe('ports inside the window are valid again', () => {
  it('a click on the window side of a tank snaps to the east port (clipped at render time)', () => {
    const end = resolveRouteEnd({ objects: [tank('t', 0, 0)] }, registry, { x: 1, y: 1 });
    expect(end).toMatchObject({ cell: { x: 1, y: 0 }, heading: 'e', port: 'east' });
  });

  it('the east port is in the window (so that pipe gets a cut end)', () => {
    expect(overlapsCutout(vesselCutout(tankDef, tank('t', 0, 0)), portWallAngleDeg(tankDef.ports!.east!), HALF)).toBe(true);
  });
});

/** A radius-1 floor-standing vessel at the origin with the default tank window [-0.5, 90.5]. */
const wall = (over: Partial<VesselWall> = {}): VesselWall => ({
  id: 'v',
  x: 0,
  y: 0,
  radius: 1,
  cutout: cutoutFromWindow(TANK_WINDOW_YAW, TANK_WINDOW_DEG),
  span: { bottomY: 0, topY: 3 },
  ...over,
});
const at = (x: number, y: number) => ({ x, y });
/** A radial pipe end on the wall at wall angle `deg`, running `len` outward. */
const radial = (deg: number, r = 1, len = 3) => {
  const a = (deg * Math.PI) / 180;
  return { end: at(r * Math.sin(a), r * Math.cos(a)), other: at((r + len) * Math.sin(a), (r + len) * Math.cos(a)) };
};

describe('clipPipeEnd', () => {
  it('window entry at several angles: cut at the wall, no trim for a radial end already on it', () => {
    for (const deg of [0, 30, 45, 60, 90]) {
      const { end, other } = radial(deg);
      const c = clipPipeEnd(end, other, wall());
      expect(c, `${deg}`).toMatchObject({ vesselId: 'v', contact: 'window', cut: true });
      expect(c!.trim, `${deg}`).toBeCloseTo(0);
      expect(c!.angleDeg, `${deg}`).toBeCloseTo(deg);
    }
  });

  it('solid-wall entry is left alone (no clip, flanged end)', () => {
    for (const deg of [135, 180, 225, 270, 315]) {
      const { end, other } = radial(deg);
      expect(clipPipeEnd(end, other, wall()), `${deg}`).toMatchObject({ contact: 'wall', trim: 0, cut: false });
    }
  });

  it('the pipe band decides at the jamb: a centreline just outside the arc still enters the window', () => {
    // 95 deg is outside [-0.5, 90.5], but a 0.2 pipe on R 1 covers 95 +- 11.5.
    expect(clipPipeEnd(radial(95).end, radial(95).other, wall())!.contact).toBe('window');
    const clear = 90.5 + HALF + 0.1;
    expect(clipPipeEnd(radial(clear).end, radial(clear).other, wall())!.contact).toBe('wall');
  });

  it('trims an end authored inside the wall back to the wall surface', () => {
    // East end 0.4 inside the wall: trim 0.4 along the pipe.
    const c = clipPipeEnd(at(0.6, 0), at(4, 0), wall())!;
    expect(c.contact).toBe('window');
    expect(c.trim).toBeCloseTo(0.4);
    // From the centre: the whole radius goes.
    expect(clipPipeEnd(at(0, 0), at(4, 0), wall())!.trim).toBeCloseTo(1);
  });

  it('extends an end authored up to one pipe radius short of the wall onto it', () => {
    const c = clipPipeEnd(at(1.15, 0), at(4, 0), wall())!;
    expect(c.contact).toBe('window');
    expect(c.trim).toBeCloseTo(-0.15);
    // Beyond R + rp the pipe does not touch the vessel.
    expect(clipPipeEnd(at(1.25, 0), at(4, 0), wall())).toBeNull();
  });

  it('an off-centre run is cut where its surface meets the curved wall', () => {
    // Axis 0.5 off the centre (y = 0.5), running +x: the nearest surface line is 0.3 off,
    // so the whole section is outside R at x = sqrt(1 - 0.3^2).
    const c = clipPipeEnd(at(0.8, 0.5), at(4, 0.5), wall())!;
    expect(c.contact).toBe('window');
    expect(0.8 + c.trim).toBeCloseTo(Math.sqrt(1 - 0.3 * 0.3));
    // The axis meets the wall at x = sqrt(1 - 0.5^2): that is the band centre.
    expect(c.angleDeg).toBeCloseTo(wallAngleDeg(Math.sqrt(0.75), 0.5));
    // A run whose surface never reaches inside R is not a contact.
    expect(clipPipeEnd(at(0.1, 1.2), at(4, 1.2), wall())).toBeNull();
  });

  it('honours a rotated vessel (yaw adds to the window)', () => {
    // Rotated pi: the window moves to [179.5, 270.5]; e becomes solid, w opens.
    const rotated = wall({ cutout: cutoutFromWindow(TANK_WINDOW_YAW, TANK_WINDOW_DEG, Math.PI) });
    expect(clipPipeEnd(radial(90).end, radial(90).other, rotated)!.contact).toBe('wall');
    expect(clipPipeEnd(radial(270).end, radial(270).other, rotated)!.contact).toBe('window');
    // Through a real placement: same answer.
    const v = vesselWall(tankDef, tank('t', 0, 0, Math.PI))!;
    expect(clipPipeEnd(at(-1, 0), at(-4, 0), v)!.contact).toBe('window');
    expect(clipPipeEnd(at(1, 0), at(4, 0), v)!.contact).toBe('wall');
  });

  it('a window wrapping past 360 deg', () => {
    const wrap = wall({ cutout: cutoutFromWindow(350, 40) }); // [330, 10]
    expect(clipPipeEnd(radial(0).end, radial(0).other, wrap)!.contact).toBe('window');
    expect(clipPipeEnd(radial(340).end, radial(340).other, wrap)!.contact).toBe('window');
    expect(clipPipeEnd(radial(90).end, radial(90).other, wrap)!.contact).toBe('wall');
    // 300 + band 11.5 = 311.5 < 330: solid.
    expect(clipPipeEnd(radial(300).end, radial(300).other, wrap)!.contact).toBe('wall');
  });

  it('pipe radius vs wall radius', () => {
    // A pipe as fat as the vessel covers +-90 deg: anything but the far side touches the window.
    const thin = wall({ radius: 0.2 });
    const e = clipPipeEnd(at(0.2, 0), at(3, 0), thin)!;
    expect(e.contact).toBe('window');
    expect(e.trim).toBeCloseTo(0);
    expect(pipeHalfAngleDeg(0.2, 0.2)).toBe(90);
    // Thinner than the vessel's own pipe band: rp 0 gives a pure centreline test.
    expect(clipPipeEnd(radial(95).end, radial(95).other, wall(), { pipeRadius: 0 })!.contact).toBe('wall');
    // Fatter pipe on the same wall widens the band and the contact tolerance.
    expect(clipPipeEnd(at(1.35, 0), at(4, 0), wall(), { pipeRadius: 0.4 })!.trim).toBeCloseTo(-0.35);
    // A zero-radius vessel never clips.
    expect(clipPipeEnd(at(0, 0), at(4, 0), wall({ radius: 0 }))).toBeNull();
  });

  it('a raised vessel: rim ends pass under the window, centre ends are bottom / cone outlets', () => {
    // Fermenter-like: wall from 1.3 up; the pipe (axis 0.32, r 0.2) is below it.
    const raised = wall({ radius: 0.6, span: { bottomY: 1.3, topY: 3.2 } });
    // Cone outlet branch drawn from the centre, running south through the window side.
    expect(clipPipeEnd(at(0, 0), at(0, 3.5), raised)).toMatchObject({ contact: 'outlet', trim: 0, cut: false });
    // Glycol stub on the rim (east, window side): under, not cut; outside the wall so no trim.
    expect(clipPipeEnd(at(0.8, 0), at(1.8, 0), raised)).toMatchObject({ contact: 'under', trim: 0, cut: false });
    // A rim end 0.05 inside the radius is pulled back to the rim, still not cut.
    const under = clipPipeEnd(at(0.55, 0), at(3, 0), raised)!;
    expect(under).toMatchObject({ contact: 'under', cut: false });
    expect(under.trim).toBeCloseTo(0.05);
    // Dish-bottom vessel whose wall starts inside the pipe's height band: the pipe reaches the window.
    const brite = wall({ radius: 0.7, span: { bottomY: 0.42, topY: 2.5 } });
    const inlet = clipPipeEnd(at(0, 0.8), at(0, 3.5), brite)!;
    expect(inlet).toMatchObject({ contact: 'window', cut: true });
    expect(inlet.trim).toBeCloseTo(-0.1);
    // The pipe touching the wall bottom exactly is under it (no overlap).
    const mash = wall({ span: { bottomY: pipeWorldY() + 0.2, topY: 2.2 } });
    expect(clipPipeEnd(at(1, 0), at(4, 0), mash)!.contact).toBe('under');
  });

  it('pipes passing over a vessel, and degenerate pipes, are not contacts', () => {
    expect(clipPipeEnd(at(1, 0), at(4, 0), wall({ span: { bottomY: -3, topY: 0.1 } }))).toBeNull();
    expect(clipPipeEnd(at(1, 0), at(1, 0), wall())).toBeNull();
  });
});

describe('vesselWallSpan', () => {
  it('declared spans win; built-in vessels stand on the floor to their height', () => {
    const def = { wallSpan: () => ({ bottomY: 0.5, topY: 2 }) };
    expect(vesselWallSpan(def, tank('t', 0, 0))).toEqual({ bottomY: 0.5, topY: 2 });
    expect(vesselWallSpan(tankDef, tank('t', 0, 0))).toEqual({ bottomY: 0, topY: 3.05 });
    expect(vesselWallSpan(tankDef, { ...tank('t', 0, 0), height: 2 })).toEqual({ bottomY: 0, topY: 2 });
    expect(vesselWallSpan({}, tank('t', 0, 0))).toEqual({ bottomY: 0, topY: Infinity });
  });
});

describe('resolvePipeClips / findWindowConnections', () => {
  it('clips the window end and leaves the solid-wall end alone', () => {
    const objects: IsoPlacement[] = [tank('t', 0, 0), pipe('east', 1, 0, 4, 0), pipe('west', -4, 0, -1, 0)];
    const clips = resolvePipeClips(objects, registry);
    expect(clips.get('east')).toEqual({ from: expect.objectContaining({ contact: 'window', cut: true }) });
    expect(clips.get('west')).toEqual({ to: expect.objectContaining({ contact: 'wall', cut: false, trim: 0 }) });
    const hits = findWindowConnections({ objects }, registry);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pipeId: 'east', vesselId: 't', end: 'from' });
    expect(hits[0]!.angleDeg).toBeCloseTo(90);
  });

  it('a pipe between two vessels can be clipped at both ends', () => {
    // Left tank default (its e side is open), right tank rotated pi (its w side is open).
    const objects: IsoPlacement[] = [tank('a', 0, 0), tank('b', 6, 0, Math.PI), pipe('p', 0.8, 0, 5.2, 0)];
    const c = resolvePipeClips(objects, registry).get('p')!;
    expect(c.from).toMatchObject({ vesselId: 'a', contact: 'window' });
    expect(c.to).toMatchObject({ vesselId: 'b', contact: 'window' });
    expect(c.from!.trim).toBeCloseTo(0.2);
    expect(c.to!.trim).toBeCloseTo(0.2);
  });

  it('skips parts without a cutout and pipes away from vessels', () => {
    const objects: IsoPlacement[] = [
      { id: 'v', object: 'valve', x: 0, y: 0 },
      pipe('p', 0, 0, 3, 0),
      tank('t', 10, 10),
      pipe('far', 20, 20, 25, 20),
    ];
    expect(resolvePipeClips(objects, registry).size).toBe(0);
    expect(findWindowConnections({ objects }, registry)).toEqual([]);
  });

  it('every n/e/s/w side of a default tank: e and s enter the window, n and w are solid', () => {
    const contact = HEADINGS.map((h) => {
      const v = HEADING_VECTOR[h];
      const objects = [tank('t', 0, 0), pipe('p', v.x, v.y, v.x * 4, v.y * 4)];
      return resolvePipeClips(objects, registry, { pipeRadius: PIPE_RADIUS }).get('p')?.from?.contact;
    });
    expect(Object.fromEntries(HEADINGS.map((h, i) => [h, contact[i]]))).toEqual({
      n: 'wall',
      e: 'window',
      s: 'window',
      w: 'wall',
    });
  });

  it('a vessel without a cutout is never clipped', () => {
    const reg = createIsoRegistry();
    const plain: IsoPartDefinition = { ...tankDef, id: 'plain', cutout: undefined };
    reg.install({
      id: 'test.plain',
      version: '1.0.0',
      label: 'plain',
      contributions: { [HOLODECK_KINDS.isoPart]: [plain] },
    });
    expect(resolvePipeClips([{ id: 'v', object: 'plain', x: 0, y: 0 }, pipe('p', 1, 0, 4, 0)], reg).size).toBe(0);
  });
});

describe('pipeAxisDistance', () => {
  it('radial pipe ending on the wall: exactly R (its end disc centre), not R - rp', () => {
    expect(pipeAxisDistance(at(1, 0), at(4, 0), at(0, 0))).toBeCloseTo(1);
    // After a window clip the drawn run never reaches inside R.
    const { end, other } = radial(30, 0.6);
    const c = clipPipeEnd(end, other, wall())!;
    const t = c.trim;
    const len = Math.hypot(other.x - end.x, other.y - end.y);
    const drawn = at(end.x + ((other.x - end.x) / len) * t, end.y + ((other.y - end.y) / len) * t);
    expect(pipeAxisDistance(drawn, other, at(0, 0))).toBeCloseTo(1);
  });
  it('off-centre and passing runs use the lateral gap less the pipe radius', () => {
    // Off-centre clip: the surface touches R exactly.
    const c = clipPipeEnd(at(0.8, 0.5), at(4, 0.5), wall())!;
    expect(pipeAxisDistance(at(0.8 + c.trim, 0.5), at(4, 0.5), at(0, 0))).toBeCloseTo(1);
    // A run passing 2 cells from the centre, r 0.2: 1.8.
    expect(pipeAxisDistance(at(-5, 2), at(5, 2), at(0, 0))).toBeCloseTo(1.8);
    // Through the centre: 0.
    expect(pipeAxisDistance(at(-5, 0), at(5, 0), at(0, 0))).toBe(0);
    // Degenerate pipe: a disc.
    expect(pipeAxisDistance(at(3, 0), at(3, 0), at(0, 0))).toBeCloseTo(2.8);
  });
});
