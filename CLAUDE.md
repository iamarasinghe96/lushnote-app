# LushNote — Claude Code Project Bible

## What This Is

LushNote is a clinical note builder for psychiatrists. Deployed at lushnote.com.au.
Layers 1–12 are complete. This file is the authoritative reference for all gap-closure
fix prompts. Every fix prompt reads this file first.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (mobile-first) |
| Backend | Next.js API routes (Vercel serverless) |
| Auth / DB | Firebase Auth + Firestore |
| AI — primary | Gemini API (`gemini-2.5-flash` / `gemini-2.5-flash-lite`) |
| AI — fallback | Groq API (`llama-3.3-70b-versatile`, `whisper-large-v3-turbo`) |
| Hosting | Vercel |
| Domain | lushnote.com.au |

---

## Repo Structure

```
app/
  layout.tsx
  page.tsx                  — landing / auth gate
  (app)/
    layout.tsx              — authenticated shell
    generate/page.tsx
    edit/page.tsx
    export/page.tsx
    history/page.tsx
    patients/page.tsx
    transcript/page.tsx     — dynamic 5th tab, shown when transcript exists
  settings/
    page.tsx
  account-deleted/
    page.tsx
  e2e-login/
    page.tsx                — hidden email/password sign-in for the test suite; 404 unless NEXT_PUBLIC_E2E=1
  api/
    transcribe/route.ts
    generate/route.ts
    chat/route.ts
    version/route.ts        — public; the running commit sha + build time
components/
  ui/                       — shared primitives (Button, Card, Modal, Input, Textarea, Badge, DatePicker, TimePicker, GenderAvatar, RateLimitBanner)
  modals/                   — TemplatePicker, TranscriptConfirmModal, ReassignModal, PatientModal
  tabs/                     — TabBar
  settings/                 — ProfilePanel, WorkplacesPanel, TemplatesPanel, TranscriptsPanel, ApiKeysPanel, PersonalisationPanel, SubscriptionPanel
  FAB.tsx                   — floating action button (AI assistant + live support)
lib/
  firebase.ts
  gemini.ts
  groq.ts
  utils.ts                  — getInitials, detectIdPattern, escapeHtml, buildPreviewHTML, buildNoteText, buildCoverLetterEmail, applyWorkspaceTheme, openSettings
  firestore/
    notes.ts
    profiles.ts
    patients.ts
types/
  index.ts
tests/
  unit/                     — vitest over the pure modules (entitlement, sweep, event routing)
  e2e/                      — Playwright smoke suite (see tests/e2e/README.md)
.github/
  workflows/quality.yml     — typecheck + unit tests, on every pull request
  workflows/e2e.yml         — Playwright against the Vercel Preview, on deployment_status
playwright.config.ts
vitest.config.ts
data/
  clinical-templates.json   — 116 templates (merged metadata + prompts)
  templates-prompts.json    — prompts only (source, do not modify)
public/
  icon-512.png
  icon-192.png
  icon.svg
  assets/bg.svg
  assets/bg-landing.svg
```

---

## Environment Variables

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
GEMINI_API_KEY            — server-side only (API routes)
GITHUB_TOKEN              — fine-grained PAT, this repo only: Contents RW, Pull requests RW,
                            Actions RW, Deployments R. NOT Checks — fine-grained tokens do not
                            offer it, so run status is read from the Actions API. Server-side
                            only; used by the Releases panel.
GITHUB_REPO               — iamarasinghe96/lushnote-app
```

Preview environment ONLY — never tick Production on these two:

```
NEXT_PUBLIC_E2E=1         — makes /e2e-login exist
E2E_MOCK_AI=1             — the four AI routes answer from lib/e2eMock
```

GitHub Actions secrets: `E2E_USER_EMAIL`, `E2E_USER_PASSWORD` (from Admin →
Releases → Provision test account), and `VERCEL_AUTOMATION_BYPASS_SECRET` only
if Deployment Protection is on for previews.

User-supplied keys (sessionStorage at runtime):
- `groqApiKey` — sessionStorage key: `groq_api_key`
- `geminiApiKey` — sessionStorage key: `gemini_api_key`

`getGroqKey()` reads `sessionStorage` only — no localStorage fallback.
On sign-in, `profile.groqApiKey` is copied to `sessionStorage`.
Same for `geminiApiKey`.

---

## Firebase Project

- **Project ID:** `lush-note`
- **Auth domain:** `lush-note.firebaseapp.com`
- **Collection:** `progress_notes`
- **User profiles:** `users/{uid}`
- **Patient profiles:** `users/{uid}/patientProfiles/{profileId}`
- **Transcript recovery drafts:** `users/{uid}/transcriptDrafts/current` (single doc; only durable copy of an interrupted recording's transcript until it is saved into a named note)
- **Deletion feedback:** `deletion_feedback/{uid}`

Version-controlled security rules live in `firestore.rules` (repo root). Deploy with
`firebase deploy --only firestore:rules`, or paste into the Firebase console. Each
subcollection needs its OWN `match` block — Firestore rules do NOT cascade from
`users/{uid}` to `users/{uid}/transcriptDrafts/...`, so a missing block means the
catch-all `allow read, write: if false` silently denies every access.

### Storage Rules — STRICT

| Data | Storage |
|---|---|
| Patient notes | Firestore `progress_notes` only — never client storage |
| Patient profiles | Firestore `users/{uid}/patientProfiles/` only |
| User profile | Firestore `users/{uid}` only |
| Groq API key | `sessionStorage` (runtime) + Firestore (persistent) |
| Gemini API key | `sessionStorage` (runtime) + Firestore (persistent) |
| Template usage | `localStorage('lnTemplateUsage')` |

On sign-out: all in-memory state clears. `sessionStorage` wipes on tab close.

---

## Firestore Note Fields

```
userId, patient, reg_number, date, time, clinician, session_number, attendance,
diagnosis, presentation, history, medications, mse, content, scales, risk,
referrals, summary, nextsteps, transcript, transcriptMode, extraSections,
docType, letterType, letterData, formData, createdAt, updatedAt
```

`transcript` — raw transcript text (string, optional)
`transcriptMode` — `'paste' | 'conversation' | 'dictation' | 'document'`
`extraSections` — serialized JSON (string, optional, ≤30000) of template-specific
sections + render order — see **Template Sections** below. Absent on old notes.
`docType` — `'note' | 'letter'` (string, optional; absent = note). A `'letter'` doc
is a saved AI-generated letter that lives in `progress_notes` alongside notes so it
shows up in Patients / History / AI assistant exactly like a note — see **Saved Letters** below.
`letterType` — `'referral' | 'records' | 'freetext' | 'custom'` (only on letter docs).
`letterData` — serialized JSON (string, ≤40000) of the letter's structured fields
(recipient/patient common fields + per-type/section content) used to re-open it in
the letter editor. The assembled plain-text body is also mirrored into `content` so
letters are searchable and previewable without a special path.
`docType: 'hospital-form'` — a filled hospital progress-note form (e.g. AWH FAW0004).
`formData` — serialized JSON (string, ≤40000) of `HospitalFormData` (formKey, pid,
paragraphs, dateTime) to re-open it in the form editor; the entry text is mirrored
into `content`. See **Hospital Forms** below.

Adding new fields requires updating Firestore security rules AND the validation function.

---

## Template Sections (per-template field topics)

Each of the 116 built-in templates in `data/clinical-templates.json` carries a
`sections: { key, label, core }[]` array (generated by
`scripts/annotate-template-sections.mjs`, which also rewrites each `### Heading` in
the prompt to a `[key] Heading` marker). `core: true` means the section maps to one
of the 11 core note fields (Risk Assessment → `risk`, Presenting Problem(s) →
`presentation`, …); `core: false` is a template-specific **extra** section (CBT
Formulation, Core Beliefs, …) with a slug key. Long-form assessment reports (>20
sections, or concatenated multi-part templates) fall back to `[{content}]` — the whole
note flows into Session Content as before.

- **Generation:** `buildTemplatePrompt` (lib/utils) lists the template's `[key]`
  markers so the model emits parseable sections, plus a global no-markdown-tables rule.
- **Parsing:** `parseGeneratedContent(content, template)` (edit/page) → `{ fields, extras }`.
  Core sections fill core fields; extras (with their labels) are collected. A table
  sanitizer converts any `| a | b |` rows to labelled lines.
- **Storage:** `extraSections` JSON = `{ order: string[], extras: {key,label,content}[] }`.
  `order` = full section key sequence in template order (core + extra); `extras` carry
  their labels so a note survives its template being deleted. Core sections keep their
  DEFAULT labels in the UI; extras use their template label.
- **Rendering:** `orderedNoteSections(f, coreLabel)` (lib/utils) yields the ordered
  core+extra sections for preview/text/PDF; the edit page renders them data-driven
  (`renderNoteSections`). Empty fields collapse to a "label ＋" row (tap ＋ to expand).

---

## Saved Letters (letters persist like notes)

Generated letters are saved to `progress_notes` as `docType: 'letter'` docs so they
show up under their patient in Patients/History and are searchable by the AI
assistant — exactly like clinical notes. No separate collection.

