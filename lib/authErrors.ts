// What a failed Google sign-in should actually tell the person.
//
// Firebase reports precisely why sign-in failed, and the landing page used to
// throw that away in a bare `catch`, showing "Sign-in failed. Please try again."
// for everything. A doctor whose popup was blocked, an owner clicking through a
// preview on an unauthorised domain, and someone with no internet all saw the
// same sentence — and "try again" is useless advice for two of the three.
//
// Pure, so the mapping can be tested without a browser or a Firebase project.

/**
 * The message to show, or `null` when nothing should be shown at all.
 *
 * Returning null matters: closing the Google popup is a decision, not a
 * failure, and painting a red error over a deliberate cancel makes the app look
 * broken when it did exactly what was asked.
 */
export function signInErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null

    case 'auth/unauthorized-domain':
      // Nearly always a preview deployment. Firebase only runs Google OAuth
      // from hostnames on its Authorized domains list, and Vercel gives every
      // branch its own. Naming the console turns a mystery into a 30-second fix.
      return 'This address is not authorised for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains, then reload.'

    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow popups for this site and try again.'

    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection and try again.'

    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.'

    case 'auth/operation-not-allowed':
      return 'Google sign-in is not enabled for this project. Turn it on in Firebase Console → Authentication → Sign-in method.'

    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email under a different sign-in method.'

    default:
      // The code is carried through rather than swallowed. It is the difference
      // between a support thread and a search that finds the answer.
      return code
        ? `Sign-in failed (${code}). Please try again.`
        : 'Sign-in failed. Please try again.'
  }
}
