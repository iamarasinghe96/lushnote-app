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

**A SCAN is not classified the same way.** `resolvePastedKind(classification,
source)`:

| Source | Rule |
|---|---|
| `paste` | whatever the classifier said; ties go to transcript |
| `scan` | **ward note**, unless the classifier is CONFIDENT it is a transcript |

Pressing **Scan a ward note** is a stated intention, and it is evidence the
classifier does not have. It is also the input the classifier reads worst: OCR
of handwriting loses the ruled columns, the heading case and often the colons,
so the label and heading signals it leans on may never fire on a photograph that
is unmistakably a ward round to a human. Until 2026-08-27 the scan path ran the
paste classifier unchanged, so a messy OCR offered *Skip, use default note* — a
note generated from a record.

The override survives because a doctor can photograph the wrong page, and a
sheet of dialogue should still offer to generate a note. The asymmetry is the
point: **it takes real evidence to pull a scan off the record, and none to leave
it there.**

`beginPendingTranscript(text, source)` is the only way into the naming step and
`source` is required, not defaulted — a new entry point that forgot to say would
inherit the previous one's source, and a pasted transcript offering to overwrite
a patient record does not look like a missing argument.

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
- A **scanned** note routes to the record unless the classifier is confident it
  is a transcript — a weak or undecided score never pulls it off the record
- The button label always matches what the button will do
- The 80-word floor and clinical-keyword check still gate **note** generation,
  and still do not gate letters or the patient record
- A selected existing patient still carries reg number, session number and
  attendance into the note

Covered by `tests/unit/pasted-text.test.ts` — real ward rounds and a real
consultation, plus the tie-break bias asserted explicitly, since flipping that
comparison would silently point ambiguous pastes at a patient record.

---

## `note-record` — Record a session

**Entry:** Generate → **Record Session**
**Ends at:** `/edit` with a generated note
**Code:** `RecordModal` → `useSegmentedRecorder` → `TranscriptConfirmModal` →
`TemplatePicker` → `/edit`
**Coverage:** ⚠️ — the handoff parser is unit-tested; nothing drives a real
recording (headless Chrome has no microphone, and `getDisplayMedia` needs a
picker), so the capture half is manual. `dismissible` is a component prop and
the unit suite runs on `environment: 'node'` with no DOM, so the inert backdrop
is **unverified by any test** — checked by hand, and stated here rather than
implied

### The pathway

| # | Step | What the doctor does | What the code does |
|---|---|---|---|
| 1 | Open | **Record Session** | Modal with **In-person** / **Telehealth**, and a red consent warning that never auto-dismisses |
| 2 | Consent | Obtains the patient's consent | Nothing enforced in code — this is a prompt, deliberately, because the app cannot verify consent |
| 3 | Pick a source | **In-person** → mic; **Telehealth** → share a window/tab **with audio** | `getUserMedia` / `getDisplayMedia` |
| 4 | Record | Timer runs on wall clock | `useSegmentedRecorder` cuts a fresh `MediaRecorder` every **4 min** (`SEGMENT_MS`) |
| 5 | Each segment | — | Audio uploaded to Storage **first** (durable), then transcribed, then appended to `transcriptDrafts/current` |
| 6 | Optional | **Keep recording while I use another app** | `useRecordingPiP` — a canvas HUD in Picture-in-Picture keeps the tab unfrozen so the OS does not take the mic |
| 7 | Interruption | A call arrives, mic is taken | `mute`/`ended` on the track flushes the in-flight segment, shows *Paused — microphone interrupted*; `unmute` resumes |
| 8 | Stop | **Stop recording**, or the auto-stop the doctor set | Drains the queue — this is *Finishing transcript* |
| 9 | Name | Confirm transcript → patient, reg, DOB, gender | Same modal as `note-paste` |
| 10 | Template | **Skip, use default note** → Comprehensive Psychology Note | `handleTemplateSelect` → `/edit` |
| 11 | Generate | Watches fields fill | `runPendingGeneration` on the edit page |

### Only a deliberate gesture may end a live recording

While `phase === 'recording'`, the backdrop and Escape are **inert**
(`dismissible={false}` on `Modal`). Stopping is the red **Stop recording**
button; abandoning is the **X**.

This was the other way round until 2026-08-27, and the code comment conceded
it: the backdrop and Escape both ran `handleCancelRecording`, so a stray click
beside the modal ended a live consultation. Over four minutes the recovery
draft caught what had already been segmented; **under four minutes nothing had
been written yet**, so an accidental click ended the recording with nothing
kept.

The distinction is which gestures are intentions. A doctor clicks beside a
modal and presses Escape by reflex; they do not press a red Stop button or an X
by reflex. The backdrop uses `onMouseDown`, so a *drag* beginning on the
backdrop also counted — one more reason it could not stay live.

The same applies to **Dictate Note**, which records identically.

### Nothing may be the only copy

Three independent copies exist by the time a segment completes, in this order:

1. **Audio** in Storage (`recordings/{uid}/`) — survives total transcription
   failure; the session can be re-transcribed
2. **Text** in `users/{uid}/transcriptDrafts/current` — survives a crash, a
   closed tab, a reload
