/**
 * Conveyor belt motion. `AnimationRunner` writes this onto the named
 * `belt-stripe` child each frame from `userData.uvOffsetRate`.
 */

export interface BeltStripeObject {
  position: { x: number };
}

export interface BeltStripeHost {
  userData?: { uvOffsetRate?: unknown };
  traverse?: (cb: (child: { userData?: { uvOffsetRate?: unknown } }) => void) => void;
  getObjectByName: (name: string) => BeltStripeObject | null | undefined;
}

/** Stripe local X for elapsed seconds and UV offset rate. */
export function beltStripePositionX(elapsedTime: number, rate: number): number {
  return ((elapsedTime * rate) % 2) - 1;
}

export function resolveUvOffsetRate(object: BeltStripeHost): number | undefined {
  if (typeof object.userData?.uvOffsetRate === 'number') {
    return object.userData.uvOffsetRate;
  }
  let found: number | undefined;
  object.traverse?.((child) => {
    if (typeof child.userData?.uvOffsetRate === 'number') {
      found = child.userData.uvOffsetRate;
    }
  });
  return found;
}

/**
 * Mutates `belt-stripe`.position.x from `uvOffsetRate`.
 * Returns the written X, or undefined when there is no moving belt.
 */
export function applyBeltStripe(
  object: BeltStripeHost,
  elapsedTime: number,
): number | undefined {
  const rate = resolveUvOffsetRate(object);
  if (typeof rate !== 'number' || rate === 0) {
    return undefined;
  }
  const stripe = object.getObjectByName('belt-stripe');
  if (!stripe) {
    return undefined;
  }
  stripe.position.x = beltStripePositionX(elapsedTime, rate);
  return stripe.position.x;
}
