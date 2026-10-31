/**
 * holodeck#239: Tank always forwarded DEFAULT_TANK_PARAMS.liquidOpacity (0.78)
 * as an explicit override, so a theme's `finishes.liquid.opacity` never
 * reached procedural tanks or mixer.glb. The theme seeds the params now; an
 * explicit `liquidOpacity` param still wins.
 */
import { describe, expect, it } from 'vitest';
import { HOLODECK_STYLE, LIQUID_FINISH, type HolodeckStyle } from './style';
import { tankParamsFromStyle } from './Tank';
import { mergeTankParams } from './tank-params';

const faint: HolodeckStyle = { ...HOLODECK_STYLE, finishes: { ...HOLODECK_STYLE.finishes, liquid: { ...LIQUID_FINISH, opacity: 0.2 } } };

describe('tank params from the theme', () => {
  it('the theme liquid opacity reaches the tank', () => {
    expect(mergeTankParams(tankParamsFromStyle(faint)).liquidOpacity).toBe(0.2);
  });
  it('an explicit liquidOpacity param still wins', () => {
    expect(mergeTankParams({ ...tankParamsFromStyle(faint), liquidOpacity: 0.5 }).liquidOpacity).toBe(0.5);
  });
  it('a theme without a liquid finish uses the default token', () => {
    const { liquid: _l, ...shell } = HOLODECK_STYLE.finishes;
    expect(mergeTankParams(tankParamsFromStyle({ ...HOLODECK_STYLE, finishes: shell })).liquidOpacity).toBe(LIQUID_FINISH.opacity);
  });
  it('carries the theme edge / liquid colours and vessel shade', () => {
    expect(tankParamsFromStyle(faint)).toMatchObject({
      edgeColor: faint.colors.edge,
      fillColor: faint.colors.liquid,
      shadeMin: faint.finishes.vessel.shadeMin,
    });
  });
});
