/**
 * Public type compatibility with main (reviews of #228, rounds 2 and 3).
 * `TankParams`, `HolodeckStyle`, `Finish` and `FinishName` are root exports.
 * `src/compat/main-types.ts` holds main's versions verbatim; `pnpm type-check`
 * (tsc over this file) is the real assertion, in both directions:
 *  - IN: a value typed against main (a complete TankParams, a theme) must be
 *    accepted where today's type is expected;
 *  - OUT: what today's API hands out (mergeTankParams, DEFAULT_TANK_PARAMS,
 *    HOLODECK_STYLE, style.finishes[name]) must still satisfy main's type.
 * The whole-surface check (every export, both directions) is
 * scripts/api-compat.mjs against main's built d.ts; run it before changing
 * public types.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DEFAULT_TANK_PARAMS,
  FINISH_NAMES,
  HOLODECK_STYLE,
  mergeTankParams,
  Tank,
  type Finish,
  type FinishName,
  type HolodeckStyle,
  type TankParams,
} from './index';
import type * as Main from './compat/main-types';
import { tankLinePlan } from '../assets/process/tank-lines';

/** A COMPLETE TankParams as main built it (its DEFAULT_TANK_PARAMS values, typed as main's TankParams). */
const mainComplete: Main.TankParams = { ...(DEFAULT_TANK_PARAMS as Main.TankParams) };

describe('TankParams', () => {
  it('IN: a complete main-shaped TankParams is a TankParams (no newly required fields)', () => {
    expectTypeOf<Main.TankParams>().toMatchTypeOf<TankParams>();
    const asToday: TankParams = mainComplete;
    expect(mergeTankParams(asToday).mixerModel).toBe(false);
  });

  it('OUT: DEFAULT_TANK_PARAMS / mergeTankParams still satisfy main’s TankParams', () => {
    expectTypeOf(DEFAULT_TANK_PARAMS).toMatchTypeOf<Main.TankParams>();
    expectTypeOf(mergeTankParams({})).toMatchTypeOf<Main.TankParams>();
    const back: Main.TankParams = mergeTankParams({});
    expect(back.bodyRings).toBe(0);
  });

  it('Tank takes a main-shaped params object', () => {
    expectTypeOf<Partial<Main.TankParams>>().toMatchTypeOf<NonNullable<Parameters<typeof Tank>[0]['params']>>();
  });

  it('bodyRings / bodyRingWidth are accepted and ignored: interior hoops stay removed', () => {
    const p = mergeTankParams({});
    const withOld = mergeTankParams({ bodyRings: 3, bodyRingWidth: 0.02 });
    expect(JSON.stringify(tankLinePlan(withOld, withOld.top, 3, 1, 0.5))).toBe(JSON.stringify(tankLinePlan(p, p.top, 3, 1, 0.5)));
  });

  it('an optional field left undefined does not erase its default', () => {
    expect(mergeTankParams({ mixerModel: undefined, interiorMeridianStep: undefined }).interiorMeridianStep).toBe(
      DEFAULT_TANK_PARAMS.interiorMeridianStep,
    );
  });
});

describe('HolodeckStyle / Finish / FinishName', () => {
  it('IN: a main-era theme (no liquid finish) is a HolodeckStyle', () => {
    expectTypeOf<Main.HolodeckStyle>().toMatchTypeOf<HolodeckStyle>();
    const { liquid: _liquid, ...shellFinishes } = HOLODECK_STYLE.finishes;
    const mainTheme: Main.HolodeckStyle = { ...HOLODECK_STYLE, finishes: shellFinishes };
    const asToday: HolodeckStyle = mainTheme;
    expect(asToday.finishes.white.kind).toBe('unlit');
  });

  it('OUT: HOLODECK_STYLE is a main HolodeckStyle; style.finishes[FinishName] is a Finish (never undefined)', () => {
    expectTypeOf(HOLODECK_STYLE).toMatchTypeOf<Main.HolodeckStyle>();
    expectTypeOf<HolodeckStyle['finishes'][FinishName]>().toEqualTypeOf<Finish>();
    for (const name of FINISH_NAMES) expect(HOLODECK_STYLE.finishes[name].kind).toMatch(/unlit|iso/);
  });

  it('Finish and FinishName are exactly main’s unions', () => {
    expectTypeOf<Finish>().toEqualTypeOf<Main.Finish>();
    expectTypeOf<FinishName>().toEqualTypeOf<Main.FinishName>();
    expect([...FINISH_NAMES]).toEqual(['white', 'shaded', 'vessel', 'flask', 'accent']);
  });
});
