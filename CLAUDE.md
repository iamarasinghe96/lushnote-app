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
  api/
    transcribe/route.ts
    generate/route.ts
    chat/route.ts
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
```

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
referrals, summary, nextsteps, transcript, transcriptMode, extraSections, createdAt, updatedAt
```

`transcript` — raw transcript text (string, optional)
`transcriptMode` — `'paste' | 'conversation' | 'dictation' | 'document'`
`extraSections` — serialized JSON (string, optional, ≤30000) of template-specific
sections + render order — see **Template Sections** below. Absent on old notes.

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
          && request.resource.data.keys().hasOnly([
               'userId','patient','reg_number','date','time','clinician',
               'session_number','attendance','diagnosis','presentation',
               'history','medications','mse','content','scales','risk',
               'referrals','summary','nextsteps','transcript','transcriptMode',
               'extraSections','createdAt','updatedAt'
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
          && (!('notesMigrated'      in d) || (d.notesMigrated      is bool))
          && (!('workplaces'         in d) || (d.workplaces         is list   && d.workplaces.size()         <= 30))
          && (!('favoriteTemplateIds'in d) || (d.favoriteTemplateIds is list  && d.favoriteTemplateIds.size() <= 200))
          && (!('customTemplates'    in d) || (d.customTemplates    is list   && d.customTemplates.size()    <= 50));
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
                    && (!('status' in request.resource.data) || request.resource.data.status == 'active');
      allow update: if owns(userId) && profileValid() && noPrivilegeEscalation();
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

Onboarding steps: (1) Name + credentials (2) Workplace setup (3) Email template (4) Gemini key (optional) (5) Confirm

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
Footer: "© 2025 LushNote. Built to save one more life." + Privacy · Terms · Contact

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
- Always commit to main directly — no new branches
- Always start with: `git checkout main && git pull origin main`
- After every push (regardless of which branch the session instructs), ALWAYS also run `git push origin HEAD:main` so Vercel deploys immediately — never leave changes only on a feature branch
