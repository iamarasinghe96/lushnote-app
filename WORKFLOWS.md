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
| 0a | *(previews only)* | — | Google OAuth runs only from a hostname on Firebase's **Authorized domains** list. Production and `localhost` are on it; a Vercel preview is not until its branch alias is added. The failure is a popup that opens black and closes at once — see `DEPLOYMENT.md` step 6 | the domain being authorised |
| 1 | About you | Full name, Credentials, Position/Title, Provider No., Work phone | Held in local state; nothing is written yet | **Full name only.** The other four are optional |
| 2 | Your workplace | Workplace name (autocomplete, or a custom name not in the list), institution type, and whether the institution has a patient registration system | `HospitalAutocomplete`. If **yes**, `detectIdPattern(example)` tokenises the sample ID into alpha/digit/separator runs and stores `regPattern` + `regTemplate`, which is what later warns a doctor who types a malformed number. If **no**, LushNote's own `YYYYMMDDNNN` numbering is used | **Workplace name only.** Registration system defaults to none |
| 3 | Email template | Picks one of three presets, or **Custom** and writes their own | Saved as `emailPretext` on the profile and used as the default cover letter for every export | nothing — skippable |
| 4 | AI keys | Follows the link, returns with a Gemini key, pastes it; same for Groq | **Two separate inputs.** Both run through `sanitizeApiKey`. Stored on the profile and mirrored into `sessionStorage` at sign-in | nothing — skippable, addable later in Settings |
| 5 | Signature | Clicks or drags an image from the gallery (the picker differs on mobile and desktop) | Background removal is **client-side**: adaptive local thresholding (Bradley–Roth integral image) separates ink from paper under uneven phone lighting, then the result is emitted as a real **SVG** of run-length rects and uploaded by `uploadSignatureSVG`. No server round-trip, and no photo is stored | nothing — skippable |
| 6 | Review | Checks every value, ticks the terms box, optionally ticks marketing, clicks **Get started** | `createProfile` merges the whole profile over the stub, sets `onboardingComplete: true`, `status: 'active'`, `tier: 'free'`, `termsAccepted`, `termsAcceptedAt` and `marketingConsent`. Then a Stripe trial starts and the welcome email fires | **Terms must be ticked.** Marketing is optional and is recorded either way |

### Leaving partway, and coming back

Every keystroke is saved to `users/{uid}.onboardingDraft` — the stub document
that already exists — debounced a second behind typing. A doctor who closes the
tab on step four returns to step four with their answers intact, and the
`signupAbandoned` email says so rather than inviting them to start again.

- **Nothing is written for a bounce.** `draftHasContent` requires typed content,
  so opening onboarding and leaving costs no write and shows no resume banner.
- **The terms tick is never saved.** Consent is given at the moment of
  completing; a tick restored from three days ago would not be that.
- **`regPattern` is recomputed, not stored**, so the saved pattern cannot
  disagree with the example it came from.
- **`resumeStep` never returns a step the draft cannot pass** — a draft missing
  a name resumes at 1, missing a workplace at 2, rather than stranding someone
  on a disabled Continue.
- **The draft is deleted on completion**, so it can never be resumed over a
  finished account.

Covered by `tests/unit/onboarding-draft.test.ts` (parse, content detection,
resume point) and `tests/rules/users.rules.test.ts` (a doctor may write only
their own draft, and only as a map).

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

## `note-paste` — Paste a transcript or ward note

**Entry:** Generate → **Paste Transcript or Ward Note** → **Paste text**
**Ends at:** `/edit` with a generated note, OR the patient's record filled
**Code:** `app/(app)/generate/page.tsx` → `TranscriptConfirmModal` → `TemplatePicker`
**Coverage:** ⚠️ — the classifier is unit-tested; one browser spec covers the
transcript half, nothing covers the ward-note half yet

### The pathway

