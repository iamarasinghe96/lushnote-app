import { chromium, type FullConfig } from '@playwright/test'
import { signIn, E2E_PATIENT } from './fixtures'

// Removes the patient this run created, through the app's own Delete Patient
// flow — the same path a doctor uses, which also means the delete path is
// exercised rather than bypassed with a direct write.
//
// Never throws. A failed cleanup leaves clutter inside one exempt fixture
// account; a failed cleanup that turned the run red would train everyone to
// ignore red, which costs far more.
export default async function globalTeardown(config: FullConfig): Promise<void> {
  if (!process.env.E2E_USER_EMAIL || !process.env.E2E_USER_PASSWORD) return

  const baseURL = config.projects[0]?.use?.baseURL
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET, 'x-vercel-set-bypass-cookie': 'true' }
        : {},
    })
    const page = await context.newPage()
    await signIn(page)
    await page.goto('/patients')

    const row = page.getByText(E2E_PATIENT).first()
    if (await row.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await row.click()
      await page.getByRole('button', { name: 'Delete', exact: true }).first().click()
      await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
      await page.getByText(E2E_PATIENT).first().waitFor({ state: 'detached', timeout: 20_000 })
    }
  } catch (err) {
    process.stdout.write(`[teardown] could not remove ${E2E_PATIENT}: ${err instanceof Error ? err.message : String(err)}\n`)
  } finally {
    await browser.close()
  }
}