- **Shape:** `docType:'letter'`, `letterType`, `letterData` (serialized `LetterData`:
  `{ common, referral?|records?|freetext?|customTemplate?+customSections? }`), plus
  reused note fields: `patient` = the letter's patient/subject (so it groups),
  `date` = letter date, `clinician`, and `content` = the assembled plain-text body
  (`buildLetterText`, lib/utils) for list snippets / History preview / AI search.
- **Autosave (edit page):** a debounced effect on the store letter fields calls
  `doAutoSaveLetter` (parallel to `doAutoSave` for notes). It no-ops until the letter
  names a patient, skips a write when nothing changed since the last save
  (`lastSavedLetterDataRef`), and flushes on unmount.
- **Never clobbers a note:** `currentDocIsLetterRef` gates create-vs-update — letter
  autosave only updates a doc it knows is a letter, else creates a fresh one.
  `enterFreshLetter()` (note→letter) and `leaveLetterForNewNote()` (letter→note)
  keep the two docs separate so converting between them never overwrites the other.
- **Re-open:** `hydrateLetterFromNote(store, note)` (hooks/useNoteStore) loads a saved
  letter back into letter mode; the edit page's `loadNote` and the Patients/History
  rows route letters through it (Patients via `?noteId=`).
- **Serialize helpers:** `serializeLetterData` / `parseLetterData` (lib/utils);
  `LETTER_TYPE_LABEL` for list labels.

---

## Scanned Ward Notes — the fidelity contract

A photographed ward note is a legal clinical record being copied. LushNote
transcribes and lays it out; it does not reinterpret it. Everything below is a
requirement, not a preference — each one was written after a real note lost
content in testing.

**The Source Document is the artifact.** The verbatim reads are stored on the
patient profile (`entries`, newest first, last 5) and every field is a VIEW over
them. Before this, the read was transient and the record kept only the
interpretation, so a bad projection lost the original permanently. Nothing
downstream may be the only copy of anything. (`lastEntry` is the superseded
single-note field, still read for records saved under it.)

**A later note supersedes per field, and the old value goes to history.** A field
the new note covers is REPLACED; a field it is silent about is KEPT. The previous
value is logged by `appendPatientHistory` and shown in the card's Editing
history. `otherTopics` merges PER TOPIC (`mergeExtras` over the structured
`extras`, with `otherTopics` as the rendered view) — storing it as one string
meant a progress-only round wiped an allergy recorded days earlier.

**Five invariants:**
1. **No loss.** Every line reaches the record. Whatever no field claims is
   appended verbatim to `otherTopics` (`appendUnfiled`, /api/generate) — this is
   enforced in code, not asked of the model.
2. **No invention.** Never expand an unfamiliar abbreviation (IDC is an
   indwelling catheter, not an "Intermittent Withdrawal Catheter" — a real
   failure). Unreadable is `[illegible]`.
3. **Hierarchy survives.** `5a. Cease if no stroke` stays indented under
   `5. Aspirin 300mg load`. Sub-items are carried as leading spaces in the line.
4. **Order survives.** Problem list and plan keep the order written.
5. **Determinism.** Extraction runs at `EXTRACTION_TEMPERATURE` (0.1), OCR at 0.
   At the provider default of 1.0 the same photo produced a different record on
   every run — that was the root cause behind most "why did it drop this" reports.

**The note's own structure IS the template.** Reproduce its headings (Current
Issues, Progress, Obs, Impression, Issues, Plan). Do not impose SOAP on a note
that wasn't written in SOAP.

**The problem list is never filtered.** Every `#` line, including ones marked
resolved or inactive, with its status word. Whether a problem still belongs is
the treating doctor's call.

**No new columns.** Allergies, Investigations, Impression and anything else
without a tracked field go to `otherTopics` under their own heading. The table
stays readable; nothing is lost.

**A hospital form carries the LATEST entry**, not the accumulated record —
`profile.entries[0]`, falling back to `lastEntry` then `buildPatientInfoText`.
Feeding the whole record in turned a four-line ward round into a 13-page form.

**Gemini leads, Groq follows.** `runExtraction` is Groq-first by default to save
the 20/day Gemini quota, but ward-note intake and hospital forms pass
`preferGemini: true` — a ward note is being COPIED, not composed, and the
fidelity contract outranks the quota. Groq still runs when Gemini is exhausted,
so this costs quota rather than availability.

**Guards in the pipeline** (all in `/api/generate` + `/api/ocr`):
- `sourceCoverage()` — fraction of `#`/numbered source lines present in the
  reply. Under `COVERAGE_FLOOR` (0.9) on a Groq answer → one Gemini re-run.
- `appendUnfiled()` — unmatched source lines appended to `otherTopics`.
- `emptySections()` — a heading returned with no lines means the model saw a
  block and skipped it → re-read the page.
- `GROQ_HARD_RULES` — a short numbered rule block appended LAST on the Groq
  attempt; a 70B model dilutes long nuanced prompts.

---

## Hospital Forms (dictate → AI-fill a hospital's ruled progress-note form)

Campus-specific fillable forms (first: Albury Wodonga Health FAW0004). A doctor
whose active workplace matches the form's campuses sees it under **Create
Document**, dictates (or types) a progress note, and gets a PDF matching the paper
form exactly. Persists under the patient like letters.

- **Config:** `hospitalForms/{formKey}` (admin-managed, read-only to signed-in
  users; writes via the admin API/Admin SDK). Shape `HospitalFormDoc`: `name`,
  `organizationKeys` (campus org-keys, `toOrganizationKey`), `pageBackgrounds`
  (full-page PNG Storage URLs, one per side), `geometry` (all mm — table/pid
  positions, row height, rows/page, font pt), `labels`. Admin at
  the **Admin Console** at `/admin` (Hospital Forms section; + API
  `/api/admin/hospital-form`). New hospitals need no code — just a form doc.
- **Editor:** `components/hospital-form/HospitalFormEditor.tsx` renders each page
  from its PNG background + an absolutely-positioned overlay table, geometry as
  CSS vars. The notes column is driven by `components/hospital-form/reflow.ts`
  (pure; NOT yet unit-tested — see WORKFLOWS.md): text wraps onto the next ruled line with real font
  measurement (the standalone form's bug was `getComputedStyle().font` returning
  ""). Source of truth = `paragraphs: string[]`; rows are derived by word-wrap.
  Date/Time auto-fills the FIRST cell only (date row 1, time row 2). PDF export is
  direct-canvas (draw background, then every input at its bounding box, then the
  signature right-aligned after the last written line) — BOTH sides always
  emitted. jsPDF; no html2canvas.
- **Entry points:** **Dictate Note** (`DictateModal`) lists the campus's forms in
  its letter list → dictate (draft encodes `hospitalform:<formKey>`, recovery via
  `getHospitalForm`, deleted form → plain-note fallback). **Create Document**
  (`LetterPickerModal` "Hospital forms" group) opens a BLANK form to type. Both
  set `store.hospitalForm` (+ `pendingHospitalFormGeneration` for dictation) and
  route to `/edit`.
- **Renders in the Edit tab:** the edit page early-returns `<HospitalFormView>`
  when `store.hospitalForm` is set (parallel to note/letter modes); the Export tab
  previews the same form read-only (`<HospitalFormView readOnly>`). All form state
  lives in the store (`hospitalForm`, `hospitalFormData`, `hospitalFormNoteId`) so
  both tabs share it. There is NO standalone `/hospital-form` route. Generation
  runs `mode:'hospital-form'` on `/api/generate` (Groq-only; returns
  `{urNo,surname,givenNames,dob,sex,noteText}`). The AI's multi-line `noteText`
  is parsed with `repairJsonControlChars` (escapes raw newlines inside JSON
  strings — same guard used for letters).
- **Persistence:** `progress_notes` docs with `docType:'hospital-form'` +
  `formData` (serialized `HospitalFormData`), `patient`="Given Surname",
  `reg_number`=UR, `content`=entry text. `HospitalFormView` autosave uses the
  store's `hospitalFormNoteId` (never touches store.currentNoteId, so it can't
  clobber a note/letter). Starting a note/letter calls `resetHospitalForm()`.
  Patients/History show a "Form" badge and open `/edit?noteId=`.
  `serialize/parseHospitalFormData` in lib/utils.

---

