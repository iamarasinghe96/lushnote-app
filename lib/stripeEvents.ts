// How a Stripe event finds the doctor it concerns.
//
// Split out of the webhook route so it can be tested without firebase-admin or
// a Stripe key: these two functions are where a delivery goes wrong silently —
// a shape they don't recognise returns null, the handler falls through, and the
// projection never updates. Every payload shape below is one Stripe actually
// sends.

/** The subscription this event concerns, however it happens to carry it. */
export function subscriptionIdOf(object: Record<string, unknown>): string | null {
  const sub = object.subscription
  if (typeof sub === 'string') return sub
  if (sub && typeof sub === 'object' && 'id' in sub) return String((sub as { id: string }).id)
  // A subscription event's own object IS the subscription.
  if (object.object === 'subscription' && typeof object.id === 'string') return object.id
  return null
}

export function customerIdOf(object: Record<string, unknown>): string | null {
  const c = object.customer
  if (typeof c === 'string') return c
  if (c && typeof c === 'object' && 'id' in c) return String((c as { id: string }).id)
  return null
}

/** What a BECS mandate status means for access. Anything not live and not
 *  still settling counts as nothing on file. */
export function mandateStatusToPaymentStatus(status: string): 'active' | 'pending' | 'none' {
  return status === 'active' ? 'active' : status === 'pending' ? 'pending' : 'none'
}
