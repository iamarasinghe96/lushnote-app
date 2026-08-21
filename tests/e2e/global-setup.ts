import { chromium, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const STORAGE_STATE = 'tests/e2e/.auth/bypass.json'

/**
 * Gets past Vercel's preview protection ONCE, as a cookie.
 *
 * The obvious approach — put the bypass secret in `extraHTTPHeaders` — is
 * wrong, and quietly so. Playwright applies those headers to EVERY request the
 * browser makes, not just ones to the preview. The Firebase sign-in call goes
 * to identitytoolkit.googleapis.com, and a custom header on a cross-origin
 * request forces a CORS preflight that Google does not allow, so the call is
 * blocked and Firebase reports `auth/network-request-failed`. The preview
 * loaded fine; only sign-in broke, which made it look like bad credentials.
 *
 * Vercel's documented alternative is to pass the secret as query parameters on
 * one navigation and let it set a cookie. A cookie is same-origin by
 * construction, so nothing leaks to Google — or to any other host the app
 * talks to.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  const baseURL = config.projects[0]?.use?.baseURL

  mkdirSync(dirname(STORAGE_STATE), { recursive: true })

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    // No secret (running locally, or protection is off) means there is nothing
    // to bypass — still write the file, so the config can point at it
    // unconditionally rather than branching on whether setup ran.
    if (secret && baseURL) {
      const page = await context.newPage()
      const url = new URL(baseURL)
      url.searchParams.set('x-vercel-protection-bypass', secret)
      url.searchParams.set('x-vercel-set-bypass-cookie', 'true')
      await page.goto(url.toString(), { waitUntil: 'domcontentloaded' })
      await page.close()
    }
    await context.storageState({ path: STORAGE_STATE })
  } finally {
    await browser.close()
  }
}
