import { describe, expect, it } from 'vitest';
import { nodeBounds, nodeByName, sceneBounds } from './glb-json';
import { loadModel, worldPosOf } from './brewery-glb';
import { MIXER_GLB, agitatedVesselScale, agitatedVesselTop } from '../../assets/process/agitated-vessel';
import { MIXER_WINDOW_DEG, MIXER_WINDOW_YAW, mergeTankParams } from '../../assets/process/tank-params';
import { MASH_TUN_PRESET, MIXER_BODY_PRESET, TANK_PRESETS } from '../../assets/process/tank-presets';

/** AgitatedVessel maps mixer.glb onto a Tank's radius / wall height; these pin the numbers it relies on. */
describe('agitated vessel = mixer.glb', () => {
  const gltf = loadModel(MIXER_GLB.model);

  it('MIXER_GLB matches the asset: radius, straight wall, apex, top', () => {
    const box = sceneBounds(gltf);
    expect(box.max.y).toBeCloseTo(MIXER_GLB.topY, 2);
    expect(box.min.y).toBeCloseTo(0, 3);
    const band = nodeBounds(gltf, nodeByName(gltf, 'shell.band')!.index);
    // Facets at -5 + 20k deg: the band reaches R on -X / -Z.
    expect(-band.min.x).toBeCloseTo(MIXER_GLB.radius, 2);
    expect(worldPosOf(gltf, 'anim.agitator').y).toBeCloseTo(MIXER_GLB.apexY, 3);
    // Liquid full = up to the head equator (= top of the straight wall).
    const liquid = nodeBounds(gltf, nodeByName(gltf, 'liquid')!.index);
    expect(liquid.max.y).toBeCloseTo(MIXER_GLB.wallHeight, 2);
  });

  it('the cutout the routing clips pipes on is the GLB window (100° centred on the camera)', () => {
    expect(MIXER_WINDOW_DEG).toBe(MIXER_GLB.windowDeg);
    expect(MIXER_WINDOW_YAW).toBe(MIXER_GLB.windowYawDeg);
    expect(MIXER_BODY_PRESET.windowDeg).toBe(MIXER_GLB.windowDeg);
    expect(MIXER_BODY_PRESET.windowYawDeg).toBe(MIXER_GLB.windowYawDeg);
  });

  it('scales radius onto the footprint and the straight wall onto the Tank height', () => {
    const s = agitatedVesselScale(1, 2.5);
    expect(MIXER_GLB.radius * s.xz).toBeCloseTo(1);
    expect(MIXER_GLB.wallHeight * s.y).toBeCloseTo(2.5);
    expect(agitatedVesselTop(2.5)).toBeCloseTo(MIXER_GLB.topY * s.y);
    // Bad params never make the part vanish.
    expect(agitatedVesselScale(0, Number.NaN)).toEqual({ xz: 1, y: 1 });
    expect(agitatedVesselScale(-1, -2)).toEqual({ xz: 1, y: 1 });
  });

  it('the mash tun preset is agitated, stands on the floor, keeps its footprint radius', () => {
    const p = mergeTankParams(MASH_TUN_PRESET.params);
    expect(p.agitator).toBe(true);
    expect(p.support).toBe('none');
    expect(TANK_PRESETS['mash-tun'].radius).toBe(1);
  });
});
