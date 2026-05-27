# LushNote — Claude Code Project Bible

## What This Is

LushNote is a clinical note builder for psychiatrists. This repo is a migration from a
single-file HTML/JS/CSS SPA to a proper Next.js application. The goal is a clean,
layered build where each prompt layer produces working code with no defensive scaffolding
or confused stubs.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS (mobile-first) |
| Backend | Next.js API routes (Vercel serverless) |
| Auth / DB | Firebase Auth + Firestore |
| AI — primary | Gemini API (`gemini-2.5-flash`) |
| AI — fallback | Groq API (`llama-3.3-70b-versatile`, `whisper-large-v3-turbo`) |
| Hosting | Vercel |

---

## Repo Structure (target)

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
  settings/
    page.tsx
  api/
    transcribe/route.ts
    generate/route.ts
    chat/route.ts
components/
  ui/                       — shared primitives
  modals/                   — recording, template picker, patient, etc.
  tabs/                     — tab bar
lib/
  firebase.ts               — Firebase init (env vars only)
  gemini.ts                 — Gemini API client
  groq.ts                   — Groq API client
  firestore/
    notes.ts
    profiles.ts
    patients.ts
types/
  index.ts                  — all shared TypeScript interfaces
data/
  templates-prompts.json    — 116 clinical templates (import as-is)
public/
  icon-512.png
  icon-192.png
  icon.svg
  assets/                   — bg SVGs and other static files
```

---

## Environment Variables

All secrets live in `.env.local` (never hardcoded). The following are required:

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
GEMINI_API_KEY            — server-side only (API routes)
```

User-supplied keys (stored per-user in Firestore, loaded to sessionStorage at sign-in):
- `groqApiKey` — user provides their own Groq key

---

## Firebase Project

- **Project ID:** `lush-note`
- **Auth domain:** `lush-note.firebaseapp.com`
- **Collection:** `progress_notes`
- **User profiles:** `users/{uid}`
- **Patient profiles:** `users/{uid}/patientProfiles/{profileId}`

### Storage Rules — STRICT

| Data | Storage |
|---|---|
| Patient notes | Firestore `progress_notes` only — never client storage |
| Patient profiles | Firestore `users/{uid}/patientProfiles/` only |
| User profile | Firestore `users/{uid}` only |
| Groq API key | `sessionStorage` (runtime) + Firestore (persistent) |
| Template usage | `localStorage('lnTemplateUsage')` |

On sign-out: all in-memory state clears. `sessionStorage` wipes on tab close.

`getGroqKey()` reads `sessionStorage` only — no localStorage fallback. On sign-in, `profile.groqApiKey` is copied to sessionStorage.

---

## Firestore Note Fields

Fields on `progress_notes/{noteId}`:
`userId, patient, reg_number, date, time, clinician, session_number, attendance,
diagnosis, presentation, history, medications, mse, content, scales, risk,
referrals, summary, nextsteps, transcript, transcriptMode, createdAt, updatedAt`

`transcript` — raw transcript text (string, optional)
`transcriptMode` — how the note was created: `'paste' | 'conversation' | 'dictation' | 'document'`

Adding new fields requires updating Firestore security rules AND the validation function.

---

