# Product ideas backlog

Ideas the owner collected in October 2026 while reviewing other clinical scribe
and practice management tools, distilled into what they would mean for
LushNote. **Nothing here is approved to build.** The owner picks; an agent
builds only what was picked.

The raw research material (exports, screenshots, page captures) was reviewed
and then deliberately deleted. Do not re-collect it into this repository.

Assessments assume LushNote's current users: mostly hospital doctors. Some ideas
change value if LushNote moves into general practice or private practice, and
say so.

## Ranked

| # | Idea | Size | Why |
|---|------|------|-----|
| 1 | In-app "AI and your data" FAQ | Small | Doctors and hospitals ask the same five questions; answering them in the app builds trust. |
| 2 | Cancellation reasons before billing | Small | Saves some cancellations and gives feedback. Do once there are paying doctors. |
| 3 | Document style presets | Small | Most doctors will not write a style prompt; one tap gets them a good one. |
| 4 | Trial clarity and a first-visit checklist | Small | States trial dates up front and guides a new doctor to a first finished note. |
| 5 | Demo patient and friendly empty states | Small | A new account never opens on a blank screen. |
| 6 | Background box for outside documents | Small to medium | Hospital doctors work from other people's paperwork constantly. |
| 7 | Draft vs final notes, with past notes beside the editor | Medium | Clear status for every note and the patient's history in view while writing. |
| 8 | Recording consent field and recording options | Small to medium | Records consent with the note; lets doctors choose whether audio is kept. |
| 9 | CPD log | Medium | Every registered doctor must log CPD, hospital doctors included. |
| 10 | Government certificates (capacity, Centrelink) | Medium | Reuses the hospital-form engine for forms ward and ED doctors also fill. |
| 11 | Shared templates between colleagues | Medium | A growth loop: one doctor's template brings in their team. |
| 12 | Problem list that carries forward | Medium | Natural next step from tracked patient details. |
| 13 | Ask questions of a patient's documents | Medium | "What did the discharge summary say about anticoagulation?" |
| 14 | Consultations in other languages | Test first | No language setting in transcription today. |
| - | Parked: billing-code tools, AI clinical advice, patient pre-visit questionnaires, practice-system integrations, invoicing and scheduling, freemium pricing | | See Parked. |

## Details

### 1. In-app "AI and your data" FAQ
A short page under Settings with honest answers to:
1. What does the AI do, and what does it not do?
2. Is my data secure? (encryption at rest and in transit, access controls)
3. Where is my data processed? (name each provider and country)
4. Do the AI providers keep or learn from my data?
5. How accurate is it, and who is responsible for the final note? (the doctor)

**Constraint:** the answers must match what the code does. Today LushNote
stores notes, transcripts and audio backups, and its AI providers include a
US-based one. Say so plainly rather than copying anyone else's "processed
onshore" claim. This goes with the Privacy wording update (provider and country
table), which is needed anyway under APP 1 and APP 8.

### 2. Cancellation reasons before billing
Before the billing portal: "Need help with something?" with reasons. Each leads
somewhere useful.
- **Technical issue:** opens Live Support on that topic.
- **Too complex:** a short how-to, or an offer of a call.
- **Not using it enough:** offer to pause. Stripe supports pausing.
- **Switching tools:** a one-line "what does it do better?" box.

Going straight to billing stays one tap away; cancelling must stay easy.

### 3. Document style presets
Personalisation → Document style already reaches note generation
(`lib/personalisation.ts`). Add one-tap presets:
- **Concise shorthand:** dot points, standard abbreviations (Pt, Hx, Dx, Mx, Ix,
  Rx, NAD, MSE, SOB, BP), time shorthand (1/7, 2/52, 3/12).
- **Full prose.**
- **SOAP.**
- **Problem-oriented:** urgent and active problems first, findings and
  investigations under each problem.

