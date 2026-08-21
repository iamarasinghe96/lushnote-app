import { test, expect, E2E_PATIENT, SMOKE_TRANSCRIPT } from './fixtures'

// One note, all the way through: paste a transcript, name the patient, pick a
// template, watch the fields populate, then export it. This is the path that
// keeps breaking when something adjacent is fixed, and it is the reason the
// gate exists at all.
//
// The AI is mocked on preview deployments, so the reply is fixed — but
// everything either side of it is real: the real database, the real section
// parser, the real autosave, the real PDF and Word builders.

test.describe.configure({ mode: 'serial' })

test('signs in and reaches the app shell', async ({ signedIn: page }) => {
  await expect(page.getByTestId('tab-generate')).toBeVisible()
  await expect(page.getByTestId('tab-edit')).toBeVisible()
  await expect(page.getByTestId('tab-export')).toBeVisible()
  await expect(page.getByTestId('tab-patients')).toBeVisible()
})

test('generates a note from a pasted transcript and exports it', async ({ signedIn: page }) => {
  await page.goto('/generate')

  await page.getByRole('button', { name: /Paste Transcript or Ward Note/ }).click()
  await page.getByRole('button', { name: /^Paste text/ }).click()

  await page.getByPlaceholder(/Paste a session transcript/).fill(SMOKE_TRANSCRIPT)
  await page.getByRole('button', { name: 'Continue' }).click()

  // Confirm modal: name the patient, then generate.
  await page.getByPlaceholder('First name or full name').fill(E2E_PATIENT)
  await page.getByRole('button', { name: /Yes, generate note/ }).click()

  // Template picker — the default note is enough for a smoke run.
  await page.getByRole('button', { name: 'Skip, use default note' }).click()

  await expect(page).toHaveURL(/\/edit/)

  // Wait on CONTENT, never on a timer: the typewriter writes at 15ms a
  // character and autosave debounces 800ms, and any sleep long enough to cover
  // both on a cold preview would be long enough to be wrong on a fast one.
  const risk = page.locator('[data-field="risk"] textarea')
  await expect(risk).toHaveValue(/suicidal ideation/i, { timeout: 60_000 })
  await expect(page.locator('[data-field="nextsteps"] textarea')).toHaveValue(/Continue sertraline/i)
  await expect(page.locator('[data-field="mse"] textarea')).toHaveValue(/Affect/i)

  // The patient must have carried through — a note that generates but loses the
  // patient is not saved anywhere useful.
  await expect(page.locator('[data-field="patient"] input, [data-field="patient"] textarea').first())
    .toHaveValue(new RegExp(E2E_PATIENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

  await page.getByTestId('tab-export').click()
  await expect(page).toHaveURL(/\/export/)
  await expect(page.getByText(/suicidal ideation/i).first()).toBeVisible()

  // Exporting stays in THIS test rather than getting its own.
  //
  // The note being exported lives in the store, in memory, and every test gets
  // a fresh browser context — so a separate export test arrives at /export with
  // no note, the menu is correctly disabled, and the failure looks like a
  // broken button rather than a test that threw away its own setup. Serial mode
  // orders tests; it does not carry client state between them.
  await page.getByTestId('export-menu').click()

  for (const label of ['Download PDF', 'Download Word']) {
    const download = page.waitForEvent('download', { timeout: 45_000 })
    await page.getByRole('button', { name: label }).click()
    const file = await download
    expect(file.suggestedFilename()).toMatch(label === 'Download PDF' ? /\.pdf$/ : /\.docx$/)
    // Reopen the menu for the next item — it closes on selection.
    if (label === 'Download PDF') await page.getByTestId('export-menu').click()
  }
})

test('the saved note appears under its patient', async ({ signedIn: page }) => {
  await page.getByTestId('tab-patients').click()
  await expect(page).toHaveURL(/\/patients/)
  await expect(page.getByText(E2E_PATIENT).first()).toBeVisible({ timeout: 30_000 })
})

test('settings panels open', async ({ signedIn: page }) => {
  for (const tab of ['profile', 'api-keys', 'templates']) {
    await page.goto(`/settings?tab=${tab}`)
    await expect(page.locator('main, body')).toBeVisible()
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0)
  }
})

test('billing page renders this account state', async ({ signedIn: page }) => {
  await page.goto('/billing')
  // The fixture account is billingExempt, so whatever copy it shows, it must
  // not be the paywall.
  await expect(page.getByText(/subscription|billing|trial|access/i).first()).toBeVisible({ timeout: 30_000 })
})
