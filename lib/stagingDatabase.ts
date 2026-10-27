// Whether staging is on its own Firebase project or on the live one.
//
// Staging used to share the live database, so every review click and every
// browser-suite run wrote into the same place doctors' patients live. It now
// has a project of its own, and the only thing keeping it there is which
// Vercel boxes are ticked against six variables. One mis-tick quietly points
// staging back at live, so the Releases panel asks both deployments which
// project they use and says so.
//
// Both readings come from the deployments themselves (/api/version), never
// from the environment of whichever deployment is rendering the panel: the
// panel runs on staging too, and there its own project IS the staging one.

export type StagingDatabase =
  | { state: 'separate'; staging: string; live: string }
  | { state: 'shared'; project: string }
  /** No staging URL configured, or a deployment too old to say, or
   *  unreachable. Not reported as a fault: there is nothing to act on. */
  | { state: 'unknown' }

export function stagingDatabase(liveProject: string | null | undefined, stagingProject: string | null | undefined): StagingDatabase {
  const live = (liveProject ?? '').trim()
  const staging = (stagingProject ?? '').trim()
  if (!live || !staging) return { state: 'unknown' }
  if (live === staging) return { state: 'shared', project: live }
  return { state: 'separate', staging, live }
}

/**
 * Whether the test account should be provisioned from THIS deployment.
 *
 * The browser suite signs in on preview deployments, so the account has to
 * exist in whichever project staging uses. Once staging is separate, pressing
 * Provision on the live console would create an account in the live project
 * that nothing ever signs in with, and the suite would keep failing.
 */
export function provisionHere(db: StagingDatabase, thisProject: string | null | undefined): boolean {
  if (db.state !== 'separate') return true
  return (thisProject ?? '').trim() === db.staging
}
