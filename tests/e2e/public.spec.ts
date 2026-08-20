import { test, expect } from '@playwright/test'

// The pages a signed-out visitor sees. These need no fixture account and no
// Firebase credentials, so they run anywhere — including a local checkout with
// no .env.local — and they are the fastest signal that a deployment is alive
// at all rather than serving a build error.

test('the deployment reports which commit it is running', async ({ request }) => {
  const res = await request.get('/api/version')
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  expect(typeof body.sha).toBe('string')
  expect(body.sha.length).toBeGreaterThan(0)
})

test('landing page shows the hero and the price', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Clinical notes in seconds' })).toBeVisible()
  // The price is fetched, so it starts at the default and may be replaced. Both
  // readings are the same offer; what must never happen is the section rendering
  // without a price at all.
  await expect(page.getByRole('heading', { name: /Three months free\. Then .*\$30/ })).toBeVisible()
  await expect(page.getByText(/No payment details to start/)).toBeVisible()
})

test('terms and privacy policy is reachable and complete', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Terms of Service and Privacy Policy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Common Questions' })).toBeVisible()
})

test('billing page sends a signed-out visitor back to the landing page', async ({ page }) => {
  // /billing lives outside the (app) group so a lapsed doctor can reach it.
  // Signed out, it must not render billing state to nobody.
  await page.goto('/billing')
  await expect(page).toHaveURL(/\/$/)
})

test('the deployment under test has the preview flags on', async ({ page, baseURL }) => {
  // A precondition, not a feature: without NEXT_PUBLIC_E2E the authed suite
  // below cannot sign in, and it should say so here rather than fail later
  // looking like the app is broken.
  const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
  test.skip(host.endsWith('lushnote.com.au'), 'production is deliberately not flagged')

  await page.goto('/e2e-login')
  await expect(
    page.getByTestId('e2e-login-form'),
    `/e2e-login is absent on ${baseURL} — set NEXT_PUBLIC_E2E=1 on the Vercel Preview environment`,
  ).toBeVisible()
})

test('production never exposes the test sign-in page', async ({ page, baseURL }) => {
  // Only meaningful when the suite is pointed at the live site, which is how a
  // post-promote smoke run would use it.
  const host = new URL(baseURL ?? 'http://127.0.0.1').hostname
  test.skip(!host.endsWith('lushnote.com.au'), 'only checked against production')

  const res = await page.goto('/e2e-login')
  expect(res?.status()).toBe(404)
})
