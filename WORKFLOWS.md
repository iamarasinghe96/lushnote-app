# LushNote workflows — the regression contract

Every user-facing pathway, what it must produce, and what protects it.

A workflow listed here is a promise to a doctor. Changing code that serves one
without checking its expected outputs is how a working feature breaks while a
different one is being fixed — which has happened, in production, more than
once. Add a row before adding a feature.

**Status legend:** ✅ covered by an automated check · ⚠️ partially covered ·
❌ no automated coverage

---

## `signup` — Sign up and onboarding

**Entry:** landing page → **Sign Up Free**
**Ends at:** `/generate`, signed in, with a complete profile in Firestore
**Code:** `app/page.tsx` → `components/AuthProvider.tsx` → `app/onboarding/page.tsx`
**Coverage:** ⚠️ — the Firestore write is pinned by `tests/rules/users.rules.test.ts`;
the six-step UI itself has no browser spec yet

### The pathway

| # | Step | What the doctor does | What the code does | Required to continue |
|---|---|---|---|---|
| 0 | Sign in | Clicks **Sign Up Free**, picks a Google account, confirms | `signInWithPopup` (`AuthProvider.tsx:69`). Google popup only — there is no email/password path in the product. `ensureProfileStub` then writes `users/{uid}` with `onboardingComplete: false`, so an abandoned signup still leaves a record | a Google account |
| 1 | About you | Full name, Credentials, Position/Title, Provider No., Work phone | Held in local state; nothing is written yet | **Full name only.** The other four are optional |
| 2 | Your workplace | Workplace name (autocomplete, or a custom name not in the list), institution type, and whether the institution has a patient registration system | `HospitalAutocomplete`. If **yes**, `detectIdPattern(example)` tokenises the sample ID into alpha/digit/separator runs and stores `regPattern` + `regTemplate`, which is what later warns a doctor who types a malformed number. If **no**, LushNote's own `YYYYMMDDNNN` numbering is used | **Workplace name only.** Registration system defaults to none |
| 3 | Email template | Picks one of three presets, or **Custom** and writes their own | Saved as `emailPretext` on the profile and used as the default cover letter for every export | nothing — skippable |
| 4 | AI keys | Follows the link, returns with a Gemini key, pastes it; same for Groq | **Two separate inputs.** Both run through `sanitizeApiKey`. Stored on the profile and mirrored into `sessionStorage` at sign-in | nothing — skippable, addable later in Settings |
| 5 | Signature | Clicks or drags an image from the gallery (the picker differs on mobile and desktop) | Background removal is **client-side**: adaptive local thresholding (Bradley–Roth integral image) separates ink from paper under uneven phone lighting, then the result is emitted as a real **SVG** of run-length rects and uploaded by `uploadSignatureSVG`. No server round-trip, and no photo is stored | nothing — skippable |
| 6 | Review | Checks every value, ticks the terms box, optionally ticks marketing, clicks **Get started** | `createProfile` merges the whole profile over the stub, sets `onboardingComplete: true`, `status: 'active'`, `tier: 'free'`, `termsAccepted`, `termsAcceptedAt` and `marketingConsent`. Then a Stripe trial starts and the welcome email fires | **Terms must be ticked.** Marketing is optional and is recorded either way |

### Correcting a mistake at review

Every row on the review pane carries a pencil control.

- **Edits in place** — Name, Credentials, Position, Provider No., Work phone.
  Plain text fields; navigating away for them is pure friction. All five rows
  are always shown, including empty ones, so a field skipped earlier can still
  be filled in here.
- **Reopens its own step** — Workplace (2), AI keys (4), Signature (5). These
  carry real UI that a single-line input cannot replace. Entering a step this
  way sets `returnToReview`, so the footer offers **Back to review** instead of
  Continue and the doctor returns in one click rather than pressing through
  every remaining screen.

### Expected outputs — what must remain true

- `users/{uid}` exists with `onboardingComplete: true`, exactly one workplace,
  and `activeWorkplaceId` matching it
- `status: 'active'` and `tier: 'free'` on a new account, and a client can never
  set anything else — see `tests/rules/users.rules.test.ts`
- `termsAccepted: true` with a timestamp; the account cannot be created without it
- `marketingConsent` stored as the doctor voted, true **or** false
- A workplace with a registration system carries `regPattern` and `regTemplate`
- The doctor lands on `/generate`, not back at onboarding

### Known failure this pathway has already had

Adding `ensureProfileStub` (for the abandoned-signup emails) turned onboarding
completion from a Firestore **create** into an **update**. The update rule
compared `tier` against a value the stub did not have, so **every new signup was
denied at Get started** with "Missing or insufficient permissions", and nobody
had touched signup. Fixed by making `noPrivilegeEscalation()` test absence
against absence, and pinned by the rules tests so it cannot return.

**Firestore rules do not deploy with Vercel.** A rules change needs
`firebase deploy --only firestore:rules` after promoting.

---

## Not yet recorded

These exist and are unprotected. Each becomes a section here as it is specified:

`note-paste` (⚠️ one browser spec) · `note-scan` (OCR) ❌ · `note-dictate` ❌ ·
`note-record` ❌ · `note-manual` ❌ · letters, four types ❌ · `hospital-form` ❌ ·
`patient-add` ❌ · `patient-search` ❌ · `transcript-qa` ❌ · `history` ❌ ·
`mode-transitions` (note ↔ letter ↔ form) ❌ · `settings-panels` ⚠️ ·
`billing-states` ⚠️
