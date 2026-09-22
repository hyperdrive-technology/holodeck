export const BELT_STRIPE_WRAP = 2;

export interface BeltStripeObject {
  position: { x: number };
}

export interface BeltStripeHost {
  userData?: { uvOffsetRate?: unknown };
  traverse?: (cb: (child: { userData?: { uvOffsetRate?: unknown } }) => void) => void;
  getObjectByName: (name: string) => BeltStripeObject | null | undefined;
}

function wrapTravel(travel: number): number {
  return ((travel % BELT_STRIPE_WRAP) + BELT_STRIPE_WRAP) % BELT_STRIPE_WRAP;
}

export function beltStripePositionX(elapsedTime: number, rate: number): number {
  return wrapTravel(elapsedTime * rate) - BELT_STRIPE_WRAP / 2;
}

export function resolveUvOffsetRate(object: BeltStripeHost): number | undefined {
  let found: number | undefined;
  if (typeof object.userData?.uvOffsetRate === 'number') {
    found = object.userData.uvOffsetRate;
  }
  object.traverse?.((child) => {
    if (typeof child.userData?.uvOffsetRate === 'number') {
      found = child.userData.uvOffsetRate;
    }
  });
  return found;
}

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
