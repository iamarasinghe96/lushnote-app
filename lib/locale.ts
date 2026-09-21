// Where the doctor is, for the few decisions that turn on it.
//
// Deliberately NOT an IP lookup. That means a third-party call on the billing
// page, it is wrong behind a VPN, and it would turn a default tab into a
// location request. The device's own time zone is set by the person using it,
// costs nothing, asks no permission and is not stored anywhere.
//
// Pure, with both readings injectable, so it can be tested without a browser.

/** The browser's IANA time zone, or '' when the platform will not say. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

/**
 * Is this device in Australia?
 *
 * The time zone is the primary signal - `Australia/…` covers every state and
 * territory. The language tag is the fallback for a browser reporting a zone we
 * cannot read, and is only trusted when it names AU outright.
 */
export function inAustralia(
  timeZone: string = browserTimeZone(),
  language: string = typeof navigator === 'undefined' ? '' : navigator.language,
): boolean {
  if (timeZone.startsWith('Australia/')) return true
  return /-AU$/i.test(language ?? '')
}