## Firestore Security Rules (deployed)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function verified() { return request.auth != null; }
    function owns(uid) { return verified() && request.auth.uid == uid; }
    function ownsNote() { return verified() && request.auth.uid == resource.data.userId; }
    function writingOwnNote() { return verified() && request.auth.uid == request.resource.data.userId; }

    function noPrivilegeEscalation() {
      return (!('tier'   in request.resource.data) || request.resource.data.tier   == resource.data.tier)
          && (!('status' in request.resource.data) || request.resource.data.status == resource.data.status);
    }

    function billingUntouched() {
      return ('billing' in resource.data)
        ? ('billing' in request.resource.data && request.resource.data.billing == resource.data.billing)
        : !('billing' in request.resource.data);
    }

    function noteValid() {
      let d = request.resource.data;
      return d.userId is string && d.userId.size() <= 128
          && (!('patient'        in d) || (d.patient        is string && d.patient.size()        <= 300))
          && (!('reg_number'     in d) || (d.reg_number     is string && d.reg_number.size()     <= 100))
          && (!('clinician'      in d) || (d.clinician      is string && d.clinician.size()      <= 300))
          && (!('date'           in d) || (d.date           is string && d.date.size()           <= 50))
          && (!('time'           in d) || (d.time           is string && d.time.size()           <= 50))
          && (!('session_number' in d) || (d.session_number is string && d.session_number.size() <= 100))
          && (!('attendance'     in d) || (d.attendance     is string && d.attendance.size()     <= 500))
          && (!('diagnosis'      in d) || (d.diagnosis      is string && d.diagnosis.size()      <= 3000))
          && (!('presentation'   in d) || (d.presentation   is string && d.presentation.size()   <= 8000))
          && (!('history'        in d) || (d.history        is string && d.history.size()        <= 8000))
          && (!('medications'    in d) || (d.medications    is string && d.medications.size()    <= 3000))
          && (!('mse'            in d) || (d.mse            is string && d.mse.size()            <= 5000))
          && (!('content'        in d) || (d.content        is string && d.content.size()        <= 15000))
          && (!('scales'         in d) || (d.scales         is string && d.scales.size()         <= 2000))
          && (!('risk'           in d) || (d.risk           is string && d.risk.size()           <= 5000))
          && (!('referrals'      in d) || (d.referrals      is string && d.referrals.size()      <= 3000))
          && (!('summary'        in d) || (d.summary        is string && d.summary.size()        <= 8000))
          && (!('nextsteps'      in d) || (d.nextsteps      is string && d.nextsteps.size()      <= 5000))
          && (!('transcript'     in d) || (d.transcript     is string && d.transcript.size()     <= 50000))
          && (!('transcriptMode' in d) || (d.transcriptMode is string && d.transcriptMode.size() <= 50))
          && (!('extraSections'  in d) || (d.extraSections  is string && d.extraSections.size()  <= 30000))
          && (!('docType'        in d) || (d.docType        is string && d.docType.size()        <= 20))
          && (!('letterType'     in d) || (d.letterType     is string && d.letterType.size()     <= 20))
          && (!('letterData'     in d) || (d.letterData     is string && d.letterData.size()     <= 40000))
          && (!('formData'       in d) || (d.formData       is string && d.formData.size()       <= 40000))
          && request.resource.data.keys().hasOnly([
               'userId','patient','reg_number','date','time','clinician',
               'session_number','attendance','diagnosis','presentation',
               'history','medications','mse','content','scales','risk',
               'referrals','summary','nextsteps','transcript','transcriptMode',
               'extraSections','docType','letterType','letterData','formData',
               'createdAt','updatedAt'
             ]);
    }

    function profileValid() {
      let d = request.resource.data;
      return (!('displayName'        in d) || (d.displayName        is string && d.displayName.size()        <= 200))
          && (!('credentials'        in d) || (d.credentials        is string && d.credentials.size()        <= 200))
          && (!('email'              in d) || (d.email              is string && d.email.size()              <= 300))
          && (!('status'             in d) || (d.status             is string && d.status.size()             <= 50))
          && (!('tier'               in d) || (d.tier               is string && d.tier.size()               <= 50))
          && (!('emailPretext'       in d) || (d.emailPretext       is string && d.emailPretext.size()       <= 1000))
          && (!('activeWorkplaceId'  in d) || (d.activeWorkplaceId  is string && d.activeWorkplaceId.size()  <= 100))
          && (!('onboardingComplete' in d) || (d.onboardingComplete is bool))
          && (!('billingPrompts'     in d) || (d.billingPrompts     is map))
          && (!('notesMigrated'      in d) || (d.notesMigrated      is bool))
          && (!('workplaces'         in d) || (d.workplaces         is list   && d.workplaces.size()         <= 30))
          && (!('favoriteTemplateIds'in d) || (d.favoriteTemplateIds is list  && d.favoriteTemplateIds.size() <= 200))
          && (!('customTemplates'    in d) || (d.customTemplates    is list   && d.customTemplates.size()    <= 50))
          && (!('customLetterTemplates' in d) || (d.customLetterTemplates is list && d.customLetterTemplates.size() <= 15));
    }

    match /progress_notes/{noteId} {
      allow get:    if ownsNote();
      allow list:   if verified() && resource.data.userId == request.auth.uid && request.query.limit <= 500;
      allow create: if writingOwnNote() && noteValid();
      allow update: if ownsNote() && writingOwnNote() && noteValid()
                    && request.resource.data.userId == resource.data.userId;
      allow delete: if ownsNote();
    }

    match /users/{userId} {
      allow get:    if owns(userId);
      allow create: if owns(userId) && profileValid()
                    && (!('tier'   in request.resource.data) || request.resource.data.tier   == 'free')
                    && (!('status' in request.resource.data) || request.resource.data.status == 'active')
                    && !('billing' in request.resource.data);
      allow update: if owns(userId) && profileValid() && noPrivilegeEscalation() && billingUntouched();
      allow delete: if owns(userId);

      match /patientProfiles/{profileId} {
        allow read:   if owns(userId);
        allow write:  if owns(userId);
        allow delete: if owns(userId);
      }

      match /transcriptDrafts/{draftId} {
        allow read:   if owns(userId);
        allow write:  if owns(userId);
        allow delete: if owns(userId);
      }
    }

    match /deletion_feedback/{docId} {
      allow create: if verified() && request.resource.data.userId == request.auth.uid;
    }

    match /letterheads/{docId} {
      allow read: if verified();
    }

    match /hospitalForms/{docId} {
      allow read: if verified();
    }

    match /letterheadRequests/{docId} {
      allow create: if verified() && request.resource.data.requestedBy == request.auth.uid;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## Billing (Stripe) — all 8 layers landed; plan in MONETIZATION_PLAN.md

3 months free, then AUD $30/month worldwide. Cards everywhere, BECS Direct Debit
for AU only. The full layered plan, the confirmed decisions and the Stripe
dashboard state live in `MONETIZATION_PLAN.md` (repo root) — read it before
touching any billing code.

**Access is decided by Stripe, never by a date this app computes.** A BECS debit
takes days to clear, so "the trial ended, lock them out" would paywall a doctor
whose money is already moving. `resolveEntitlement()` (`lib/entitlement.ts`) is
PURE — no SDK, no Firestore, no env — so the client layout and the API routes
cannot reach different verdicts. `past_due` WITH a payment method is entitled
(Stripe is retrying, or a debit is clearing); `unpaid` is not, because that is
what the dashboard marks a subscription once Smart Retries are exhausted.
Unknown status fails OPEN: wrongly billing someone is recoverable, wrongly
blocking a clinician mid-clinic is not.

**`users/{uid}.billing` is server-written only** and pinned by
`billingUntouched()`. That rule tests absence against absence, which
`noPrivilegeEscalation()` does not: a field is also changed by being REMOVED,
and a full-document `setDoc` that omits it would otherwise pass. This is why
`createProfile` now merges — it runs against the first-sign-in stub, so it is an
update, and a wholesale overwrite would read as deleting the subscription.

**Never store a card or bank number.** Stripe holds the instrument; we hold the
identifiers needed to ask Stripe about it, the billing country (for price
display and AU turnover), and the consent record for dispute defence.

**The webhook projects, it does not translate.** Every handler refetches the
subscription from Stripe and writes current truth, because delivery order is not
guaranteed and a stale `trialing` arriving after `active` would hand back access
already paid for. Idempotency claims `stripe_events/{id}` with `.create()` — one
atomic step — and RELEASES the claim if the handler throws, or Stripe's retry
would be discarded as a duplicate. TTL is on `expiresAt` (a Timestamp holding a
FUTURE instant; a millisecond number is ignored by the policy).

**Grace expiry is swept nightly, never webhooked.** Stripe emits an event for
everything that happens and nothing for a week passing with no payment method.
`runBillingSweep` (lib/firestore/billingSweep.ts) runs from the 23:00 UTC cron
BEFORE the emails, so a doctor paywalled tonight gets tonight's email. It also
backfills trials — the same code that puts every existing doctor on a trial at
launch — and recomputes AU turnover whole from Stripe's paid invoices.

**GST never touches the price.** `tax_behavior` is fixed at creation, so $30
stays $30 and GST is carved out of it; registering creates a Stripe Tax
registration for AU. The turnover monitor counts AUSTRALIAN sales only — exports
of services are GST-free and do not count towards the $75k threshold.

**Paywalled = creation blocked, reading never.** AI routes 402 server-side;
`/generate`, `/edit`, `/transcript` show `PaywallScreen`; History, Patients,
Export, Settings and `/billing` stay open. `/billing` lives OUTSIDE the `(app)`
group so a lapsed doctor can reach it.

**Nothing about billing requires a database console.** `/admin?section=billing`
reports the whole chain from inside the app: which Stripe mode the keys are in,
whether the webhook secret is set, how many deliveries were processed in the
last 24h/7d and when the latest landed, every doctor counted by entitlement
state, and when the nightly sweep last ran (`config/billing.lastSweep`). A
per-doctor lookup (`reconcileUser`) reads the stored projection AND the live
subscription and lists any field where they disagree — drift means the webhook
chain has stopped; empty means it is current. `reprojectUser` is the repair, and
Run sweep triggers the cron's work by hand.

**Deletion keeps the money records.** `stripeOffboard` cancels the subscription
and detaches the instrument (ending any BECS mandate) but deletes nothing;
`billing_records/{uid}` is stamped, never removed — five years, per the ATO. No
code path anywhere deletes from that collection.

Env: `STRIPE_SECRET_KEY` (also the feature flag — absent means every billing
path no-ops and the app behaves exactly as before), `STRIPE_PRICE_ID`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

---

## Lifecycle Emails (Zoho SMTP)

Three automatic emails, all **service messages about the account the doctor
opened** — they promote nothing, so they are not commercial electronic messages
under the Spam Act and go to doctors regardless of `marketingConsent`. An
unsubscribe is included anyway (`emailOptOut`), because it costs nothing and
removes the argument. `marketingConsent` stays and governs product news only.

| Type | When | Constants |
|---|---|---|
| `welcome` | immediately when onboarding COMPLETES (it calls `action:'welcome'`); the nightly sweep backfills anyone missed | — |
| `signupAbandoned` | 3+ days after first sign-in with onboarding still unfinished. The ONLY email a stub is eligible for — a welcome would be untrue and an API reminder meaningless | `SIGNUP_ABANDONED_AFTER_DAYS` |
| `apiSetup` | 3+ days after finishing signup with no Gemini or Groq key | `APP_SETUP_AFTER_DAYS` |
| `paymentSetup7d` | 7 days before the Stripe trial ends with no payment method. Reads `billing.trialEndsAt` — never a date this app derives | — |
| `paymentSetupDue` | On/after the trial-end day, still no payment method. A 7-day grace window follows | `GRACE_DAYS` |
| `paywalled` | When the sweep flips `paywalledAt`. Stripe owns failed-payment emails; we speak only when ACCESS changes | — |

**Everything sends automatically.** The console does not trigger sends — it edits
the copy and audits what went out. The only manual path left is a doctor's own
welcome, fired by onboarding.

- **Profile stub:** `ensureProfileStub` (AuthProvider, on first authentication)
  writes `users/{uid}` with `onboardingComplete: false` before onboarding runs.
  Without it a half-finished signup left no trace — no admin row, no cohort, no
  way to reach them. `createProfile` overwrites it wholesale on completion.
- **Transport:** `lib/email.ts` — nodemailer over Zoho SMTP (port 465). Sending as
  the real mailbox means the "just reply to this email" in the copy actually works.
- **Copy:** `DEFAULT_TEMPLATES` in `lib/emails/lifecycle.ts` is the default; an
  admin override lives in `emailTemplates/{type}` and wins. Reset DELETES the
  override rather than storing a copy, so a later change to the default still
  reaches anyone who never customised it. Placeholders: `{{greeting}}`, `{{name}}`,
  `{{site}}`, `{{trialEnd}}`. Plain text is the source of truth; the HTML part is
  generated from it (paragraphs on blank lines, `[label](url)` → link).
- **Bookkeeping:** `users/{uid}.lifecycleEmails.{type}` = sent-at ms. Marked BEFORE
  the log row, so a crash between the two re-sends nothing. Every send is appended
  to `email_log` (admin-read only, denied to clients by the catch-all rule).
- **Run:** Vercel Cron `GET /api/lifecycle` daily at 23:00 UTC (09:00 AEST), with
  `Authorization: Bearer CRON_SECRET`. Sends are spaced `GAP_MS` apart and capped
  at `MAX_PER_RUN` so a batch can't get the mailbox throttled. One email per doctor
  per run.
- **Admin:** `/admin?section=emails` — per-type draft editor with live preview,
  how many are queued for the next run, and the send log.
- **Unsubscribe:** `/unsubscribe?u=<uid>&t=<hmac>` — no sign-in, HMAC scoped to
  that uid so it can't opt out anyone else.
- **Env:** `ZOHO_SMTP_HOST` (default `smtp.zoho.com.au`), `ZOHO_SMTP_USER`,
  `ZOHO_SMTP_PASS` (app-specific password, NOT the account password), `EMAIL_FROM`,
  `EMAIL_REPLY_TO` (optional), `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`.

---

## Release Pipeline (test → preview → promote)

Nothing reaches lushnote.com.au without a pull request, two green checks and a
deliberate click. Before this, every session pushed straight to main and main is
the live site, so a fix for one thing shipped untested next to everything else —
which is exactly how working features kept breaking.

**The staging environment is the Vercel Preview.** Every branch push already
gets one: the real app, the real database, built the way production is. A
separate staging deployment would be a fourth thing to keep in sync, and a
locally-started server would be testing a different artefact from the one being
promoted.

**CI never builds the app.** `e2e.yml` triggers on `deployment_status`, waits
for Vercel, and runs against `environment_url`. Building again in Actions would
need Firebase and Stripe credentials in GitHub, would double the wait, and would
test something other than the artefact that goes live. Before opening a browser
the job asks `/api/version` which commit the preview is serving and fails on a
mismatch — a green run about the wrong code is worse than no run.

**The mock answers the FIXTURE, not the deployment.** `aiMockEnabled()` says a
deployment may mock; `mockForCaller(profile)` decides whether a given request
should, and only the provisioned test account (`e2eFixture: true`) qualifies.
Keying on the deployment alone made staging useless for judging a release: the
owner pasted a ward note and got "Sertraline 100mg mane" back, because the model
was never called. It fails toward the REAL model — an unreadable profile costs a
genuine API call, which is wasteful but honest, where the reverse would quietly
show fabricated clinical content to someone evaluating a release.

**The AI is mocked on previews, and only there.** `aiMockEnabled()` is
double-locked: `E2E_MOCK_AI === '1'` AND `VERCEL_ENV !== 'production'`, so
mis-ticking a checkbox in Vercel cannot serve a doctor a fabricated note. The
canned reply carries real `[key]` markers, so the parser, the typewriter,
`extraSections`, autosave and both exporters all still run for real — only the
model call is replaced.

**The suite signs in for real.** Auth is a Google popup, which headless Chrome
cannot drive, so `/e2e-login` takes an email and password. Injecting a token
into the SDK's IndexedDB was rejected: it depends on Firebase internals and
skips `onAuthStateChanged → profile → shell`, the very path the smoke suite
exists to check. The page is server-rendered and calls `notFound()` without
`NEXT_PUBLIC_E2E`, so on production no form is sent at all.

**The fixture account is not an admin.** Its password lives in GitHub Actions
secrets; a leak must not reach the admin console or the token behind the
Releases actions. `billingExempt` keeps it out of the nightly sweep and the
lifecycle emails, and stops a paywall failing a run for a reason unrelated to
the change under test.

**Promote is guarded on the head sha** the admin was looking at, so two pushes
in quick succession cannot ship a commit whose checks nobody read. It refuses
when a check has not passed; the override needs a typed reason and is logged at
`error` level so it reaches Slack.

**Promoting also brings the other open pull requests forward.** Every promotion
moves main, which leaves every other open pull request behind it, and the
ruleset then refuses them — correctly, since their checks ran against a base
that no longer exists. The panel calls GitHub's update-branch on each one
immediately after a merge and reports what happened, naming any that conflict.
Deliberately NOT a workflow: a push made with the default `GITHUB_TOKEN` does
not trigger other workflows, so an Action doing this would leave every branch up
to date with no checks run against it — up to date and still unpromotable. On
the admin's own token the checks fire.

**The `protect main` ruleset has an EMPTY bypass list**, so GitHub refuses a red
merge and a direct push for the admin too. Adding "Repository admin" would
exempt the only person who pushes — the release token acts as one — and a
ruleset that exempts everybody who uses it enforces nothing. The emergency path
is Enforcement → Disabled → promote → Active, which is what the panel tells the
admin when a merge is refused.

**Check status comes from the Actions API, not the Checks API.** Fine-grained
tokens offer no `Checks` permission, and the panel already needs Actions read
AND write for Re-run — so this is one permission and one source of truth, and
the workflow run id needed for a re-run arrives directly. `summariseRuns` is
pure and unit-tested because it is what decides whether Promote enables. Each
workflow's `name:` and its job id are deliberately the SAME string: branch
protection requires the job name, the panel reads the workflow name.

**Unit tests cover the pure modules only** — `resolveEntitlement`, `sweepAction`,
Stripe event routing, `aiMockEnabled`. Anything needing Firestore or Stripe is
covered by the browser suite against a real deployment, not by mocks that would
only ever prove the mocks work.

**`WORKFLOWS.md` is the regression contract.** Every user-facing pathway, what
it must produce, and what protects it. A workflow listed there is a promise to a
doctor — add its row before adding a feature, and check its expected outputs
before changing code that serves it. Most pathways are still unprotected and the
file says so honestly rather than implying coverage that does not exist.

**The `preview` branch is the signed-in staging URL.** Every pull request gets
its own Vercel preview, but each one is a NEW HOSTNAME, and a browser keeps a
Firebase session per origin — so a fresh sign-in per pull request is not a bug
that can be fixed, it is what different origins mean. The owner therefore has
ONE permanent alias,
`lushnote-app-git-preview-indika-amarasinghe-s-projects.vercel.app`, authorised
once in Firebase → Authentication → Authorized domains, where the session
persists indefinitely.

Keeping it useful is part of opening a pull request: push the branch, then
`git push -f origin <branch>:preview` so that alias serves whatever is currently
under review. One thing at a time, which matches promoting one at a time. The
per-pull-request preview links still work for comparing two builds — they just
require signing in again, because they are different sites.

Note what the authorized-domain list actually governs: OAuth redirects, so
GOOGLE sign-in only. `/e2e-login` is email/password and needs no entry at all,
which is why the browser suite runs against every preview without any of this.

**Deferred deliberately:** Turborepo (one app, nothing to cache — revisit with
the mobile app and a `packages/shared`) and Docker test databases (relevant only
after a Postgres migration). Nothing here blocks either: the tests target URLs,
not infrastructure.

---

## Admin Console (`/admin`)

One client route (`app/admin/page.tsx`) with a `SECTIONS`-driven navbar; render,
nav and `?section=` deep-link all derive from `SECTIONS` + the `PANELS` map — add a
section by adding both entries, nothing else. Sections: **Dashboard, Users,
Feedback, Letterheads, Hospital Forms, Emails, Billing, Appearance, Releases,
Logs & Errors**.

**Security model (the wall is the API, not the rules):** the Admin SDK bypasses
Firestore rules, so every admin route gates through `requireAdmin(req)`
(`lib/adminGuard.ts`) — verifies a Google-signed ID token + an `admin:true` custom
claim (`checkRevoked:true`), with `ADMIN_UID` env as a bootstrap fallback. Grant the
claim with `node scripts/set-admin-claim.mjs <uid>` (`--revoke` to remove). Client
`NEXT_PUBLIC_ADMIN_UID` only *shows* the nav link — it is not a security boundary.

**Privacy wall:** admin endpoints NEVER read clinical content — only `.count()`
aggregates for notes/patients — and `redactUser()` (`lib/firestore/adminUsers.ts`)
allow-lists non-sensitive fields, so `groqApiKey`/`geminiApiKey`/`signatureUrl`
never leave the server. No impersonation/"view as user".

**Users** (`app/api/admin/users/route.ts` + `UsersPanel`): list, detail (counts +
Gemini usage), suspend/reactivate, clear storage, remove, export.
- **Suspend** = `status:'disabled'` + Auth `disabled:true`. Enforced by the app
  layout (Suspended screen) AND server 403 in generate/chat (`status==='disabled'`).
- **Remove** = complete cascade (`cascadeDeleteUser`): `progress_notes where
  userId==uid` (chunked) + `patientProfiles` + `transcriptDrafts` +
  `deletion_feedback/{uid}` + `support_threads/{uid}` + `support_tickets where
  uid==uid` + `letterheadRequests where
  requestedBy==uid` + `users/{uid}` + Storage `signatures/{uid}/`,`recordings/{uid}/`,
  `letterhead-requests/{uid}/` + `adminAuth().deleteUser()`. Requires a typed-email
  match; writes an audit entry. (This is the complete version of the incomplete
  self-delete in `ProfilePanel.tsx`.)
- **Export** = consented users only (`marketingConsent`), name/email/workplace CSV.

**Emails** (`app/api/lifecycle` + `EmailsPanel`): see **Lifecycle Emails** above.

**Releases** (`app/api/admin/releases` + `ReleasesPanel`): the promote surface —
see **Release Pipeline** above. `lib/github.ts` holds every GitHub call.

**Feedback + tickets:** every escalation creates a durable `support_tickets/{id}`
doc (`{uid,ticket,name,email,topic,status:'open'|'resolved'|'closed',threadTs,
channel,createdAt,updatedAt}`) that is NEVER deleted — End chat sets
`status:'closed'`, the admin toggles resolved/reopen (`setTicketStatus` on
`/api/admin/overview`, audited). `support_threads/{uid}` stays the active-thread
pointer (deleted on End chat) and carries `ticketId`. Dashboard "open tickets" =
`support_tickets where status=='open'`.

**Logs & audit** (`lib/firestore/systemLogs.ts`): `logToSink({level,tag,message,
route,status?,uid?})` fire-and-forget → `system_logs`; `writeAudit(...)` →
`admin_audit`. PHI-safe BY CONTRACT — scalar fields only, NEVER a request body /
raw error / note content.

`requestId`, `mode`, `ms` and `uid` are filled in automatically from
`lib/requestContext.ts` (AsyncLocalStorage, Node runtime only), so no call site
has to thread them; `release` comes from `VERCEL_GIT_COMMIT_SHA`. One doctor's
click therefore reads as one story — the provider that refused, the fallback,
the give-up — instead of lines correlated by timestamp. `withRequest(route, fn)`
wraps the POST of generate/transcribe/chat/ocr.

**`tag: 'blocked'` = a doctor was left with nothing**, and is the ONLY thing
logged at `level: 'error'`; a busy model that recovered is a `warn`. Errors post
to `SLACK_WEBHOOK` (deduped per tag+message for 10 min per warm instance), so a
real failure arrives without anyone opening the console. The Logs panel has a
Blocked doctors filter, per-row **req**/**uid** click-to-filter, and Copy. Wired into the generate/transcribe/chat/support/admin
catch blocks + 429s; `app/global-error.tsx` → `/api/log` captures scrubbed client
crashes. Both collections are denied to clients by the catch-all rule (no rule
change) and read only via `app/api/admin/logs`. Retention: add a Firestore TTL on
`system_logs.createdAt` (~90d).

**Env vars:** `ADMIN_UID` (server, bootstrap), `SLACK_WEBHOOK` (moved out of source —
rotate the old hardcoded value), plus the existing `FIREBASE_ADMIN_*`,
`SLACK_BOT_TOKEN`, `SLACK_SUPPORT_CHANNEL`, `LUSHNOTE_GROQ_KEY`. Keep the repo private.

`marketingConsent?: boolean` on `User` (opt-in at onboarding; in `profileValid()`).

---

## Header Holiday Themes

On five days the header's blue background is replaced by a tiled illustration.
Nothing else about the header changes — geometry, glass, children and the tab bar
are untouched.

| Theme | When |
|---|---|
| Christmas | 20–26 December |
| Australia Day | 26 January |
| Anzac Day | 25 April |
| Easter | Good Friday → Easter Monday |
| NAIDOC Week | First Sunday in July, for a week |
| Campaign | An admin-set date range — **beats every calendar theme** |

**No data source, by design.** `lib/holidayTheme.ts` computes every date locally —
Easter from the anonymous Gregorian Computus, NAIDOC Week from the first Sunday in
July — so there is no almanac to fetch, no repo to track and nothing to refresh
each January. Cost is a handful of integer comparisons.

**No blue flash.** `resolveHolidayTheme(new Date())` runs
SYNCHRONOUSLY during the layout's render, so the themed bar is right on the first
paint and stays right through a refresh. Anything async here would flash blue.

**Weight.** Only the active day's tile is ever referenced, so on 360 ordinary days
nothing extra is requested. Tiles live in `/public/holiday/*.webp` (~480×120,
<30 KB, seamless left↔right) and repeat with `repeat-x` — a small file stays sharp
at any width rather than one wide image being stretched. A missing file falls back
to a coloured gradient, so the header is never broken by an absent asset. See
`public/holiday/README.md`.

**The tint must be cleared.** `.ln-glass::before` paints the brand colour ABOVE the
host's own background, so `holidayBackgroundStyle` sets `--lg-tint-opacity: 0`.
Without that the blue covers the artwork at 92%. The scrim in the background stack
then keeps white text readable over any tile.

**Campaign — the one theme with no date.** A named window (`appearance/holidayTiles.campaign`
= `{label, start, end, banner?}`, ISO dates, both inclusive) for a bushfire appeal or a
public-health alert. It is the only theme that cannot resolve synchronously, and the only
one that outranks the calendar — it is put up deliberately, for a reason that matters more
on the day. Dates compare as LOCAL calendar days, so "until the 30th" is the doctor's 30th.

**Artwork is uploaded, not committed.** `/admin?section=appearance` crops, mirrors and
compresses the chosen image in the browser (`buildTileDataUrl`, lib/holidayTiles — same
geometry as the script) and saves it to Storage + `appearance/holidayTiles.tiles.{key}`,
which the header prefers over `/public/holiday/*.webp`. A zoom slider handles the scale
trap: the bar is 60px tall and the tile draws at `auto 100%`, so a whole 1024² source lands
in a 60×60 box and a five-row pattern renders each motif at ~12px.

**Nothing dims the artwork.** Legibility is `.ln-holiday-text`: a blurred wash on `::before`
(soft-edged, so it dissolves into the illustration instead of ending at a line) under three
glyph-tight text-shadows. Strength per theme via `scrims.{key}`, 0–1. A full-width scrim and
a hard-edged chip were both tried and both read as a rectangle; a text-shadow alone cannot
cover enough ground — past a point it only thickens the letters.
`.ln-holiday` also turns off the glass border, inner sheen and frost: the header is a
stacking context, so its `::after` backdrop-filter blurs its OWN background — that was what
smeared the tile.

**Preview:** `/admin?section=appearance` forces a theme via localStorage — that
browser only, survives refresh, invisible to doctors.

---

## Brand Tokens

| Token | Value |
|---|---|
| Logo circle | `#5ad6a7` (mint) |
| Primary / FAB | `#10b981` (emerald-500) |
| Header gradient | `#1d4ed8` → `#2563eb` |
| `--blue` | `#2563eb` |
| `--blue-dk` | `#1d4ed8` |
| `--blue-lt` | `#eff6ff` |
| Teal | `#0891b2` |
| Green | `#059669` |
| Background | `#f8fafc` |
| Card | `#ffffff` |
| Text | `#0f172a` |
| Text2 | `#475569` |
| Text3 | `#94a3b8` |
| Danger | `#dc2626` |
| Font | Inter (Google Fonts) + system-ui fallback |
| Border radius sm | 8px |
| Border radius base | 12px |
| Border radius lg | 16px |

App name: **LushNote** — Short name: **LN**

---

## UI Aesthetic — READ THIS BEFORE BUILDING ANY UI

The existing LushNote visual design is the baseline — keep it. Apply these enhancements on top.

### Apple Liquid Glass (subtle — not overdone)

- **Cards and modals:** `backdrop-filter: blur(12px)` + semi-transparent background (`background: rgba(255,255,255,0.75)`) rather than solid white where it feels natural
- **Tab bar:** frosted — `backdrop-filter: blur(16px)`, `background: rgba(255,255,255,0.85)`
- **Header:** same frosted treatment, border becomes `rgba(255,255,255,0.5)`
- **Shadows:** soft and layered — `0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)`
- **Glass border:** `1px solid rgba(255,255,255,0.45)` on elements where glass is applied

### Animations (subtle — never blocking)

- Tab transitions: `opacity` fade 150ms ease
- Modal enter: `scale(0.97) → scale(1)` + opacity 0 → 1, 200ms ease-out
- Button active: `transform: scale(0.97)`, 100ms
- Toast: slide up + fade in, 250ms ease-out
- Skeleton loaders on data fetch — not spinners where avoidable
- `will-change: transform, opacity` only on elements that actually animate

### Non-negotiable

- `@media (prefers-reduced-motion: reduce)` MUST disable ALL transitions and animations — no exceptions
- No bouncy / spring animations
- No parallax
- No entrance animations on static content
- Never apply glass effect to form inputs — they stay solid white with standard border

---

## Workspace Themes (WP_THEMES)

```typescript
const WP_THEMES = [
  { primary: '#1a56db', dk: '#1347b8', lt: '#ebf0ff' },  // 0 = blue
  { primary: '#7c3aed', dk: '#6d28d9', lt: '#ede9fe' },  // 1 = purple
  { primary: '#0e9f6e', dk: '#0a7d57', lt: '#e3f9ee' },  // 2 = teal
]
```

`applyWorkspaceTheme(themeIndex)` sets CSS custom properties `--blue`, `--blue-dk`, `--blue-lt`
on `:root` from `WP_THEMES[themeIndex]`. Called on sign-in and on every workspace switch.

---

## Note Creation Modes

1. **Paste Transcript** — clipboard paste → TranscriptConfirmModal → TemplatePicker → generate
2. **Dictate Note** — MediaRecorder solo narration → transcribe → generate
3. **Record Session** — in-person (`getUserMedia`) or telehealth (`getDisplayMedia`) → transcribe → generate
4. **Upload Recording** — file drop → transcribe → generate *(hidden in UI, code preserved)*
5. **Create Document** — paste/upload `.txt` → generate

---

## AI Pipeline

**Transcription:** Gemini `gemini-2.5-flash` → fallback Groq `whisper-large-v3-turbo`
**Generation:** Gemini `gemini-2.5-flash` → fallback Groq `llama-3.3-70b-versatile`
**Chat / Q&A:** Gemini `gemini-2.5-flash-lite` → fallback Groq `llama-3.3-70b-versatile`

**Model resolution.** Both providers retire model names, so a 404 (Gemini) or a
decommission error (Groq) asks the key what it can actually run and re-scores.
Gemini WALKS the ranked list (`MAX_MODEL_ATTEMPTS`, 3): a 404 or a 5xx that
outlived the backoff says nothing about the other models a key can run, and one
key sat on 503 from `gemini-flash-latest` across attempts ten minutes apart.
Only a model that ANSWERED is cached — caching the pick before trying it made
one unlucky choice stick for the whole warm instance. The log carries `tried=N`
so a busy model is distinguishable from a key nothing will serve.
Two ranking rules learned the hard way: never prefer a `-latest` alias (it
tracks the newest build, which is the one shedding load with 503), and never
rank Groq models by parameter count — on the free tier the BIGGER model has the SMALLER
per-minute allowance, so ranking by size picked `gpt-oss-120b` (8000 TPM) for a
~12000-token ward note and earned a 413 on every attempt, permanently.

**Reading a Gemini reply.** `parts` is an ARRAY: a 2.5 thinking model can put a
reasoning part before the answer or split a long answer across several, so every
non-`thought` part is joined — reading `parts[0]` handed back a thought and the
caller reported "not valid JSON". Extraction asks for `responseMimeType:
'application/json'` rather than trusting a "return only JSON" instruction, and
carries `finishReason` out: `MAX_TOKENS` means a half-written object that no
repair can parse, and earns one retry with OUR 8192 ceiling dropped (thoughts
spend the same allowance). A 400 is only a bad key when the message says so —
otherwise it is our own request.

**Groq 413.** The refusal quotes the cap it enforced ("Limit 8000, Requested
11808"), so `refitMaxTokens` reads the numbers back and resends once with an
output budget that fits, rather than retrying an identical request that cannot.

**Quota:** `GEMINI_RPD = 20` requests/day per model, tracked in `users/{uid}.geminiUsage`
Structure: `{ [modelKey]: { count: number, date: 'YYYY-MM-DD' } }`
Also cached in `localStorage('ln_gemini_usage')` as backup.
Resets on new UTC date (check `date !== today` → reset count to 0).

---

## Templates

- 116 built-in clinical templates in `data/clinical-templates.json` (merged file)
- Prompts source in `data/templates-prompts.json` — do NOT modify
- Custom templates stored in `users/{uid}.customTemplates`
- Favourite template IDs in `users/{uid}.favoriteTemplateIds`
- Recent usage tracked in `localStorage('lnTemplateUsage')`

### Custom Letter Templates

Doctor-defined letter types, private to their account (`users/{uid}.customLetterTemplates`,
array order = picker priority, ≤15). Each has `{ id, title, description, sections:[{key,heading,description}], prompt }`.
- **Builder:** `components/modals/CustomLetterBuilderModal.tsx` (shared by LetterPicker,
  DictateModal, TemplatePicker letters tab, and Settings). "Refine with AI" →
  `/api/chat` `type:'letter-template'` cleans wording + writes the extraction prompt;
  "Save as written" falls back to a deterministic prompt. Section keys are slugged client-side.
- **Dictation:** DictateModal encodes the template id into the draft as `custom:<id>`.
  `/api/generate` `mode:'letter', letterType:'custom'` builds the JSON contract SERVER-side
  from `customLetter.sections` (server owns the skeleton) → returns `{ sections: {key:...} }`.
- **Store:** `letterType:'custom'` + `customLetterTemplate` + `customLetterSections`
  (per-topic content). Edit page renders one field per section (collapsed-empty like note
  sections); PDF/preview/email stitch sections under bold headings with `letterSalutation`.
  A deleted template's dictation degrades to a free-text letter (never lost).

---

## Auth Flow

```
Page load
→ Firebase onAuthStateChanged
  → no user        → landing page
  → has user       → load Firestore profile
    → new/missing  → onboarding (5 steps)
    → incomplete   → onboarding
    → complete     → app shell → active tab
```

Onboarding steps (6, all in `app/onboarding/page.tsx`): (1) About you — name +
credentials + position + provider no. + work phone (2) Workplace (3) Email
template (4) AI keys — separate Gemini and Groq inputs (5) Signature (6) Review.
Only name, workplace and the terms tick are required; 3–5 are skippable.
Every review row carries a pencil: plain text fields edit in place, workplace /
AI keys / signature reopen their step with a **Back to review** return. The full
pathway and its expected outputs are recorded in `WORKFLOWS.md`.

---

## Workplace System

- Multiple workplaces per user, one active at a time
- Each workplace: `name, type, regSystem, regFormat, regPattern, regTemplate, themeIndex`
- `regPattern` — generated regex string e.g. `"^\d{8}[A-Za-z]{2}$"`
- `regTemplate` — display template e.g. `"########AA"`
- Three workspace colour themes indexed by `themeIndex` (see WP_THEMES above)
- `detectIdPattern(example)` — tokenises example ID into alpha/digit/separator runs, builds regex + template

---

## Personalisation

`getPersonalisationPrefix()` prepends clinician profile, treatment modalities, document style,
and note length instruction to every AI generation system prompt.
Limits: `professionalIdentity` 936 chars, `treatmentApproaches` + `documentStyle` 1000 chars each.

---

## Transcript Redaction

`applyTranscriptRedactions()` — strips names (title+name regex), DOB (date patterns),
email/phone/address — applied before any AI call. Controlled by `profile.transcriptPrivacy`.

---

## Recording

- `MediaRecorder`, 1-second chunks, `audioBitsPerSecond: 48000`
- Timer: `Math.floor((Date.now() - _recStartTime) / 1000)` — wall clock, NOT an incrementing counter
- Resync on `visibilitychange` (phone screen lock/unlock cycle)
- Auto-stop configurable via `recordingDefaults.autoStopMinutes` (default 60)
- **Interrupted session:**
  - On START: `localStorage.setItem('_ln_rec_interrupted', JSON.stringify({ts, mode, startTime}))`
  - On STOP (normal): `localStorage.removeItem('_ln_rec_interrupted')`
  - On page load: check for key → show yellow banner if found

---

## Delete Account Flow (CRITICAL — currently broken in app)

Exact sequence — do not deviate:
1. Modal: 11 reason chips (multiselect) + optional message textarea
2. `reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider())` — **popup not redirect**
3. `setDoc(doc(db,'deletion_feedback',uid), {userId,email,reasons,message,deletedAt:serverTimestamp()})`
4. Batch delete `progress_notes` where `userId==uid` — in batches of 500
5. `getDocs(collection(db,'users',uid,'patientProfiles'))` → batch delete all
6. `deleteDoc(doc(db,'users',uid))`
7. `deleteUser(auth.currentUser)`
8. `sessionStorage.removeItem('groq_api_key')` + `sessionStorage.removeItem('gemini_api_key')`
9. `router.push('/account-deleted')`

Error `auth/popup-blocked` → toast "Please allow popups for this site."

Reason chips (11 exact): Security Concerns, Privacy Concerns, App Crashed / Bugs, Difficult to Use,
Templates Not Working, Unsatisfied with AI Output, Missing Features, Too Complex,
Switching to Another Tool, No Longer Need the App, Other

---

## Groq Rate Limit Handling

1. Parse wait: `/try again in (?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+\.?\d*)s/i`
2. Convert to total seconds
3. If wait > 120s → toast "Daily Groq limit reached. Resets midnight UTC." (no banner)
4. Else → show countdown banner with animated progress bar, auto-dismiss + retry at 0
5. Exponential backoff: `delay = baseDelay × 2^attempt`, max 3 attempts

---

## Initials Bug

```typescript
export function getInitials(displayName: string): string {
  if (!displayName) return 'LN'
  const cleaned = displayName.replace(/^(doctor|dr\.?)\s+/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}
```

---

## buildPreviewHTML(f)

Real-time formatted note preview. Input: note fields object. Output: HTML string.

Field label map:
```
patient→Patient, reg_number→Reg Number, date→Date, time→Time, clinician→Clinician,
session_number→Session Number, attendance→Attendance, diagnosis→Diagnosis,
presentation→Presentation, history→History, medications→Medications,
mse→Mental State Examination, content→Session Content, scales→Rating Scales,
risk→Risk Assessment, referrals→Referrals & Correspondence, summary→Summary, nextsteps→Next Steps
```

Field render order: patient, reg_number, date, time, clinician, session_number, attendance,
diagnosis, presentation, history, medications, mse, content, scales, risk, referrals, summary, nextsteps

Lines starting `N. ` → `<ol><li>`. Lines starting `- ` or `• ` → `<ul><li>`.
Empty sections omitted. All empty → show placeholder "Your note preview will appear here".
ALL user data must be passed through `escapeHtml()` before inserting into HTML.

---

## Typewriter Animation (field population during generation)

1. Status bar cycles every 600ms: "Transcribing..." → "Analysing..." → "Generating..." → "Formatting..."
2. Fields populate character-by-character via `setInterval` at 15ms per character
3. Field order: patient, date, diagnosis, presentation, history, medications, mse, content, scales, risk, referrals, summary, nextsteps
4. Shimmer bar replaces patient/date text in current note bar during animation
5. Auto-save disabled during animation, fires once on completion

---

## Transcript Q&A — Exact System Prompt

```
You are a clinical documentation assistant. The user is a psychiatrist reviewing a session transcript.
Answer questions using ONLY information explicitly present in the transcript below.
Do not infer, assume, or fabricate any clinical information.
If the answer is not clearly stated, say so honestly.
If making a reasonable inference (not directly stated), mark it clearly as inferred.

Respond ONLY in this exact JSON format with no other text:
{
  "found": true or false,
  "inferred": true or false,
  "answer": "Your answer here",
  "quote": "Exact words from transcript supporting this, or empty string"
}

TRANSCRIPT:
{transcript}
```

---

## trsHighlightQuote

1. Receive `quote` string from AI response JSON
2. Try exact match in transcript element's `textContent`
3. If no match: try first 5 words of quote as fuzzy match
4. If match found: wrap in `<mark class="trs-hl" style="background:#fef08a">` using Range API
5. Expand transcript if collapsed
6. `mark.scrollIntoView({ behavior: 'smooth', block: 'center' })`
7. If no match: do nothing (do not show error)

---

## lnRecallSearch (AI assistant patient recall)

```typescript
function lnRecallSearch(query: string, allNotes: Note[]): Note[] {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  const bigrams = keywords.slice(0,-1).map((w,i) => w + ' ' + keywords[i+1])
  const tokens = [...keywords, ...bigrams, ...expandTimeVariants(keywords)]
  const searchFields: (keyof Note)[] = ['transcript','presentation','history','content','summary','mse']
  return allNotes
    .map(note => ({
      note,
      score: tokens.reduce((s, t) => s + (searchFields.some(f => ((note[f] as string) || '').toLowerCase().includes(t)) ? 1 : 0), 0)
    }))
    .filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score)
    .slice(0, 3)
    .map(x => x.note)
}
// expandTimeVariants: "9pm" → ["9:00 p.m.", "9 pm", "21:00"], etc.
```

---

## FAB Chat

- Green circle `#10b981`, `position: fixed`, `bottom: 80px`, `right: 16px`, `z-index: 60`
- Click → 2 sub-buttons slide up: "AI Assistant" + "Live Support"
- Slack webhook: `'https://hooks.slack.com' + '/services/T0B5HRCD3QT/B0B5X3GJYBW/wmD9BaIPKisWj0rQ67vWdmnQ'`
  (split string prevents GitHub secret scanning)
- Slack failure → fallback `mailto:iamarasinghe96@gmail.com`

---

## LUSHNOTE_KB (inject verbatim into AI assistant system prompt)

```
LushNote is a clinical note builder for psychiatrists.
Features: 116 clinical note templates, voice recording and transcription, AI note generation, patient management, PDF/clipboard/email export, custom templates.
API: Users bring their own Gemini API key (free from aistudio.google.com) and optionally Groq key.
Gemini limit: 20 notes/day free tier. Groq key extends this significantly.
Security: Notes stored in Firebase Firestore, encrypted at rest. Audio is never stored — transcribed then immediately discarded.
Privacy: Transcript redaction available in Settings > Transcripts. Redacts names, DOB, other identifiers.
Add to home screen: iOS — tap Share button then "Add to Home Screen". Android — tap the install prompt banner.
Common issues: Generation fails → check API key in Settings > API Keys. Recording won't start → check microphone permissions in browser settings.
Templates: 116 built-in templates across Progress Notes, Assessments, Therapy Notes, Risk & Safety.
Export: PDF (formatted A4), clipboard copy, email via mailto with professional cover letter.
Custom templates: Create in Settings > Templates with your own AI instructions.
Personalisation: Set your professional identity, treatment approaches, and document style in Settings > Personalisation to customise all AI outputs.
```

---

## Export

buildNoteText(f): plain text, ALLCAPS section headers, blank line between sections.

buildCoverLetterEmail(f, profile):
```
Subject: Progress Note — {patient} — {date}

{profile.emailPretext}

{buildNoteText(f)}

Regards,
{displayName}
{credentials}
```

PDF: jsPDF, A4, 20mm margins, Helvetica fallback, 12pt body, section headers bold 9pt uppercase.
Print CSS: `@media print` hides `[data-header]`, `[data-tab-bar]`, buttons, FAB.

---

## Transcript Confirm Modal Logic

Triggered after paste/transcription, before TemplatePicker:
1. Word count < 80 → error toast, stop
2. No clinical keywords found (patient, symptom, diagnosis, treatment, medication, therapy, appointment, session, presenting, mood, affect, behaviour, cognition) → error toast, stop
3. Open TranscriptConfirmModal
4. Patient search autocomplete from `_patientIndex` (built from all notes)
5. No match → show DOB (DD/MM/YYYY) + Gender fields for new patient
6. Reg number suggestion: `YYYYMMDDNNN` where NNN increments from existing records
7. On confirm → open TemplatePicker

---

## Current Note Bar (Edit tab)

Green gradient bar at top of edit tab when note is loaded:
```
[shimmer during generation | "Patient · Date"] [Change Template] [Transcript] [Reassign] [+ New Note]
```

Change Template → TemplatePicker → confirm → re-run generation with same transcript + new template
Transcript → navigate to `/transcript` tab
Reassign → ReassignModal (patient autocomplete) → update patient + reg_number + auto-save
+ New Note → confirm unsaved changes → clear all fields + `currentNoteId = null`

---

## Edit Tab Field Order

patient, reg_number, date (calendar picker), time (start+end 5-min slots 07:00–21:00),
clinician, session_number (auto-fill from history +1), attendance (auto-fill from history),
diagnosis, presentation, history, medications, mse, content, scales, risk, referrals, summary, nextsteps

Patient autocomplete: builds `_patientIndex` from all notes.
On select: auto-fill reg_number, session_number (+1), attendance (last value), show visit count chip.
Reg validation: `new RegExp(workplace.regPattern).test(value)` → green/red border.
Auto-numbering: Enter on `N. ` line → insert `(N+1). ` in list fields (content, scales, risk, referrals, nextsteps).

---

## Auto-Save

Debounced 800ms after any field blur. Requires patient field non-empty.
On save: 0.6s green border flash animation on the saved field.
Uses `updateNote` if `currentNoteId` exists, else `createNote` and store returned ID.
Suspended during typewriter animation (Fix 09). Fires once on animation completion.

---

## API Quota Bar (Generate tab)

Below mode buttons. Two parts:
1. Gemini bar: reads `users/{uid}.geminiUsage['gemini-2.5-flash']` → shows `Used X / 20 today` with progress bar. At 20/20: orange warning.
2. Groq chip: shown only if `sessionStorage.getItem('groq_api_key')` exists → green "Groq fallback active"

---

## Patient Detail View

Gender-based inline SVG avatar (no external file):
- Male: head circle + shoulders path, fill `#93c5fd`, circle bg `#dbeafe`
- Female: head circle + narrower shoulder path, fill `#f9a8d4`, circle bg `#fce7f3`
- Neutral/other/unknown: fill `#cbd5e1`, circle bg `#f1f5f9`

Session cards: date, time, content snippet (120 chars), Latest badge (blue) / Past badge (gray), Delete button.
Delete: `window.confirm` → `deleteDoc` → refresh.
Click card: `router.push('/edit?noteId={id}')`.

---

## Patient Filter Bar

Sort: Recent | A–Z | Most Visits (radio)
Quick filters: Today | This Week | This Month (toggle chips)
Search: text input filters by patient name (case-insensitive)
All filters combine AND logic.

---

## Settings — Add to Home Screen

iOS: `navigator.userAgent` includes `iPhone`|`iPad`|`iPod` → show 3-step sheet modal.
Android: capture `beforeinstallprompt` event → "Install App" button → `.prompt()`.
Standalone: `window.matchMedia('(display-mode: standalone)').matches` → "LushNote is already installed ✓".

---

## API Keys Panel — Gemini Usage Display

Reads `profile.geminiUsage['gemini-2.5-flash']`, compares date to today.
Shows progress bar `usedToday / 20`. At limit: orange. Below: blue.

---

## Custom Template Builder — Full Fields

title (required), category (text + datalist), specialty (Psychiatry|Psychology|General Practice|Paediatrics|Other),
tplType (session|document|both), description (required), sections (11 checkboxes),
noteLength (brief|balanced|detailed radio), additionalInstructions (textarea optional).

`assemblePrompt(form)` builds AI prompt from sections + noteLength + additionalInstructions in real-time.
Show assembled prompt in read-only preview box below the form.

Sections: diagnosis, presentation, history, medications, mse, content, scales, risk, referrals, summary, nextsteps.

---

## Settings Deep-link

User menu in header has 7 labelled links to `/settings?tab={tabId}`:
profile, workplaces, templates, transcripts, api-keys, personalisation, subscription

`app/settings/page.tsx` reads `?tab=` from `useSearchParams()` on mount and sets active panel.

`openSettings(tab: string)` utility: `window.location.href = '/settings?tab=' + tab`

---

## Transcript Tab

Hidden 5th tab — visible in TabBar only when `lastTranscript` is non-null.
Route: `/transcript`. Redirect to `/generate` if no transcript on mount.

Raw transcript: default collapsed to 6 lines with fade overlay. "Show more / Show less" toggle.
AI Q&A chat below: user types question → POST `/api/chat` with `type: 'transcript-qa'` → response JSON → display + highlight quote.

---

## Landing Page

Nav: logo + "Sign In" + "Sign Up Free" (both → Google sign-in popup)
Hero: "Clinical notes in seconds" + subheading + RACGP/FRANZCP/RANZCP badge + 2 CTAs + `bg-landing.svg`
How it works: 4-step strip (Record → Transcribe → Generate → Export)
Features grid: 116 templates, privacy-first, multi-workplace, Gemini+Groq, custom templates, PDF/email
5 modes section: Paste, Dictate, Record, Create Document, Upload (coming soon)
Bottom CTA: blue gradient, "Document smarter. Save one more life."
Footer: "© 2025 LushNote. Built to save doctors." + Privacy · Terms · Contact

---

## Gemini Usage Increment

After each successful Gemini API call in any API route:
```typescript
// In lib/firestore/profiles.ts:
export async function incrementGeminiUsage(uid: string, modelKey: string) {
  const today = new Date().toISOString().slice(0, 10)
  const db = getFirestore()
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  const usage = snap.data()?.geminiUsage || {}
  const existing = usage[modelKey] || { count: 0, date: today }
  const newCount = existing.date === today ? existing.count + 1 : 1
  await updateDoc(ref, { [`geminiUsage.${modelKey}`]: { count: newCount, date: today } })
}
```

---

## Safari / iOS Rules

- No lookbehind regex `(?<=...)` — crashes Safari < iOS 16.4. Use `/[.!?]+\s+/` instead.
- No `??` nullish coalescing on older targets — use ternary.
- Optional chaining `?.` is fine (Safari 13.1+ / iOS 13.4+).
- All API calls through Next.js API routes — no browser CORS issues.

---

## DO NOT Rules

- Do NOT hardcode any API key or Firebase config value
- Do NOT store patient data in localStorage or sessionStorage
- Do NOT use lookbehind regex
- Do NOT add `console.log` debug statements
- Do NOT add defensive code (retries, fallbacks, timeouts) without understanding the real failure mode
- Do NOT add functions that reference DOM element IDs that don't exist yet
- Do NOT combine multiple fix concerns in one prompt
- Do NOT add emoji to UI unless explicitly specified in this file
- Do NOT add comments unless the WHY is non-obvious
- Do NOT create new files outside the repo structure above without explicit instruction
- Do NOT write to Firestore directly from client components — always go through API routes or `lib/firestore/` functions
- Do NOT apply glass/frosted effect to form inputs — they stay solid white
- Do NOT skip `prefers-reduced-motion` — it is non-negotiable
- Always run `tsc --noEmit` after editing TypeScript
- Do NOT push to main — see **Git & Release Workflow** below

---

## Git & Release Workflow — REPLACES every earlier push rule

The rules this replaces said to commit to main directly and to run
`git push origin HEAD:main` after every push. Both are now forbidden. main IS
lushnote.com.au, so pushing to it published untested code to doctors mid-clinic,
and that is what kept breaking working features when an unrelated one was fixed.

- **NEVER push to main.** Branch protection rejects it. Do not run
  `git push origin HEAD:main` under any circumstances.
- Start from main: `git checkout main && git pull origin main`, then a branch.
- Before pushing: `npm run typecheck && npm run test:unit && npm run test:e2e`
  (e2e runs whatever the local environment allows — the public specs need
  nothing; CI runs the full suite against the preview).
- Push the branch and open a pull request to main. Vercel builds a Preview and
  Actions runs `quality` and `e2e` against it.
- Then `git push -f origin <branch>:preview`, so the owner's permanent staging
  alias serves the thing under review. Without it they must sign in again on a
  new hostname every time — see **The `preview` branch** under Release Pipeline.
- **Do NOT merge pull requests and do NOT delete branches.** The owner reviews
  the preview and promotes from `/admin?section=releases`. Your job ends at a
  green pull request.
- If `e2e` fails on something unrelated to the change, say so in the pull
  request body. Never delete or blanket-skip a test to get a green light — a
  flaky test is quarantined with `test.fixme()`, a dated comment and a
  follow-up, never removed.
- A workflow file must EXIST on main before an event can trigger it — a brand-new
  workflow will not fire from a branch. But once it is there, EDITS take effect
  immediately on the branch: a `deployment_status` run executes the workflow
  from the deployed commit, not from main. Verified — an error message added on
  a branch appeared in that branch's own run. So a workflow edit CAN be
  validated by its own pull request; only a new workflow cannot.