3. **The note** in `progress_notes` — written *before* generation runs, so a
   failed generation cannot lose the session

The counters on the recording screen report captured-vs-transcribed minutes
honestly rather than implying success: a segment whose audio saved but whose
transcription failed is logged as such.

### The reload that used to lose a session

Recorded 2026-08-27, from a real 11-minute recording.

The doctor named the patient, chose a template, and landed on `/edit` with a
blank form, no generation and **no error** — the session showing up in Patients
as *Unnamed patient*.

The store (`hooks/useNoteStore`) is plain React state with no persistence, and
it held the entire handoff: patient name, reg, DOB/gender, the chosen template
and `pendingAnimation`. A page load anywhere between step 9 and step 11 dropped
all of it, and the edit page's mount effect then took its
nothing-to-do branch — which is indistinguishable from opening a fresh note.

Why a reload happens there is not exotic: the App Router hard-navigates when a
deployment's build id changes under an open tab, and **every promote changes the
deployment**. Shipping a release can do this to a doctor mid-note.

The handoff is now written into the same recovery draft that already holds the
transcript (`lib/draftHandoff`, `saveDraftHandoff`), at both points the doctor
supplies something — naming the patient, then picking the template. On arriving
at `/edit` with an empty store and no `?noteId=`, `restoreFromDraft` puts it
back and raises a **Recording recovered** banner.

**Generation is not restarted automatically.** Gemini allows 20 notes a day, and
a reload loop that silently spent them would trade a recoverable failure for an
unrecoverable one. Restoring the transcript raises the existing **Generate
note** button, so resuming is one deliberate tap.

### Expected outputs — what must remain true

- Every 4 minutes of audio reaches Storage before its transcription is attempted
- An interrupted recording is recoverable from the draft with no note saved
- A page load between naming the patient and the note appearing loses **nothing**
  the doctor typed — and says so, rather than showing a blank form
- A recovered session appears in Patients under its **patient's name**, not
  "Unnamed patient", once the doctor has named it
- Recovery never fires generation by itself
- The recovery banner clears itself once read — it reassures, it does not ask
- A click on the backdrop or an Escape press while recording does **nothing** —
  in Record Session and in Dictate Note alike
- Stop recording still stops; the X still abandons
- A template deleted between recording and recovery degrades to the picker; it
  never blocks recovery
- The consent warning is present on every entry to the modal

Covered by `tests/unit/draft-handoff.test.ts` — the parser is fed arrays,
wrong types, partial documents and hand-edited values, because it is read back
by a later build and `undefined` reaching a controlled input turns it
uncontrolled mid-note.

---

## `note-dictate` — Dictate a note, letter or form

**Entry:** Generate → **Dictate Note**
**Ends at:** `/edit` with a generated note, letter, or hospital form
**Code:** `DictateModal` → `useSegmentedRecorder` → `handleTranscriptReady`
**Coverage:** ⚠️ — the template widening is unit-tested; the capture half is
manual, for the same reason as `note-record` (no microphone in headless Chrome)

### Two pathways, and they diverge immediately

| Choice | Then | Confirm transcript? | Template picker? |
|---|---|---|---|
| **Start a psychiatrist note** | note checklist → dictate | **yes** — names the patient | **no** — see below |
| **Dictate a letter or form** | pick the type → its own checklist → dictate | **no** | n/a |

The letter list is built per doctor: the four built-in types, their own custom
letter templates, and any hospital form whose `organizationKeys` match their
active workplace. A letter generates straight from the dictation — patient name,
DOB and the rest are extracted from what was said, so there is nothing to
confirm first.

### A dictated note does not ask for a template

Pressing **Start a psychiatrist note** already says what is being written, and
the modal then hands over a checklist to dictate against. Offering 116 templates
afterwards asks the doctor to state the same intention twice, so dictation
always uses **Comprehensive Psychology Note** (id 1).

**Recording a session is not the same and keeps its picker.** A recorded
consultation could legitimately be any template, and nothing about pressing
Record says which.

### The checklist and the template disagreed

The modal asks the doctor to cover **nine** topics. Comprehensive Psychology
Note has **seven** sections, and three of the nine had nowhere to go:

| Topic the modal asks for | Section in template 1 |
|---|---|
| Current medications, adherence, side effects | **none** |
| Any rating scale scores completed today | **none** |
| Referrals made or correspondence to send | **none** |

So the app told a doctor to dictate their medications and their PHQ-9 score into
a template that could hold neither. All three are first-class note fields with
their own rows in the edit page and their own headings in the PDF — they were
simply absent from that template's section list. The picker hid this, because a
doctor who chose a different template might land on one that had them.

`buildDictationTemplate` (`lib/dictationTemplate.ts`) widens the template for
dictation only: the missing core sections in canonical note order, plus an
**Other Topics Dictated** extra as a catch-all.

**Derived, never written back to `data/clinical-templates.json`.** The stored
template is what a doctor gets when they pick it deliberately in another
pathway, and editing it there would rewrite the section ordering of notes
already saved against it.