| # | Step | What the doctor does | What the code does |
|---|---|---|---|
| 1 | Choose the source | **Paste text** (a transcript, or a Bossnet/ward note) or **Scan a ward note** (photo → OCR) | `phase: 'paste-choice'` |
| 2 | Paste | Pastes into the box; **Continue** enables once it is non-empty | `handleTextConfirm`. `validateTranscript` requires **80 words** and at least one clinical keyword — enforced later, when a note template is actually chosen, so letters and the patient record are not blocked by it |
| 3 | Confirm and assign | Confirms the preview, types a patient name | Autocomplete over the doctor's existing patients, built from their notes and profiles. Selecting one fills reg number, session number (+1) and last attendance |
| 3a | New patient | Name not found, so DOB and gender (both optional) appear | Reg number suggested as `YYYYMMDDNNN`, incrementing against existing records, or matched to the workplace's own `regPattern` |
| 4 | Pick a template | Five tabs — All, Session, Document, Letters, Patient — plus note length (Brief / Balanced / Detailed) | `TemplatePicker` |
| 5 | Generate | Clicks a template, **or** the green default button | See below |

### What the default button does — and why it depends on the content

The green button is not one action. What a doctor pastes decides it:

| Pasted content | Button reads | What happens |
|---|---|---|
| Transcript | **Skip, use default note** | Comprehensive Psychology Note (template id 1) |
| Ward note | **Skip — add to patient record** | Fills the patient's tracked fields (`mode: 'patient-intake'`) |

**A ward note is a record being COPIED, not a conversation to be written up.**
Generating a note from one produces a worse copy of a document that already
exists, while the tracked fields it should have filled stay empty. This applies
whether or not the patient already exists: the fidelity contract's
supersede-per-field and per-topic merge rules were written for *repeated* ward
notes on the same patient, so that is exactly when they earn their keep.

**The button says which it will do.** A control that silently does two different
things is how a doctor rewrites a patient record while expecting a note — and
the two are not equally reversible. A wrong note is discarded; a wrong record
write supersedes tracked fields.

### Testing this on staging

Staging is a preview deployment, so `E2E_MOCK_AI` is set there — but the mock
only answers the **fixture account**. Signed in as a real doctor you get the
real model, which is the only way staging can be used to judge a release.

### The classifier

`classifyPastedText` (`lib/pastedText.ts`) is structural, not clever, and calls
no model — it runs the instant text is pasted, and a wrong answer has to be
explainable from the text alone.

- **Ward-note signals:** `#` problem lines, the headings a ward round uses
  (Current Issues, Progress, Obs, Impression, Plan …), numbered plan items,
  mostly-short lines
- **Transcript signals:** spoken filler (*um*, *yeah*, *you know*), heavy first
  and second person, several question marks, one long unbroken block
- **Ties go to transcript.** That is today's behaviour, so an uncertain call
  changes nothing — and it puts the cost of being wrong on the recoverable side

**Every ward signal works without newlines.** The first version anchored all of
them to line starts and was blind to the ordinary case: copying a note out of
Bossnet flattens it into one block — `(Age: 88)UR / Reg Number:` — so every rule
scored zero and a hospital record was read as a conversation. The identifying
labels (DOB, UR, Ward, Bed, Clinician) are what survive that, and they are now
the strongest signal, because a conversation never carries them.

### Expected outputs — what must remain true

- A transcript never routes to the patient record, however clinical its wording
- A ward note routes to the record whether the patient is new or existing
- The button label always matches what the button will do
- The 80-word floor and clinical-keyword check still gate **note** generation,
  and still do not gate letters or the patient record
- A selected existing patient still carries reg number, session number and
  attendance into the note

Covered by `tests/unit/pasted-text.test.ts` — real ward rounds and a real
consultation, plus the tie-break bias asserted explicitly, since flipping that
comparison would silently point ambiguous pastes at a patient record.

---

## Not yet recorded

These exist and are unprotected. Each becomes a section here as it is specified:

`note-scan` (OCR) ❌ · `note-dictate` ❌ ·
`note-record` ❌ · `note-manual` ❌ · letters, four types ❌ · `hospital-form` ❌ ·
`patient-add` ❌ · `patient-search` ❌ · `transcript-qa` ❌ · `history` ❌ ·
`mode-transitions` (note ↔ letter ↔ form) ❌ · `settings-panels` ⚠️ ·
`billing-states` ⚠️
