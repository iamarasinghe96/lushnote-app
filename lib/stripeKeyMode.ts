// Which mode a Stripe key belongs to, and whether two of them agree.
//
// A price, a key and a client secret each belong to ONE mode, and mixing them
// fails in a way that looks like nothing happening: Stripe.js loads, Elements
// mounts, and the Payment Element renders an empty box with the real complaint
// only in the browser console. The doctor sees a form that cannot be submitted
// and no reason why.
//
// Diagnosing that from the outside cost a working afternoon, so the check is
// here and its answer is shown on the page.

export type StripeKeyMode = 'live' | 'test' | 'unknown'

export function publishableKeyMode(key: string | undefined | null): StripeKeyMode {
  const k = (key ?? '').trim()
  if (k.startsWith('pk_live_')) return 'live'
  if (k.startsWith('pk_test_')) return 'test'
  return 'unknown'
}

/**
 * What to tell the doctor when the browser's key and the server's key disagree,
 * or null when there is nothing wrong.
 *
 * `unknown` on either side is NOT reported as a mismatch: a missing key is a
 * different fault with a different fix, and it already has its own message.
 * Claiming a mismatch there would send somebody to change the wrong variable.
 */
export function keyModeMismatch(
  publishable: string | undefined | null,
  serverMode: string | undefined | null,
): string | null {
  const client = publishableKeyMode(publishable)
  const server = serverMode === 'live' || serverMode === 'test' ? serverMode : 'unknown'

  if (client === 'unknown' || server === 'unknown') return null
  if (client === server) return null

  return `Your Stripe keys are mixed: the browser key is ${client} mode and the server key is ${server} mode. `
    + `A key, a price and a payment form all belong to one mode, so nothing will load until both match.`
}
