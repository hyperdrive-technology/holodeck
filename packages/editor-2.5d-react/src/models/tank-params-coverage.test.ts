/**
 * Every TankParams key, both bodies (fourth review of #228). For each key one
 * of three things must hold:
 *  - HONOURED on the mixer.glb path: changing it changes what AgitatedVessel
 *    is given (`mixerGlbProps`), so the GLB shows it;
 *  - FALLS BACK: changing it on the mash tun sends the vessel to the
 *    procedural body (`usesMixerModel` false), which reads it as on main;
 *  - a documented NO-OP everywhere (`TANK_PARAMS_NO_OP`: the deprecated body
 *    hoops, and thresholds main never read either).
 * A key added to TankParams without a decision fails here.
 */
import { Group, Mesh, MeshBasicMaterial, BoxGeometry } from 'three';
import type { MeshBasicNodeMaterial } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  MIXER_GLB_HONOURED,
  TANK_PARAMS_NO_OP,
  mixerGlbProps,
  mixerGlbStyle,
  usesMixerModel,
} from '../../assets/process/agitated-vessel';
import { applyHolodeckStyle } from '../../assets/process/apply-style';
import type { IsoUniforms } from '../../assets/process/materials';
import { HOLODECK_STYLE } from '../../assets/process/style';
import { DEFAULT_TANK_PARAMS, mergeTankParams, type TankParams } from '../../assets/process/tank-params';
import { TANK_PRESETS } from '../../assets/process/tank-presets';

const mash = mergeTankParams(TANK_PRESETS['mash-tun'].params);
const geometry = { tankR: 1, tankH: 2.5, floorY: -1.25, level: 0.5, empty: false, color: '#5cc8e6' };

/** A value different from `v` of the same type (enums: another member). */
function changed(key: string, v: unknown): unknown {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v === 0 ? 0.37 : v * 1.37 + 0.01;
  if (key === 'top') return v === 'flat' ? 'cone' : 'flat';
  if (key === 'bottom') return v === 'dish' ? 'cone' : 'dish';
  if (key === 'support') return v === 'legs' ? 'skirt' : 'legs';
  if (key === 'nozzle') return v === 'tangential' ? 'none' : 'tangential';
  if (typeof v === 'string') return v.startsWith('#') ? '#123456' : `${v}-x`;
  throw new Error(`no changed value for ${key}`);
}

const keys = Object.keys(DEFAULT_TANK_PARAMS) as Array<keyof TankParams>;

describe.each(keys)('TankParams.%s', (key) => {
  const override = { [key]: changed(key, mash[key]) } as Partial<TankParams>;

  it('is honoured by mixer.glb, falls back to the procedural body, or is a documented no-op', () => {
    if (key === 'mixerModel') {
      expect(usesMixerModel({ ...mash, ...override })).toBe(false); // the selector itself
      return;
    }
    const p = mergeTankParams({ ...mash, ...override });
    if (TANK_PARAMS_NO_OP.has(key)) {
      expect(MIXER_GLB_HONOURED.has(key)).toBe(false);
      expect(usesMixerModel(p)).toBe(true);
      return;
    }
    if (MIXER_GLB_HONOURED.has(key)) {
      expect(usesMixerModel(p), 'keeps the GLB').toBe(true);
      const base = mixerGlbProps(mash, {}, geometry);
      const next = mixerGlbProps(p, override, { ...geometry, ...geometryOverride(key, override) });
      expect(JSON.stringify(next), `${key} reaches AgitatedVessel`).not.toBe(JSON.stringify(base));
      return;
    }
    expect(usesMixerModel(p), `${key} must fall back`).toBe(false);
  });
});

/** height / radius / fill / fillColor reach AgitatedVessel through Tank's resolved geometry, not params. */
function geometryOverride(key: string, o: Partial<TankParams>): Partial<typeof geometry> {
  if (key === 'radius') return { tankR: o.radius };
  if (key === 'height') return { tankH: o.height };
  if (key === 'fill') return { level: o.fill };
  if (key === 'fillColor') return { color: o.fillColor };
  return {};
}

describe('shading overrides on mixer.glb', () => {
  it('<Mixer params={{ shadeMin, shadeMax, hubWhite }}> reaches the GLB shell materials', () => {
    const shade = { shadeMin: 0.8, shadeMax: 0.9, hubWhite: 0.7 };
    const props = mixerGlbProps(mergeTankParams({ ...mash, ...shade }), shade, geometry);
    expect(props.shade).toEqual(shade);
    const style = mixerGlbStyle(HOLODECK_STYLE, props.shade);
    const root = new Group();
    const material = new MeshBasicMaterial();
    material.name = 'hd.flask';
    const shell = new Mesh(new BoxGeometry(), material);
    root.add(shell);
    applyHolodeckStyle(root, style);
    const iso = (shell.material as unknown as MeshBasicNodeMaterial).userData.iso as IsoUniforms;
    expect(iso.uShadeMin.value).toBe(0.8);
    expect(iso.uShadeMax.value).toBe(0.9);
    expect(iso.uHubWhite.value).toBe(0.7);
  });

  it('without a caller override the GLB keeps the theme flask shading (no style override)', () => {
    expect(mixerGlbProps(mash, {}, geometry).shade).toBeUndefined();
    expect(mixerGlbStyle(HOLODECK_STYLE, undefined)).toBe(HOLODECK_STYLE);
  });
});