**The catch-all carries its own instruction.** `buildTemplatePrompt` only lists
markers; a heading with no rule attached comes back empty, and the spoken detail
it was meant to hold is dropped. Dictation wanders — a collateral call, an
allergy, a carer's concern — and none of that may be lost because no section
fits it.

### Surviving a reload — the same guarantee as `note-record`

A dictated note writes the handoff to the recovery draft at both points it has
something to write: the patient at the Confirm step, then the template. So a
page load before the note is saved restores exactly as a recording does.

**A recovered dictation is re-widened, not resumed on the stored template.** The
draft can only store a template *id*, and the id is of the template the
dictation STARTED from — not the widened shape it generates against. The edit
page rebuilds that shape when `draft.mode === 'dictation'`. Without it a
recovered dictation would silently lose Medications, Rating Scales, Referrals
and Other Topics Dictated — the four sections the doctor was asked to dictate
into.

**The letter and hospital-form paths used to delete the draft on navigation.**
Both called `deleteTranscriptDraft` the moment they pushed to `/edit` — before
the letter or form had been generated, let alone saved. A reload in that window
lost the entire dictation with nothing left behind, not even the amber row in
Patients. It was strictly worse than the note path, where the draft at least
survived. Both deletes were also redundant: `doAutoSaveLetter` and
`HospitalFormView` each clear the draft once their document is actually in
Firestore, which is the only moment at which it is safe.

**The recovery banner clears itself** after `RECOVERY_BANNER_MS`. It is a
reassurance, not a decision — the restored fields are the real message, and a
permanent bar over the note is clutter once read.

### Expected outputs — what must remain true

- Every topic the checklist asks for has somewhere to land in the note
- Anything dictated that matches no section appears under **Other Topics
  Dictated**, never nowhere
- Dictating a note never shows the template picker; recording a session always
  does
- The stored template 1 is unchanged by dictation — verified by test
- A letter dictation never shows the Confirm transcript step
- A hospital form or custom letter template deleted mid-dictation degrades
  rather than losing the recording
- A reload during a dictated note restores the patient AND the widened template
- A reload during a dictated letter or hospital form leaves the recovery draft
  intact — no path deletes it before the document it replaces exists
- The recovery banner disappears on its own

Covered by `tests/unit/dictation-template.test.ts`, which asserts the
checklist/template contract directly against the real
`data/clinical-templates.json` — so adding a topic to the modal without giving
it a home fails the suite.

---

## `letter-template` — Create your own letter template

**Entry:** Create Document → **Create your own template** (also from Dictate,
the TemplatePicker letters tab, and Settings → Templates)
**Ends at:** `users/{uid}.customLetterTemplates`, usable in every letter picker
**Code:** `CustomLetterBuilderModal` → `/api/chat` `type:'letter-template'`
**Coverage:** ⚠️ — the reconciliation is unit-tested; the modal itself is not

The doctor gives a title and a list of topics. **Refine & save** sends them to a
model to clean up typos and dictation artifacts and to write the extraction
prompt a later AI uses to fill the letter. **Save as written** skips the model
and builds a deterministic prompt instead.

### The refiner may not change the shape of what the doctor asked for

Refinement is **cosmetic** — it fixes spelling. The template it produces is then
used for every letter of that type, so a topic quietly dropped or reworded here
is wrong in every letter afterwards, under the doctor's own title.

The system prompt asks for the exact order and number of topics, and for
`[KEEP EXACTLY]` topics to come back character-for-character. Until 2026-08-28
**nothing checked that it had**: `parseResult` accepted any JSON carrying at
least one section, and the client accepted any non-empty list. Eight topics in,
six back — two merged, one dropped — saved silently.

This is the lesson the ward-note pipeline already records, applied here: *a
fidelity requirement is enforced in code, not asked of the model.*

`reconcileRefinedSections` (`lib/letterTemplateRefine.ts`):

| Model returned | Result |
|---|---|
| A different NUMBER of topics | refinement **rejected whole** → save as written |
| A `[KEEP EXACTLY]` topic, reworded | doctor's original restored |
| An emptied heading | doctor's original heading restored |
| An emptied description | allowed — descriptions are optional |

Rejection is not a dead end: the modal already falls back to saving the topics
as typed, which is always available and always correct. The doctor loses spell-
checking, never a topic.

**Matching is positional, never by heading.** Headings are the thing refinement
is asked to change, so a heading cannot be the key that identifies a topic.

### Expected outputs — what must remain true

- The saved template has exactly the topics the doctor typed, in their order
- A topic left untouched while editing comes back byte-identical
- A refiner failure degrades to save-as-written, never to a dead end or a
  silently different template
- Refinement never invents, merges or drops a topic

Covered by `tests/unit/letter-template-refine.test.ts`.

---

---

## Not yet recorded

These exist and are unprotected. Each becomes a section here as it is specified:

`note-scan` (OCR) ❌ ·
`note-manual` ❌ · letters, four types ❌ · `hospital-form` ❌ ·
`patient-add` ❌ · `patient-search` ❌ · `transcript-qa` ❌ · `history` ❌ ·
`mode-transitions` (note ↔ letter ↔ form) ❌ · `settings-panels` ⚠️ ·
`billing-states` ⚠️
