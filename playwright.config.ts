import { defineConfig, devices } from '@playwright/test'

// The suite runs against a URL, never against infrastructure it starts itself:
// in CI that URL is the Vercel Preview deployment for the pull request, which
// is the real app on the real database, built the same way production is. That
// is what makes a green run mean something. Locally, with no BASE_URL, it
// starts a dev server with the two preview flags so the same specs can be run
// before pushing.

const BASE_URL = process.env.BASE_URL

export default defineConfig({
  testDir: './tests/e2e',
  // Every wait in these specs is on content, never on a timer, so a slow
  // preview cold start costs seconds rather than a false failure.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry, and one only. More would hide a test that fails half the time,
  // which is the failure mode a release gate can least afford.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list']],
  globalTeardown: './tests/e2e/global-teardown.ts',
  use: {
    baseURL: BASE_URL || 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Vercel auth-walls preview deployments on some plans. When that is on, the
    // bypass secret is the supported way through; when it is off this header is
    // simply ignored.
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' }
      : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_E2E: '1', E2E_MOCK_AI: '1' },
  },
})
