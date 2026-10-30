/**
 * Public API compatibility with main (review of #228, second round). `Tank`
 * and `TankParams` are exported from the package root, so params objects that
 * compiled against main must still compile. `pnpm type-check` (tsc over the
 * test files too) is the real assertion here: it fails with TS2353 when a
 * field main accepted disappears from `TankParams`.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { mergeTankParams, Tank, type TankParams } from './index';
import { tankLinePlan } from '../assets/process/tank-lines';

/** Every TankParams field main had that this PR stopped using: still accepted, ignored. */
const mainOnly: Partial<TankParams> = { bodyRings: 0, bodyRingWidth: 0.004 };

describe('TankParams: fields removed in #228 still compile (deprecated no-ops)', () => {
  it('bodyRings / bodyRingWidth are optional number fields', () => {
    expectTypeOf<TankParams['bodyRings']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TankParams['bodyRingWidth']>().toEqualTypeOf<number | undefined>();
    // The Tank component still takes them in `params`.
    expectTypeOf<Parameters<typeof Tank>[0]['params']>().toMatchTypeOf<Partial<TankParams> | undefined>();
  });

  it('they change nothing: interior hoops stay removed', () => {
    const p = mergeTankParams({});
    const withOld = mergeTankParams({ ...mainOnly, bodyRings: 3 });
    expect(JSON.stringify(tankLinePlan(withOld, withOld.top, 3, 1, 0.5))).toBe(JSON.stringify(tankLinePlan(p, p.top, 3, 1, 0.5)));
  });
});