Rules worth making default, whatever the preset:
- Omit a heading when nothing was said. Never fill a gap with plausible text.
- Correct transcribed Australian drug names.
- Convert lay descriptions to medical terms.
- Use en-AU spelling.

### 4. Trial clarity and a first-visit checklist
- **At signup, a trial card:** exact start and end dates, the first charge date,
  and "we'll remind you before it ends" (then send that reminder).
- **On first visit, a small "1 of 4" checklist:** profile, workplace,
  letterhead, first note. It stays reachable until done.

### 5. Demo patient and friendly empty states
- **One clearly labelled demo patient** with a sample note and letter, so a new
  doctor sees what finished output looks like. Easy to archive.
- **Every empty list** shows a short line and one obvious next step.
- **Home screen:** an "unfinished notes" reminder.

### 6. Background box for outside documents
A second input beside the consult: paste or photograph a referral, an ED note or
another hospital's discharge summary. The AI reads it as background but never
copies it wholesale into the note.

### 7. Draft vs final notes, with past notes beside the editor
- **Every note shows Draft or Final;** "Save as final" locks the status, and
  edits after that are visible.
- **A panel beside the editor** lists the patient's previous notes, filterable,
  readable without leaving the current one.
- **Autosave status** stays visible (already partly there: "Not saved" on failure).

### 8. Recording consent and recording options
- **A "patient consented to recording" field** captured with each recorded
  note, ideally required before recording starts.
- **Per-doctor choices:** keep the audio backup or delete it after
  transcription; record now or upload a recording later.

### 9. CPD log
Fields worth having:
- AHPRA registration number
- specialty
- CPD program
- triennium start date (DD/MM/YYYY)
- triennium end date, calculated as start + 3 years

Log activities, reflective notes and hours, then export a yearly record. Linking
to an accredited CPD home needs accreditation, a separate and slower track.

### 10. Government certificates
LushNote already fills official hospital forms (AWH FAW0004). The same engine
could fill forms hospital doctors complete after injuries and admissions:
- state workers' compensation and transport accident certificates of capacity
- Centrelink medical certificates
- anaphylaxis and asthma action plans

The prompt pre-fills the form from the consult; the doctor checks and signs.

### 11. Shared templates
Personal, shared and favourite templates, with the author shown. Editing and
deleting stay with the author.

### 12. Problem list that carries forward
A patient's active problems, carried into each new note and updated by it.

### 13. Ask questions of a patient's documents
Upload a specialist report or discharge summary, then ask specific questions or
get a summary. This overlaps with idea 6 and Build from history.

### 14. Languages
The consultation is held in another language and the note comes out in English.
Relevant in regional Australia. Test transcription quality before promising it.

## Parked

- **Billing-code tools** (Medicare item suggestions, item checkers, patient
  enrolment for continuity of care). These are for GPs and private specialists.
  A wrong suggestion exposes the doctor to an audit, and connecting to Medicare
  needs Services Australia registration and conformance testing. Un-park if
  LushNote targets general practice.
- **AI clinical advice** (guidelines, research, differentials). It must cite
  real sources and never invent them. High risk; revisit carefully.
- **Patient pre-visit questionnaires.** These fit booked clinics, not wards.
- **Practice-system integrations** (sending notes into allied health and private
  practice systems by API key). These need encrypted server-side key storage,
  patient matching and a Privacy update. Un-park if private practices ask.
- **Invoicing, payments and scheduling.** These are practice management, not
  documentation. A different product.
- **Freemium pricing** ("scribing free, pay for premium actions"). Scribing
  costs LushNote roughly 1 to 2 US cents a consult on the current providers, so
  a generous free tier is affordable; it is a pricing decision, not a technical
  one.

## Useful patterns, not features
- **Setup wizards:** numbered steps, a progress bar and a time estimate, with
  a "where to find this" trail and a picture for each external ID.
- **Announcement banner:** for price or Terms changes. The Terms change still
  needs telling users about.
- **Dismissible upsell cards** placed where the feature would help, not in pop-ups.
