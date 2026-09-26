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

test('landing page shows the hero, the price and the way in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Built to save doctors', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Clinical notes in seconds' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Three months free\. Then .*\$30/ })).toBeVisible()
  await expect(page.getByText(/No payment details to start/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign Up Free' })).toBeVisible()
  // The liquid-glass pill is the landing page's design. It was once replaced
  // by a plain header in passing, and nothing noticed until the owner did.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveAttribute('data-glass')
})

// Google showed the site with no title and no description because the old
// landing page rendered a spinner on the server and its content only in the
// browser. This reads the raw HTML, before any JavaScript, as a crawler does.
test('the landing page content is in the server HTML', async ({ request }) => {
  const html = await (await request.get('/')).text()
  expect(html).toContain('<title>LushNote - AI clinical notes for doctors</title>')
  expect(html).toContain('Turn consultations into clinical notes')
  expect(html).toContain('Clinical notes in seconds')
  expect(html).toContain('Built to save doctors')
  expect(html).toContain('"@type":"Organization"')
})

test('pricing page shows the price', async ({ page }) => {
  await page.goto('/pricing')
  await expect(page.getByRole('heading', { level: 1, name: 'Pricing' })).toBeVisible()
  await expect(page.getByText('A$30/month', { exact: true })).toBeVisible()
})

test('every public page is reachable from the header or footer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  for (const [name, path] of [['How it works', '/how-it-works'], ['Pricing', '/pricing'], ['Security', '/security'], ['About', '/about'], ['Contact', '/contact']]) {
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })).toHaveAttribute('href', path)
  }
  for (const [name, path] of [['Privacy', '/privacy'], ['Terms', '/terms'], ['Security', '/security'], ['Contact', '/contact']]) {
    await expect(page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name, exact: true })).toHaveAttribute('href', path)
  }
})

test('the app is never offered to search engines', async ({ request }) => {
  const res = await request.get('/app/generate')
  expect(res.headers()['x-robots-tag']).toContain('noindex')
  expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow"/>')
})

test('an old app address still lands in the app', async ({ page }) => {
  // Bookmarks, installed home-screen apps, emails and Stripe return URLs all
  // carry the paths from before the app moved under /app.
  await page.goto('/settings?tab=profile')
  await expect(page).toHaveURL(/\/login$/)
})

test('terms and privacy policy is reachable and complete', async ({ page }) => {
  await page.goto('/terms')
  await expect(page.getByRole('heading', { name: 'Terms of Service and Privacy Policy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Common Questions' })).toBeVisible()
})

test('billing page sends a signed-out visitor to log in', async ({ page }) => {
  // /app/billing lives outside the (shell) group so a lapsed doctor can reach it.
  // Signed out, it must not render billing state to nobody.
  await page.goto('/app/billing')
  await expect(page).toHaveURL(/\/login$/)
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
