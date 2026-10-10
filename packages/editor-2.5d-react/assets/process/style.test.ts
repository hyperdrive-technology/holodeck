import { describe, expect, it } from 'vitest';
import { STEAM_NUT_EDGE_THRESHOLD } from './EndCap';
import { DEFAULT_FITTING_PARAMS } from './fitting-params';
import { createFinishMaterial, type IsoUniforms } from './materials';
import { PIPE_WIRE_WIDTH, WEST_RING_EDGE_THRESHOLD } from './pipe-math';
import { BODY, EDGE, FILL } from './Shell';
import { FINISH_NAMES, HOLODECK_STYLE } from './style';
import {
  DEFAULT_TANK_PARAMS,
  MIXER_HUB_WHITE,
  MIXER_SHADE_MAX,
  MIXER_SHADE_MIN,
  MIXER_WALL_THRESHOLD,
  TANK_HUB_WHITE,
  TANK_SHADE_MAX,
  TANK_SHADE_MIN,
  TANK_WALL_THRESHOLD,
} from './tank-params';

/**
 * Drift guard. The literals below are the values the scene rendered with
 * before the style extraction (phase 1 = no visual change). Changing a
 * token on purpose means changing it here too, in the same commit.
 */
describe('HOLODECK_STYLE tokens', () => {
  it('keeps the pre-extraction colours', () => {
    expect(HOLODECK_STYLE.colors).toEqual({
      body: '#ffffff',
      edge: '#666666',
      areaFill: '#f3f3f3',
      areaEdge: '#c8c8c8',
      accent: '#c0392b',
      band: '#c0392b',
      bandInstanced: '#e74c3c',
      pipeWire: '#888888',
      liquid: '#4aa3d9',
      alarm: '#e85d5d',
      bore: '#3a3a3a',
    });
  });

  it('keeps the pre-extraction edge settings', () => {
    expect(HOLODECK_STYLE.edges).toEqual({
      threshold: 15,
      thresholds: {
        tankWall: 15,
        mixerWall: 7,
        elbow: 10,
        // round 3: pipe 15 -> 30 (one crest line per joint), new valveWheel 40 (outline only the 90° steps)
        pipe: 30,
        valve: 15,
        valveWheel: 40,
        nut: 1,
        westRing: 15,
        steamNut: 15,
        area: 1,
      },
      lineWidth: 1,
      wireWidth: 1.5,
    });
  });

  it('keeps the pre-extraction finishes', () => {
    expect(HOLODECK_STYLE.finishes).toEqual({
      white: { kind: 'unlit', color: '#ffffff', offset: false },
      shaded: { kind: 'iso', shadeMin: 0.5, shadeMax: 0.92, hubWhite: 0.92, whiteHub: false, offset: true },
      vessel: { kind: 'iso', shadeMin: 0.22, shadeMax: 0.95, hubWhite: 0.85, whiteHub: false, offset: true },
      flask: { kind: 'iso', shadeMin: 0.4, shadeMax: 0.97, hubWhite: 0.88, whiteHub: false, offset: true },
      accent: { kind: 'unlit', color: '#c0392b', offset: false },
    });
    expect([...FINISH_NAMES].sort()).toEqual(Object.keys(HOLODECK_STYLE.finishes).sort());
  });

  it('keeps the legacy constant names as aliases with the old values', () => {
    expect(EDGE).toBe('#666666');
    expect(BODY).toBe('#ffffff');
    expect(FILL).toBe('#4aa3d9');
    expect(TANK_SHADE_MIN).toBe(0.22);
    expect(TANK_SHADE_MAX).toBe(0.95);
    expect(TANK_HUB_WHITE).toBe(0.85);
    expect(MIXER_SHADE_MIN).toBe(0.4);
    expect(MIXER_SHADE_MAX).toBe(0.97);
    expect(MIXER_HUB_WHITE).toBe(0.88);
    expect(TANK_WALL_THRESHOLD).toBe(15);
    expect(MIXER_WALL_THRESHOLD).toBe(7);
    expect(PIPE_WIRE_WIDTH).toBe(1.5);
    expect(WEST_RING_EDGE_THRESHOLD).toBe(15);
    expect(STEAM_NUT_EDGE_THRESHOLD).toBe(15);
  });

  it('feeds the tuner defaults from the tokens', () => {
    expect(DEFAULT_TANK_PARAMS.edgeColor).toBe('#666666');
    expect(DEFAULT_TANK_PARAMS.lineWidth).toBe(1.5);
    expect(DEFAULT_TANK_PARAMS.capLineWidth).toBe(1.5);
    expect(DEFAULT_TANK_PARAMS.fillColor).toBe('#4aa3d9');
    expect(DEFAULT_TANK_PARAMS.shadeMin).toBe(0.22);
    expect(DEFAULT_TANK_PARAMS.shadeMax).toBe(0.95);
    expect(DEFAULT_TANK_PARAMS.hubWhite).toBe(0.85);
    expect(DEFAULT_TANK_PARAMS.wallThreshold).toBe(15);
    expect(DEFAULT_FITTING_PARAMS.pipeWireColor).toBe('#888888');
    expect(DEFAULT_FITTING_PARAMS.pipeWireWidth).toBe(1.5);
    expect(DEFAULT_FITTING_PARAMS.pipeBandColor).toBe('#c0392b');
    expect(DEFAULT_FITTING_PARAMS.elbowEdgeThreshold).toBe(10);
    expect(DEFAULT_FITTING_PARAMS.valveHandwheel).toBe('#c0392b');
  });
});

describe('createFinishMaterial', () => {
  it('builds the iso shade with the finish uniforms and polygon offset', () => {
    const mat = createFinishMaterial('vessel');
    const iso = mat.userData.iso as IsoUniforms;
    expect(iso.uShadeMin.value).toBe(0.22);
    expect(iso.uShadeMax.value).toBe(0.95);
    expect(iso.uHubWhite.value).toBe(0.85);
    expect(iso.uWhiteHub.value).toBe(0);
    expect(mat.colorNode).toBeTruthy();
    expect(mat.toneMapped).toBe(false);
    expect([mat.polygonOffset, mat.polygonOffsetFactor, mat.polygonOffsetUnits]).toEqual([true, 1, 1]);
    expect(mat.userData.hdFinish).toBe('vessel');
    mat.dispose();
  });

  it('builds unlit white without polygon offset (pipes must not offset)', () => {
    const mat = createFinishMaterial('white');
    expect(mat.userData.iso).toBeUndefined();
    expect(mat.color.getHexString()).toBe('ffffff');
    expect(mat.toneMapped).toBe(false);
    expect([mat.polygonOffset, mat.polygonOffsetFactor, mat.polygonOffsetUnits]).toEqual([false, 0, 0]);
  });

  it('honours colour, offset and shade overrides', () => {
    const accent = createFinishMaterial('accent', { color: '#00ff00', offset: true });
    expect(accent.color.getHexString()).toBe('00ff00');
    expect(accent.polygonOffset).toBe(true);
    const shaded = createFinishMaterial('shaded', { shade: { shadeMin: 0.1 }, whiteHub: true, radius: 2 });
    const iso = shaded.userData.iso as IsoUniforms;
    expect(iso.uShadeMin.value).toBe(0.1);
    expect(iso.uShadeMax.value).toBe(0.92);
    expect(iso.uWhiteHub.value).toBe(1);
    expect(iso.uRadius.value).toBe(2);
  });
});
