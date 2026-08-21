import { test as base, expect, type Page } from '@playwright/test'

export const E2E_PATIENT = 'E2E-Smoke Patient'

/** Long enough to clear the 80-word floor and clinical enough to clear the
 *  keyword check — both are real gates on the generate page, and a transcript
 *  that dodged them would test a path no doctor takes. */
export const SMOKE_TRANSCRIPT = [
  'The patient attended today for a scheduled review session. They report that their mood has been steadier',
  'over the past fortnight, with fewer of the low days that had been troubling them earlier in the month.',
  'Sleep has improved since the last medication adjustment, and they now describe waking once rather than',
  'three or four times each night. Appetite is back to baseline and their weight has been stable.',
  'They have been taking sertraline one hundred milligrams each morning without any nausea or headache,',
  'and melatonin two milligrams at night. There is no current suicidal ideation, no intent and no plan,',
  'and no thoughts of harm to others. Protective factors include stable housing and a supportive partner.',
  'We reviewed the graded activity plan agreed at the previous appointment and discussed the timeline for a',
  'return to work. The patient asked about how long treatment should continue and we talked through the',
  'evidence for maintaining the current dose. Diagnosis remains a recurrent depressive episode, currently',
  'in partial remission. The plan is to continue the present medication, review again in four weeks, and',
  'contact the clinic sooner if the low mood returns or the sleep disturbance worsens again.',
].join(' ')

export async function signIn(page: Page): Promise<void> {
  const email = process.env.E2E_USER_EMAIL
  const password = process.env.E2E_USER_PASSWORD
  if (!email || !password) throw new Error('E2E_USER_EMAIL and E2E_USER_PASSWORD must be set')

  await page.goto('/e2e-login')
  await page.getByTestId('e2e-email').fill(email)
  await page.getByTestId('e2e-password').fill(password)
  await page.getByTestId('e2e-submit').click()

  // Wait on the shell OR on the form's own error, whichever arrives first.
  //
  // Waiting only for the shell reported "getByTestId('tab-generate') not found"
  // for every possible cause — a disabled Email/Password provider, a stale
  // password, a suspended account — when the page was displaying the exact
  // Firebase reason the whole time. The same swallowed-error bug the landing
  // page had, repeated in the tests that exist to catch such things.
  const shell = page.getByTestId('tab-generate')
  const failure = page.getByTestId('e2e-login-error')

  await Promise.race([
    shell.waitFor({ state: 'visible', timeout: 30_000 }),
    failure.waitFor({ state: 'visible', timeout: 30_000 }),
  ]).catch(() => { /* fall through to the assertions below */ })

  if (await failure.isVisible().catch(() => false)) {
    throw new Error(`/e2e-login rejected the fixture credentials: ${await failure.textContent()}`)
  }

  // The app is only usable once the profile has loaded and the tab bar renders,
  // so the shell — not the URL — is what says sign-in actually worked.
  await expect(shell).toBeVisible({ timeout: 30_000 })
}

export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    // Skip rather than fail when the credentials are absent: a local checkout
    // with no Firebase env can still run the public suite, and a red run there
    // would train everyone to ignore red.
    base.skip(!process.env.E2E_USER_EMAIL, 'E2E_USER_EMAIL not set — authed suite skipped')
    await signIn(page)
    await use(page)
  },
})

export { expect }