## Firestore Security Rules (current — deployed)

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
          && request.resource.data.keys().hasOnly([
               'userId','patient','reg_number','date','time','clinician',
               'session_number','attendance','diagnosis','presentation',
               'history','medications','mse','content','scales','risk',
               'referrals','summary','nextsteps','transcript','transcriptMode',
               'createdAt','updatedAt'
             ]);
    }

    function profileValid() {
      let d = request.resource.data;
      return (!('displayName'        in d) || (d.displayName        is string && d.displayName.size()        <= 200))
          && (!('credentials'        in d) || (d.credentials        is string && d.credentials.size()        <= 200))
          && (!('email'              in d) || (d.email              is string && d.email.size()              <= 300))
          && (!('status'             in d) || (d.status             is string && d.status.size()             <= 50))
          && (!('tier'               in d) || (d.tier               is string && d.tier.size()              <= 50))
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
    }

    match /deletion_feedback/{docId} {
      allow create: if verified() && request.resource.data.userId == request.auth.uid;
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Security architecture decisions

| Concern | Decision |
|---|---|
| Note list cross-user access | Fixed — `allow list` now requires `resource.data.userId == request.auth.uid` |
| Tier/status self-promotion | Fixed — `noPrivilegeEscalation()` on update; create locks tier to `free`, status to `active` |
| Slack webhook in source | Accepted — string-split mitigates GitHub secret scanning; true fix needs a backend proxy not feasible on static hosting; no patient data exposure risk |
| innerHTML with user data | Fixed in SPA — `esc()` applied to all user-data-sourced strings before render |
| Clinical data to Groq/Gemini | Architectural — user configures their own key and consents to this; no code change needed |

In Next.js: API routes are the primary access layer. Firestore rules are defence-in-depth.
Do NOT write to Firestore directly from client components — always go through API routes.

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

## Note Creation Modes

Five modes, all route through the same generation pipeline:

1. **Paste Transcript** — clipboard paste → template picker → Gemini/Groq → populate fields
2. **Dictate Note** — MediaRecorder solo narration → transcribe → generate
3. **Record Session** — in-person (`getUserMedia`) or telehealth (`getDisplayMedia`) → transcribe → generate
4. **Upload Recording** — file drop → transcribe → generate *(hidden in UI, code must be preserved)*
5. **Create Document** — paste/upload `.txt` → generate

---

## AI Pipeline

**Transcription:**
- Primary: Gemini `gemini-2.5-flash` (upload audio file)
- Fallback: Groq `whisper-large-v3-turbo`

**Generation:**
- Primary: Gemini `gemini-2.5-flash`
- Fallback: Groq `llama-3.3-70b-versatile`

**Chat (transcript Q&A + support):**
- Primary: Gemini `gemini-2.5-flash-lite`
- Fallback: Groq

**Quota tracking:** 20 req/day per Gemini model, stored in Firestore `users/{uid}.geminiUsage`.

---

## Templates

- 116 built-in clinical templates in `data/templates-prompts.json` — import as-is
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

Onboarding steps:
1. Display name + credentials
2. Workplace setup
3. Email template selection
4. Gemini API key (optional)
5. Confirm & start

---

## Workplace System

- Multiple workplaces per user, one active at a time
- Each workplace: name, type, regSystem, regFormat, regPattern, regTemplate, themeIndex
- Three workspace colour themes (blue / purple / teal variants)
- Patient ID pattern detection from example ID

---

## Personalisation

`getPersonalisationPrefix()` prepends clinician profile, treatment modalities, document
style, and note length instruction to every AI system prompt.

---

## Transcript Redaction

`applyTranscriptRedactions()` — strips names (title+name regex), DOB (date patterns),
email/phone/address — applied before any AI call.

---

## Recording

- `MediaRecorder` with 1-second chunks, `audioBitsPerSecond: 48000`
- Timer resyncs on `visibilitychange` (phone screen unlock)
- Interrupted session detection via localStorage flag → banner on next load
- Auto-stop configurable (default 60 min)

---

## Export

- PDF via jsPDF (A4, full note formatted with sections)
- Print via `window.print()`
- Clipboard via `navigator.clipboard.writeText()`
- Email to colleague via `mailto:`

---

## Safari / iOS Rules

- **No lookbehind regex** `(?<=...)` — crashes Safari < iOS 16.4. Use `/[.!?]+\s+/` instead.
- **No `??` nullish coalescing** on older Safari — use ternary.
- Optional chaining `?.` is fine (Safari 13.1+ / iOS 13.4+).
- All API calls go through Next.js API routes — no browser CORS issues.

---

## Layer Build Plan

Each layer is a separate Claude Code prompt. Planning mode first → review → execute.
Do not skip layers or combine concerns.

```
Layer 1   Scaffold            Directory structure, config files, no logic
Layer 2   Types               TypeScript interfaces — Patient, Note, Template, User, Workplace
Layer 3   Services            Firebase, Gemini, Groq — isolated modules
Layer 4   Auth                Sign-in flow, route protection, session
Layer 5   UI Shell            Layout, navigation, tab routing
Layer 6   Note Engine         Recording / transcription / generation workflow
Layer 7   Patient History     Firestore-backed patient list and profiles
Layer 8   Settings            All settings panels wired to Firestore
Layer 9   Templates           116 templates, search, custom builder
Layer 10  Export              PDF, clipboard, email
Layer 11  Security            CSP, Firestore rules audit, rate limiting
Layer 12  Deployment          Vercel config, env vars, production build
```

---

## DO NOT Rules

- Do NOT hardcode any API key or Firebase config value
- Do NOT store patient data in localStorage or sessionStorage
- Do NOT use lookbehind regex
- Do NOT add `console.log` debug statements
- Do NOT add defensive code (retries, fallbacks, timeouts) without understanding the real failure mode
- Do NOT add functions that reference DOM element IDs that don't exist yet
- Do NOT combine multiple layer concerns in one prompt
- Do NOT add emoji to UI unless explicitly requested
- Do NOT add comments unless the WHY is non-obvious
- Do NOT create new files outside the structure above without explicit instruction
- Always run `tsc --noEmit` after editing TypeScript to catch errors before pushing

---

## UI Aesthetic

The existing LushNote visual design is the baseline — keep it. Apply these enhancements on top.

### Apple Liquid Glass (subtle — not overdone)
- Cards and modals: `backdrop-filter: blur(12px)` + semi-transparent background
  (`background: rgba(255,255,255,0.75)`) rather than solid white where it feels natural
- Tab bar: frosted — `backdrop-filter: blur(16px)`, `background: rgba(255,255,255,0.85)`
- Header: same frosted treatment, border becomes `rgba(255,255,255,0.5)`
- Shadows: soft and layered — `0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)`
- On elements where glass is applied, border is `1px solid rgba(255,255,255,0.45)`

### Animations (subtle — never blocking)
- Tab transitions: `opacity` fade 150ms ease
- Modal enter: `scale(0.97) → scale(1)` + opacity 0 → 1, 200ms ease-out
- Button active: `transform: scale(0.97)`, 100ms
- Toast: slide up + fade in, 250ms ease-out
- Skeleton loaders on data fetch — not spinners where avoidable
- Use `will-change: transform, opacity` only on elements that actually animate

### Non-negotiable
- `@media (prefers-reduced-motion: reduce)` disables ALL transitions and animations
- No bouncy/spring animations
- No parallax
- No entrance animations on static content
