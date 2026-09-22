import { describe, expect, it } from 'vitest';
import {
  applyBeltStripe,
  beltStripePositionX,
  resolveUvOffsetRate,
  type BeltStripeHost,
} from './belt-stripe';

function fakeBelt(rate: number): BeltStripeHost & {
  stripe: { position: { x: number } };
} {
  const stripe = { position: { x: 0 } };
  return {
    userData: { uvOffsetRate: rate },
    getObjectByName: (name: string) => (name === 'belt-stripe' ? stripe : undefined),
    stripe,
  };
}

describe('beltStripePositionX', () => {
  it('places the stripe at x=-0.5 after 0.5s at rate 1', () => {
    expect(beltStripePositionX(0.5, 1)).toBe(-0.5);
  });

  it('wraps every two seconds of travel', () => {
    expect(beltStripePositionX(0, 1)).toBe(-1);
    expect(beltStripePositionX(1, 1)).toBe(0);
    expect(beltStripePositionX(2, 1)).toBe(-1);
    expect(beltStripePositionX(2.5, 1)).toBe(-0.5);
  });
});

describe('applyBeltStripe', () => {
  it('writes belt-stripe.position.x from uvOffsetRate (fails if the belt never moves)', () => {
    const object = fakeBelt(1);
    expect(applyBeltStripe(object, 0.5)).toBe(-0.5);
    expect(object.stripe.position.x).toBe(-0.5);
    expect(applyBeltStripe(object, 1)).toBe(0);
    expect(object.stripe.position.x).toBe(0);
  });

  it('reads uvOffsetRate from a child when the group itself has none', () => {
    const stripe = { position: { x: 0 } };
    const object: BeltStripeHost & { stripe: { position: { x: number } } } = {
      userData: {},
      traverse: (cb) => {
        cb({ userData: { uvOffsetRate: 2 } });
      },
      getObjectByName: (name: string) => (name === 'belt-stripe' ? stripe : undefined),
      stripe,
    };
    expect(resolveUvOffsetRate(object)).toBe(2);
    expect(applyBeltStripe(object, 0.5)).toBe(0);
    expect(stripe.position.x).toBe(0);
  });

  it('does not invent motion when belt-stripe is missing', () => {
    const object: BeltStripeHost = {
      userData: { uvOffsetRate: 1 },
      getObjectByName: () => undefined,
    };
    expect(applyBeltStripe(object, 0.5)).toBeUndefined();
  });
});
