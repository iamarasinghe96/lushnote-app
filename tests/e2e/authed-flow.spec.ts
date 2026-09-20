import type { Page } from '@playwright/test'
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

// Record now opens the microphone on the tap, so the context has to grant it or
// Playwright answers the request with a denial and the screen reports that
// instead of recording. The fake capture device comes from the launch arguments
// in playwright.config.ts. Nothing else in this file touches getUserMedia.
test.use({ permissions: ['microphone'] })

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

// The capture tray, from BOTH places it can be pressed.
//
// Scan shipped dead on the Generate tab: `router.push('/generate?capture=…')`
// while already on /generate changes the URL without remounting the page, so
// the mount effect that opens the modal never ran. Nothing failed, nothing
// logged — the button simply did nothing, and only on the tab a doctor is most
// likely to be looking at.
//
// No unit test can see that. It is browser navigation behaviour, which is
// exactly what this suite exists for. Both cases are asserted because they take
// different code paths: the event for a page already mounted, the query
// parameter for a fresh one. Record used to carry that pair; it now opens in
// place from anywhere, so Scan carries it and Record pins the new behaviour.

interface RecordingWrites {
  uploads: () => number
  transcribes: () => number
}

/**
 * Counts what a cancelled recording tries to persist, and stops it persisting.
 *
 * This is the assertion for a bug that reached a real doctor: Cancel called the
 * recorder's stop(), which FLUSHES the audio in hand — uploading it, sending it
 * to be transcribed and writing a recovery draft. Two seconds of a mis-tap came
 * back as an "Unnamed patient · UNFINISHED" row holding a couple of words,
 * under a button whose own label says the recording is discarded entirely.
 * Cancel now calls abort(), which drops that tail.
 *
 * Both calls are counted rather than merely blocked: the old path made them, the
 * fixed path makes neither.
 *
 * Both are also refused, so that a REGRESSION cannot leave an unfinished row in
 * the account every other spec signs into. Not to save money — the AI is already
 * mocked for this account (lib/e2eMock.ts).
 */
function watchRecordingWrites(page: Page): RecordingWrites {
  let uploads = 0
  let transcribes = 0

  // Predicates, not globs. A glob that fails to match fails SILENTLY, and it
  // would fail in the direction that hides the bug — leaving the counters at
  // zero for the wrong reason. Two local runs went that way before this.
  //
  // The UPLOAD is the assertion that carries weight. drainQueue uploads the
  // audio before it transcribes, so the upload is the first thing a flushed
  // recording does; the transcribe sits behind it and is counted as well only
  // because it is the call that turns audio into the words on the row.
  void page.route(url => url.hostname === 'firebasestorage.googleapis.com', route => {
    uploads++
    // 403, not abort(). An aborted upload is a NETWORK error, and the Firebase
    // Storage SDK retries those for two minutes before giving up — so a
    // regression would sit in that retry loop, quietly, well past the end of
    // the run. A 403 is refused immediately.
    return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":{"message":"blocked by the test suite"}}' })
  })
  void page.route(url => url.pathname === '/api/transcribe', route => { transcribes++; return route.abort() })

  return { uploads: () => uploads, transcribes: () => transcribes }
}

/**
 * Cancel writes nothing.
 *
 * A timer, which the rest of this suite does not use — every other wait here is
 * on content. Proving an ABSENCE is the one case that cannot be: there is no
 * element that appears to say "no draft was written". It cannot produce a false
 * failure either, only a missed regression if the drain were ever slower than
 * this, so the cost is the four seconds.
 */
async function expectNothingPersisted(page: Page, writes: RecordingWrites): Promise<void> {
  await page.waitForTimeout(4000)
  expect(writes.uploads(), 'a cancelled recording uploaded its audio').toBe(0)
  expect(writes.transcribes(), 'a cancelled recording sent audio to be transcribed').toBe(0)
}

/** The recording screen is up and the microphone is genuinely open. */
async function expectRecording(page: Page): Promise<void> {
  // The modal that used to stand between the tap and the microphone. Its
  // absence IS the feature, so it is asserted rather than assumed.
  await expect(page.getByRole('heading', { name: 'Record Session' })).toHaveCount(0)
  await expect(page.getByText(/Confirm the patient has agreed/i)).toBeVisible()
  // This line renders only once getUserMedia has resolved and the recorder has
  // started, which is what makes it worth asserting: it proves the microphone
  // opened, without depending on a timer that could flake.
  await expect(page.getByText('Recording. Speak normally.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop recording and write the note' })).toBeVisible()
}

test('the record button starts recording on the Generate tab', async ({ signedIn: page }) => {
  const writes = watchRecordingWrites(page)
  await page.goto('/generate')
  await page.getByRole('button', { name: 'Open capture menu' }).click()
  await page.getByRole('button', { name: 'Record a session' }).click()
  await expectRecording(page)

  await page.getByRole('button', { name: 'Cancel recording and discard it' }).click()
  await expect(page.getByText(/Confirm the patient has agreed/i)).toHaveCount(0)
  await expectNothingPersisted(page, writes)
})

test('the record button starts recording from another tab without navigating', async ({ signedIn: page }) => {
  // The behaviour change: Record no longer travels to /generate to find a modal.
  // A doctor reaching for it from the patient list records where they stand.
  const writes = watchRecordingWrites(page)
  await page.goto('/history')
  await page.getByRole('button', { name: 'Open capture menu' }).click()
  await page.getByRole('button', { name: 'Record a session' }).click()
  await expectRecording(page)
  await expect(page).toHaveURL(/\/history/)

  await page.getByRole('button', { name: 'Cancel recording and discard it' }).click()
  await expect(page.getByText(/Confirm the patient has agreed/i)).toHaveCount(0)
  await expectNothingPersisted(page, writes)
})

test('the capture button opens the scan modal from the Generate tab', async ({ signedIn: page }) => {
  await page.goto('/generate')
  await page.getByRole('button', { name: 'Open capture menu' }).click()
  await page.getByRole('button', { name: /^Capture a note/ }).click()
  await expect(page.getByRole('heading', { name: 'Scan a ward note' })).toBeVisible()
})

test('the capture button opens the scan modal from another tab', async ({ signedIn: page }) => {
  // The path that always worked — arriving from elsewhere mounts the page, so
  // the `?capture=` parameter is what carries the intent. Pinned so a fix for
  // the same-route case cannot quietly break this one.
  await page.goto('/history')
  await page.getByRole('button', { name: 'Open capture menu' }).click()
  await page.getByRole('button', { name: /^Capture a note/ }).click()
  await expect(page).toHaveURL(/\/generate/)
  await expect(page.getByRole('heading', { name: 'Scan a ward note' })).toBeVisible()
  // The parameter is dropped, so a refresh cannot reopen the modal over a
  // capture already finished.
  await expect(page).toHaveURL(/\/generate$/)
})
