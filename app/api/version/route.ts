import { NextResponse } from 'next/server'

// What is actually running right now. Public and unauthenticated on purpose:
// the Releases panel polls it after a promote to watch production flip from the
// old sha to the new one, and Playwright uses it to confirm it is testing the
// commit it thinks it is. A commit sha reveals nothing — the repo is private
// and the sha is already on every deployment's public metadata.

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    {
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
      // Baked at build time in next.config.mjs. Read at module scope in a route
      // this would be the cold-start time instead, which changes on its own and
      // would make two identical deployments look different.
      builtAt: process.env.BUILT_AT ?? null,
      env: process.env.VERCEL_ENV ?? 'development',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
