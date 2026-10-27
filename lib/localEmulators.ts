// Local mode: the whole app on a developer's own computer, against Firebase's
// emulators instead of any real project (`npm run dev:local`, see
// LOCAL_DEVELOPMENT.md).
//
// The project id starts with `demo-` on purpose. The emulators treat a demo
// project as one that does not exist in the cloud, so nothing in local mode can
// reach a real database, real sign-in or real storage, even by mistake.
//
// Every switch here is double-locked, the same way the AI mock is: the flag has
// to be set AND the code has to be running somewhere a cloud deployment never
// is. A flag ticked in Vercel by accident therefore does nothing, rather than
// pointing every doctor's browser at a database on localhost.

export const EMULATOR_PROJECT_ID = 'demo-lushnote'
export const EMULATOR_PORTS = { auth: 9099, firestore: 8080, storage: 9199 } as const

/** Browser side: only on the developer's own machine. */
export function clientUsesEmulators(flag: string | undefined, hostname: string): boolean {
  return flag === '1' && (hostname === 'localhost' || hostname === '127.0.0.1')
}

/** Server side: never on Vercel, which sets VERCEL on every deployment. */
export function serverUsesEmulators(env: Record<string, string | undefined>): boolean {
  return env.NEXT_PUBLIC_USE_EMULATORS === '1' && !env.VERCEL
}
