// Who may open the admin console, and who may decide that.
//
// The OWNER is the account named by ADMIN_UID (NEXT_PUBLIC_ADMIN_UID in the
// browser). It is set in Vercel, so it cannot be granted, revoked or locked out
// from inside the app. Anyone else is an admin only while their Firebase account
// carries the `admin: true` custom claim, which the owner grants and revokes from
// Users. Only the owner can do that: an admin who could mint admins could also
// keep themselves one after the owner revoked them.
//
// Pure on purpose: the server gate (lib/adminGuard.ts), the browser gate
// (hooks/useIsAdmin.ts) and the tests all ask the same question here.

export function isOwner(uid: string | null | undefined, ownerUid: string | null | undefined): boolean {
  return !!uid && !!ownerUid && uid === ownerUid
}

export function hasAdminAccess(
  uid: string | null | undefined,
  claims: Record<string, unknown> | null | undefined,
  ownerUid: string | null | undefined,
): boolean {
  return isOwner(uid, ownerUid) || claims?.admin === true
}

/**
 * Why a grant or revoke must be refused, or null when it may go ahead.
 * Copy is shown in the admin console.
 */
export function adminChangeRefusal(actorUid: string, targetUid: string, ownerUid: string | null | undefined): string | null {
  if (!isOwner(actorUid, ownerUid)) return 'Only the owner can change who has admin access.'
  if (targetUid === actorUid) return 'The owner is always an admin. That is set in Vercel, not here.'
  return null
}
