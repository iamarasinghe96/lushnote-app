# LushNote roadmap backlog

The master list of every improvement under consideration for LushNote.

**Where it came from:** a review, finished on 14 October 2026, of other clinical scribe and practice tools, their public policies, and LushNote's own code and legal pages. Every distinct capability found is listed here once, written in LushNote's terms, without naming the products it came from. The owner keeps the evidence (screens, exports, policy texts) privately; ask the owner when an item needs it.

**Nothing here is approved to build.** The owner picks items, one at a time, over the coming years.

## How every item is built
1. **Fit, don't replace.** Each item is adapted to how LushNote already works and makes an existing feature better. It must not change or break behaviour doctors already rely on. If an item would change existing behaviour, raise that with the owner first.
2. **Everything is verified locally before it goes live:**
   - `npm run typecheck`
   - `npm run test:unit`
   - `npm run test:rules` (if rules or data access change)
   - the browser suite where a pathway is affected
   - then the preview deployment
   - then the owner promotes it from the admin Releases page
3. **Add the `WORKFLOWS.md` row first** for any new user-facing pathway (see AGENTS.md).
4. **Update this file** when an item ships or is dropped: set its status, never delete the row.

## Keys
- **Now:** **M** = missing in LushNote. **P** = partly there. **✓** = present (listed only where it helps).
- **Fit:**
  - **Core** = improves the scribe and documents doctors use today.
  - **Adj** = adjacent; needs a new concept such as teams or appointments.
  - **Area** = a whole new product area (practice management, billing, Medicare tools).
- **Status** (filled in as work happens): blank = not started, **picked**, **built**, **live**, **dropped**.

---

## SEC: Sign-in and account security
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| SEC-01 | Two-factor authentication for an account | M | Core | Google sign-in only today; the Google account's own MFA isn't enforced or visible to LushNote. | |
| SEC-02 | Organisation setting to require 2FA for every user | M | Adj | Admin must enable their own 2FA first. | |
| SEC-03 | Show each user's 2FA status to an admin | M | Adj | | |
| SEC-04 | Single sign-on with a hospital or practice identity provider (SAML) | M | Core | A likely hospital procurement requirement. | |
| SEC-05 | Email sign-in (one-time code or link) alongside Google | M | Core | Owner has asked about OTP; email code via the existing email sender is the preferred option. | |
| SEC-06 | Email-and-password sign-in, with change password | M | Core | Only if wanted in addition to SEC-05. | |
| SEC-07 | Configurable session length | M | Core | | |
| SEC-08 | Idle timeout / lock on shared computers | M | Core | Wards use shared machines. | |
| SEC-09 | Login history (IP, OS, browser, device, time) | M | Core | | |
| SEC-10 | See and sign out other devices and sessions | M | Core | | |
| SEC-11 | Re-authentication before sensitive actions (export all, security changes) | P | Core | Today only for account deletion. | |
| SEC-12 | Team / organisation accounts with an account owner | M | Adj | Foundation for SEC-13 to SEC-18. | |
| SEC-13 | Invite users into an organisation | M | Adj | | |
| SEC-14 | Roles: admin, clinician, reception, accountant, practice manager, plus custom roles | M | Adj | Non-clinical roles could be free seats (see ONB-14). | |
| SEC-15 | Per-role permission editor | M | Adj | | |
| SEC-16 | User groups | M | Adj | | |
| SEC-17 | Deactivate users; active/inactive filter; bulk select | M | Adj | | |
| SEC-18 | Per-patient list of practitioners with access | M | Adj | | |
| SEC-19 | Change log on each user's profile | M | Core | | |
| SEC-20 | Change log for organisation/account settings | M | Core | | |
| SEC-21 | Lock dates: stop edits to records on or before a date | M | Core | Pairs with final notes (GEN-04). | |
| SEC-22 | Security certification path (SMB1001, ISO 27001, SOC 2) and saying so publicly | M | Core | Business task more than code. | |
| SEC-23 | Clinician profile photo | M | Core | Minor. | |

## PRV: Data protection, residency and retention
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| PRV-01 | State the encryption standards explicitly (AES-256 at rest, TLS 1.2+ in transit) | P | Core | True through Google Cloud; not stated anywhere. | |
| PRV-02 | App-level or end-to-end encryption of clinical fields | M | Core | Large; affects search and AI. | |
| PRV-03 | Confirm, document and if needed move the Firebase region and backups to Australia | ? | Core | Region is not stated anywhere today. | |
| PRV-04 | Option for Australian-region AI processing (notes and transcription) | M | Core | One provider is US-based today. | |
| PRV-05 | Region-specific processing for other countries | M | Adj | | |
| PRV-06 | Doctor's choice: keep the audio backup, or delete it after transcription | M | Core | | |
| PRV-07 | Automatic audio expiry after a set period | M | Core | `storage.rules` mentions a lifecycle rule that doesn't exist (see FIX-04). | |
| PRV-08 | Delete an individual recording | M | Core | | |
| PRV-09 | "Keep nothing" mode: transcripts and notes deleted after a chosen time (immediately, 24 hours, 7 days) | M | Core | Opposite of today's keep-until-deleted design; would be opt-in. | |
| PRV-10 | Save a recording into the patient's file, playable by the doctor | M | Core | | |
| PRV-11 | Wider redaction: untitled names, and audio | P | Core | Today: titled names, DOB, phone, email, address, plus an AI instruction. | |
| PRV-12 | De-identify a patient's name everywhere on permanent delete | M | Core | | |
| PRV-13 | Mask patient names in the browser tab (initials or none) | M | Core | Shared computers. | |
| PRV-14 | Organisation setting to restrict emailing or sharing documents | M | Adj | | |
| PRV-15 | Password-protected PDFs (e.g. opened with the patient's DOB) | M | Core | | |
| PRV-16 | Guidance and checks against putting document links in emails | M | Core | | |
| PRV-17 | Whole-account export: choose dataset and date range, include archived, with a job history | P | Core | Per-note PDF/Word today. | |
| PRV-18 | Import from other systems: CSV, one-click imports, assisted import, job history | M | Adj | | |
| PRV-19 | Post-cancellation lifecycle: export window, then deletion or anonymisation after a set number of days | P | Core | Today: kept until the doctor deletes the account. | |
| PRV-20 | Doctor-visible audit log: access, export, share, delete events | M | Core | | |
| PRV-21 | Change log on every patient record and note | P | Core | Patient field history exists (200 entries). | |
| PRV-22 | Opt-in anonymised evaluation of AI quality | M | Core | Must be disclosed (LEG-15). | |
| PRV-23 | Keep each AI provider's no-training / zero-retention terms on file and review yearly | P | Core | | |
| PRV-24 | Written internal breach-response procedure | P | Core | NDB commitment is stated publicly. | |
| PRV-25 | Patient-facing privacy notice, separate from the practitioner one | M | Core | | |
| PRV-26 | Privacy-consent status per patient (accepted / no response / declined) | M | Core | | |
| PRV-27 | Staging and the browser suite run on their own Firebase project, never on live records | M | Core | Setup in `STAGING_DATABASE_SETUP.md`. The Releases panel says which database staging is on. | built |
| PRV-28 | Scheduled backups of the live database | ? | Core | Firestore scheduled backups (console only, no code). A staging database is not a backup. See `STAGING_DATABASE_SETUP.md`, last section. | |

## LEG: Privacy policy and Terms
Clauses missing or inconsistent in LushNote's `/privacy` and `/terms` (Terms of Service and Privacy Policy).

| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| LEG-01 | Named privacy officer and postal address | M | Core | APP 1. | |
| LEG-02 | Separate practitioner and patient privacy notices | M | Core | See PRV-25. | |
| LEG-03 | Cookies and browser storage (session storage of keys, local storage of recents) | M | Core | | |
| LEG-04 | Fix "photos not collected": ward-note photos are sent to the AI (read, not stored) | M | Core | | |
| LEG-05 | Disclose the IP address, timestamp and Terms version recorded at billing consent, and the billing country kept; fix "no billing details collected" | M | Core | `lib/billing.ts` recordConsent. | |
| LEG-06 | Fix the redaction wording: titled names only; other names are handled by an AI instruction; audio isn't redacted | M | Core | | |
| LEG-07 | Redaction called "optional" in the Terms vs "on by default" on the Security page | M | Core | | |
| LEG-08 | Same services list in the Terms and /privacy (add Stripe, Zoho, Slack, Geoapify to the Terms) | M | Core | | |
| LEG-09 | Name the country for each provider | M | Core | APP 1.4(f)-(g), APP 8. | |
| LEG-10 | Government identifiers statement | M | Core | APP 9. | |
| LEG-11 | Unsolicited information | M | Core | APP 4. | |
| LEG-12 | Anonymity and pseudonymity | M | Core | APP 2. | |
| LEG-13 | Who holds the legal medical record, and doctors' retention duties (7+ years; longer for children) | M | Core | | |
| LEG-14 | Complete retention list (drafts 7 days, logs 90 days, support chats and tickets, deletion feedback, billing 5 years) | P | Core | | |
| LEG-15 | Whether any data is used to improve the service (none, or opt-in) | M | Core | | |
| LEG-16 | Children's data and guardians | M | Core | | |
| LEG-17 | Third-party links | M | Core | | |
| LEG-18 | Eligibility: AHPRA-registered practitioners (and students under supervision) | M | Core | | |
| LEG-19 | "Not a TGA-regulated medical device" statement, if accurate | M | Core | | |
| LEG-20 | State surveillance / listening-device laws in the recording-consent duty | P | Core | | |
| LEG-21 | Suggested patient consent wording | M | Core | Pairs with CAP-09. | |
| LEG-22 | Availability, maintenance, support hours and levels; status page | M | Core | Today: a 5-business-day email reply only. | |
| LEG-23 | Intellectual property: the doctor owns notes and custom templates; feedback licence | M | Core | | |
| LEG-24 | Indemnity | M | Core | | |
| LEG-25 | Suspension, rate limits, termination for breach with a cure period | M | Core | Suspension and rate limits exist in the product. | |
| LEG-26 | Data on termination and the export window | M | Core | | |
| LEG-27 | Name the governing state | M | Core | | |
| LEG-28 | Price-change notice period (e.g. 30 days) and how notice is given | M | Core | | |
| LEG-29 | Auto-renewal statement | P | Core | | |
| LEG-30 | Assignment, severability, entire agreement | M | Core | | |
| LEG-31 | No credential sharing; authority to accept for an organisation | P | Core | | |
| LEG-32 | Acceptable use, including AI acceptable use | M | Core | | |
| LEG-33 | AI section: provider dependency, accuracy limits, risk disclaimer | P | Core | | |
| LEG-34 | Licence and moderation terms for shared templates (if TPL-22 is built) | M | Adj | | |
| LEG-35 | Express consent wording for information sent to AI | M | Core | | |
| LEG-36 | Dispute-resolution procedure | M | Core | | |
| LEG-37 | Confidentiality clause | P | Core | | |
| LEG-38 | Response time for privacy complaints (e.g. 30 days) | M | Core | | |
| LEG-39 | Alignment notes for state health records laws (NSW HPPs including HPP 14 and 15; Victorian HPPs) | M | Core | | |
| LEG-40 | Breach-cooperation obligations | M | Core | | |
| LEG-41 | Billing-code (MBS) disclaimer (if MED items are built) | M | Area | | |
| LEG-42 | CPD policy set (if MED-10 is built): governance, eligibility and exemptions, data, audit, appeals, cultural safety, practitioner support | M | Area | | |
| LEG-43 | "Not legal advice" disclaimer for agreement templates (if DOC-21 is built) | M | Adj | | |
| LEG-44 | Footer year (© 2025) vs effective date 2026 | M | Core | Minor. | |

## CAP: Capture and transcription
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| CAP-01 | Live transcript visible while recording | P | Core | Today: 4-minute segments. | |
| CAP-02 | Speaker labelling (doctor / patient / others) | M | Core | | |
| CAP-03 | Language selector; consults in other languages, notes in English | M | Core | Test quality first. | |
| CAP-04 | Custom vocabulary (drug names, local terms) | M | Core | | |
| CAP-05 | Upload a recording to transcribe later | P | Core | Built but hidden ("coming soon"). | |
| CAP-06 | Mic check with level meter before starting | P | Core | A live wave shows only while recording. | |
| CAP-07 | Telehealth: mix the doctor's mic with the shared tab's audio | P | Core | Tab audio only today. | |
| CAP-08 | Consent recorded on each recorded note (yes / verbal / declined) | M | Core | | |
| CAP-09 | Configurable consent script shown before recording | M | Core | | |
| CAP-10 | AI-use consent line inserted into the note | M | Core | | |
| CAP-11 | Patient informed about AI use before the visit | M | Adj | | |
| CAP-12 | Pre-visit patient questionnaire by link or QR, feeding the consult | M | Adj | | |
| CAP-13 | Scribe toggles: bullet points, include patient quotes, abbreviations | P | Core | Possible today only through free-text Document style. | |
| CAP-14 | Model choice or processing tier | M | Core | | |
| CAP-15 | Upload documents (PDF and others) with text extraction | P | Core | Photo OCR only today. | |
| CAP-16 | Real-time draft note during the consult | M | Core | | |
| CAP-17 | Start button with a mode dropdown | P | Core | Separate mode cards today. | |

## GEN: Note generation, editing and the assistant
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| GEN-01 | Background box for outside documents (referrals, ED notes, discharge summaries; large limit) used as context, never copied wholesale | M | Core | | |
| GEN-02 | Ask questions of uploaded documents | M | Core | | |
| GEN-03 | "Summarise the last N months" for a patient in one request | P | Core | Build from history needs 2+ documents selected. | |
| GEN-04 | Draft vs Final status; "Save as final" with further save options | M | Core | | |
| GEN-05 | "Last edited by … at …" | M | Core | | |
| GEN-06 | Previous notes beside the editor, filterable; split-view toggle | M | Core | | |
| GEN-07 | Version history of a note | M | Core | | |
| GEN-08 | Rich text in notes: strikethrough, colour, highlight, tables, images, links, fonts and sizes, list styles, alignment, line height, indent, sub/superscript, clear formatting, undo/redo | M | Core | Today: plain text with bold/italic shortcuts. | |
| GEN-09 | Notes laid out as tables (header table, section rows) | M | Core | | |
| GEN-10 | Bold and underline missing information instead of omitting it | M | Core | | |
| GEN-11 | Per-document choice: omit missing sections or highlight them | P | Core | Empty sections always collapse today. | |
| GEN-12 | One-line consult-summary headline at the top of a note | P | Core | | |
| GEN-13 | Problem list output that carries forward between visits | M | Core | | |
| GEN-14 | Style presets: concise shorthand, prose, SOAP, problem-oriented, allied-health shorthand | P | Core | Document style is free text today. | |
| GEN-15 | Default note rules: never fabricate, omit empty headings, en-AU, lay-to-medical terms, time shorthand (1/7, 2/52), urgent problems first, findings under each problem, correct Australian drug names, consolidate related issues | P | Core | | |
| GEN-16 | Saved prompts library for the assistant | M | Core | | |
| GEN-17 | Attach files to the assistant | M | Core | | |
| GEN-18 | Voice input to the assistant | M | Core | | |
| GEN-19 | Regenerate an assistant answer | P | Core | | |
| GEN-20 | Email drafting help: drafts, tone, grammar | M | Core | | |
| GEN-21 | Differential generator: ranked by likelihood, plus "what not to miss" | M | Core | Clinical-advice risk; needs careful wording. | |
| GEN-22 | Clinical guidance and research with cited sources | M | Core | High risk; never invent sources. | |
| GEN-23 | Extract medical issues for a care plan | M | Core | | |
| GEN-24 | Multi-model routing | P | Core | Gemini with a fallback today. | |
| GEN-25 | Priority processing tier | M | Core | | |
| GEN-26 | Rate a generated note; feedback loop | M | Core | | |
| GEN-27 | Organisation setting: who may create prompts | M | Adj | | |

## TPL: Templates, macros and the library
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| TPL-01 | Core hospital-doctor templates: admission, ward round, ED assessment, consult/liaison, procedure, handover (ISBAR), full discharge summary, transfer, family meeting, goals of care, death certification | M | Core | The 117 built-ins are mostly psychology and allied health. | |
| TPL-02 | General medical note set: concise note, history and physical (concise, standard with optional sections, very detailed), problem list, SOAP, SOAP with action plan first | M | Core | | |
| TPL-03 | Optional sections in templates (left out if not mentioned) | M | Core | | |
| TPL-04 | Macros: insertable text blocks with fill-in blanks | M | Core | | |
| TPL-05 | Macro library by topic: paediatrics (baby checks by age, immunisation, febrile child, limping child, jaundice), women's health and obstetrics, sexual health, men's health, mental health, chronic disease, medication counselling by drug class, musculoskeletal exams, acute infections, dermatology and procedures, travel, admin | M | Core | | |
| TPL-06 | Shared-decision-making blocks: what it is, when it's done, what it detects, accuracy, effectiveness, pros, cons, with quantified risk | M | Core | | |
| TPL-07 | Examination templates with named special tests (Ottawa, drawer, McMurray, Hawkins, empty can, SLR, Romberg, Dix-Hallpike, Rinne/Weber, Ortolani/Barlow, cranial nerves) | M | Core | | |
| TPL-08 | Developmental milestone checklists by age | M | Core | | |
| TPL-09 | Telephone/telehealth consult checklist (ID check, privacy, limitations) | M | Core | | |
| TPL-10 | Talk-track prompts: what to say aloud so the scribe captures it | M | Core | | |
| TPL-11 | Patient handouts with trusted links | M | Core | | |
| TPL-12 | Exam-preparation structures for trainees | M | Core | | |
| TPL-13 | Screening tools with scoring (K10, DASS-21, EPDS, SCOFF, HEADSS, IPSS, PHQ-9, GAD-7, AUDIT, CVD risk) | P | Core | A free-text scales section exists today. | |
| TPL-14 | Personal / Shared / Favourite tabs, author shown, "set as default" | P | Core | Favourites and My Templates exist. | |
| TPL-15 | Template preview with sample output | M | Core | | |
| TPL-16 | Template library button inside the picker | P | Core | | |
| TPL-17 | AI blocks inside templates; tags for AI blocks; icon marking AI templates | M | Core | | |
| TPL-18 | Placeholders and variables ({today}, {clinician}, {patient first name}, date arithmetic such as review date in 3 months) | M | Core | | |
| TPL-19 | Interactive fields (tick boxes, dropdowns) and tables in templates | M | Core | | |
| TPL-20 | Archive and duplicate templates | M | Core | | |
| TPL-21 | Library curation: draft/test/incomplete states, approval workflow, contributor credit | M | Core | | |
| TPL-22 | Community or shared template library between colleagues | M | Adj | See LEG-34. | |
| TPL-23 | Specialty tags across the library | P | Core | | |
| TPL-24 | Body charts (full body views, hands, feet) with annotation; workspace and personal | M | Core | | |
| TPL-25 | Templates linked to appointment types | M | Adj | Needs OPS. | |
| TPL-26 | "Show in menu" visibility for macros and documents | M | Core | | |

## DOC: Documents and forms
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| DOC-01 | Plain-language patient summary: each diagnosis in lay terms; each medicine with purpose, side effects and how to take it; tests and appointments to come | M | Core | | |
| DOC-02 | Medication tapering plans (e.g. by duration of steroid use; opioid by morphine-equivalent dose) | M | Core | | |
| DOC-03 | Personalised preventive-health guide (leaves out irrelevant advice; screening intervals; vaccines) | M | Core | | |
| DOC-04 | Pharmacy medication-review referral | M | Core | | |
| DOC-05 | Brief and in-depth versions of the same letter | P | Core | | |
| DOC-06 | Centrelink forms: medical certificate, verification of medical conditions, carer payment medical report; DSP letter | P | Core | DSP letter exists. | |
| DOC-07 | Certificates of capacity for all state schemes (NSW, Vic workers and transport, Qld, SA, WA progress) | M | Core | Psychologist injury reports exist; certificates don't. | |
| DOC-08 | NDIS access request and supporting-evidence forms | P | Core | NDIS reports exist. | |
| DOC-09 | Anaphylaxis and asthma action plans | M | Core | | |
| DOC-10 | Driver licence medical certificate | M | Core | | |
| DOC-11 | GP mental health treatment plan; care plan and review | M | Core | | |
| DOC-12 | Chronic condition management plan and review: goal tracking (achieved / partial / pending), team feedback, patient agreement, automatic review date | M | Core | | |
| DOC-13 | Health assessments (75+, heart, menopause, Aboriginal and Torres Strait Islander by age band, intellectual disability), with nurse and doctor parts | M | Core | | |
| DOC-14 | Form guardrails: never create signatures, consent or dates; respect who owns each section; keep printed emergency wording; age branching; certificate-period rules; claim type; max conditions; mandatory review flags | P | Core | Ward-note OCR has a fidelity contract today. | |
| DOC-15 | Structured input checklist before generating a plan | M | Core | | |
| DOC-16 | Plain-text output for official records and health-record upload | M | Core | | |
| DOC-17 | Word export for letters | M | Core | Notes already export to Word. | |
| DOC-18 | Drawn signature | P | Core | The pad component exists but is unused. | |
| DOC-19 | Patient signature on forms | M | Adj | | |
| DOC-20 | Forms sent to patients to complete (standard and embeddable), with completion status, linked to a visit | M | Adj | | |
| DOC-21 | Service agreement with a fees schedule and signatures | M | Adj | | |
| DOC-22 | Letters list per patient (author, location), with bulk download and bulk send | P | Core | | |
| DOC-23 | Email templates by document type (note, letter, form, general) | P | Core | One email opening line today. | |
| DOC-24 | Email signature at business and user level, with merge fields | M | Core | | |
| DOC-25 | Several provider numbers, one per location, on letters | P | Core | One provider number today. | |
| DOC-26 | Business logo and branding on documents | P | Core | Admin-set letterheads per workplace. | |
| DOC-27 | Sort and classify incoming clinical documents | M | Core | | |
| DOC-28 | Keep government forms current (versioned each year) | M | Core | Ongoing work. | |

## PAT: Patient record
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| PAT-01 | Title, first, middle, last and preferred names | P | Core | Single display name today. | |
| PAT-02 | Sex, gender identity and pronouns as separate fields, with help tooltips | P | Core | Gender only. | |
| PAT-03 | Occupation | M | Core | | |
| PAT-04 | Free-text alerts (up to 1,000 characters) shown wherever the patient appears | P | Core | Priority flags today. | |
| PAT-05 | Structured medications, allergies and intolerances | P | Core | Medications as tracked text only. | |
| PAT-06 | Identifiers: Medicare (number, reference, expiry, claimant), DVA file number, private health fund, NDIS (number, plan dates, diagnosis, fund management, nominee) | M | Core | Privacy decision needed: LushNote deliberately stores no Medicare numbers today. | |
| PAT-07 | Contact details: phones by type, email, address search, timezone, communication preference | M | Core | Privacy decision needed. | |
| PAT-08 | Emergency contact (name, relationship, phone) | M | Core | | |
| PAT-09 | Related patients and associated contacts (GP, specialist) | M | Core | | |
| PAT-10 | Referral source and type | M | Core | | |
| PAT-11 | Patient photo | M | Core | | |
| PAT-12 | Colour-coded tags | P | Core | Flags only. | |
| PAT-13 | Custom fields (type, visible, required, order) | M | Core | | |
| PAT-14 | Files and folders per patient, with a recycle bin | M | Core | | |
| PAT-15 | Communications log (date, subject, type, direction, links) | M | Adj | | |
| PAT-16 | Count badges on record sections | M | Core | | |
| PAT-17 | Read-only view with an Edit button | P | Core | | |
| PAT-18 | Full-text search inside note content; filter by author | P | Core | Patient search today. | |
| PAT-19 | Bulk select notes to download or send | P | Core | | |
| PAT-20 | Scroll view of all a patient's notes | P | Core | | |
| PAT-21 | Contacts directory reusable as letter recipients | M | Core | Recipient addresses are re-entered per letter today. | |
| PAT-22 | "Patient" or "client" wording setting | M | Core | | |
| PAT-23 | Cases and funding budgets (allocated vs invoiced, expiry) | M | Area | | |
| PAT-24 | Account balance, statements and payments per patient | M | Area | | |
| PAT-25 | Lift the 200-note list limit with a lightweight notes index | M | Core | The admin Overview warns at 150 notes. | |
| PAT-26 | Archive instead of delete | M | Core | | |

## OPS: Practice operations (new product area)
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| OPS-01 | Calendar: day/week/month, locations, practitioners, colour by service, status icons, travel buffers, "now" line, filters, view settings | M | Area | | |
| OPS-02 | Appointment types and statuses; no-show reason codes; cancellation notice time | M | Area | | |
| OPS-03 | Availability per practitioner per location | M | Area | | |
| OPS-04 | Busy-time types (leave, CPD, admin, lunch, meeting, travel) with utilisation settings | M | Area | | |
| OPS-05 | Rooms and resources with capacity | M | Area | | |
| OPS-06 | Service catalogue (item code, duration, price, delivery mode) | M | Area | | |
| OPS-07 | Cancel and reschedule policies | M | Area | | |
| OPS-08 | Online bookings with practitioner profile statements | M | Area | | |
| OPS-09 | Waitlist: screener, triage, rejected; embeddable intake form; accept/reject emails; priority tags | M | Area | | |
| OPS-10 | Appointment messages: confirmation, reschedule, cancellation, reminders (2 days, 1 hour) by SMS and email | M | Area | | |
| OPS-11 | SMS sending with prepaid credits, low-balance warning, top-up packs, per-segment pricing | M | Area | | |
| OPS-12 | Send upcoming appointments to a patient | M | Area | | |
| OPS-13 | External calendar sync and feeds; telehealth meeting links | M | Area | | |
| OPS-14 | Block bookings outside funding periods | M | Area | | |
| OPS-15 | Team message board | M | Adj | | |
| OPS-16 | Conversational booking assistant with voice | M | Area | | |
| OPS-17 | Multi-site locations management | P | Core | Workplaces exist. | |

## FIN: Practice billing and claiming (new product area)
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| FIN-01 | Patient invoices and batch invoicing; line items for travel time, kilometres, transport, cancellation fees; discounts; GST | M | Area | LushNote bills only its own subscription. | |
| FIN-02 | Payments and receipts; partial payments; card on file; pay links | M | Area | | |
| FIN-03 | Statements, account balances and credits | M | Area | | |
| FIN-04 | Products and stock | M | Area | | |
| FIN-05 | Tax rates, currency, tax label | M | Area | | |
| FIN-06 | Claiming: Medicare bulk bill and patient claims, DVA, health funds, NDIS bulk upload, injury schemes | M | Area | | |
| FIN-07 | Accounting software sync | M | Area | | |
| FIN-08 | Automated payment reconciliation | M | Area | | |
| FIN-09 | Invoice change log, sent status, reminders | M | Area | | |

## MED: Medicare, PBS, MyMedicare and CPD
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| MED-01 | MBS item suggestions from the consult, with restrictions and combinations | M | Area | Audit risk; needs current item data. | |
| MED-02 | MBS planner | M | Area | | |
| MED-03 | PRODA-based item checker | M | Area | | |
| MED-04 | MyMedicare: guided setup (organisation IDs, PRODA, B2B device, registration, bulk-billing agreement) and patient registration | M | Area | | |
| MED-05 | MBS education, example care plans, an MBS question assistant, links to official item descriptors | M | Area | | |
| MED-06 | Billing and preventive-care opportunities flagged before the visit | M | Area | | |
| MED-07 | Billing revenue calculator on the website | M | Area | Marketing. | |
| MED-08 | PBS lookups and authority help | M | Area | | |
| MED-09 | Prior billing history from GP clinical software | M | Area | | |
| MED-10 | CPD log: profile (AHPRA number, specialty, program, triennium start, end = start + 3 years); development plan; activities in three categories (educational, reviewing performance, measuring outcomes); upload certificates, reflections and audits; hours progress; tags (cultural safety, health equity, professionalism, ethical practice); export summary and evidence; college requirements by specialty | M | Core | Relevant to hospital doctors now. | |
| MED-11 | Link to an accredited CPD home | M | Area | Needs accreditation. | |
| MED-12 | Item and time evidence lines in notes | M | Area | | |

## RPT: Reporting
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| RPT-01 | Doctor's home dashboard: unfinished notes, recent forms, notes this week | M | Core | | |
| RPT-02 | Practice reports: utilisation, revenue, billed hours, cancellations and did-not-arrive, appointments, cases, progress-note compliance, forms, uninvoiced, payments, aged debtors, bulk claims, practitioner performance | M | Area | | |
| RPT-03 | Report tools: date range, granularity, compare periods, add/remove/save/load filters, run, export, help, widget menus, customisable dashboard | M | Area | | |
| RPT-04 | Doctor usage stats (consults per day, transcription minutes) | P | Core | The fair-use card shows AI spend. | |
| RPT-05 | Organisation admin dashboards | M | Adj | | |

## INT: Integrations
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| INT-01 | Send notes to practice-management systems (choose business, location and provider; region detection; switch between connected systems) | M | Adj | | |
| INT-02 | GP clinical software connection | M | Adj | | |
| INT-03 | Hospital EMR connection | M | Core | Today: paste-only support for one hospital system's text. | |
| INT-04 | Accounting software | M | Area | | |
| INT-05 | Claiming and payment terminals | M | Area | | |
| INT-06 | Video telehealth platforms | M | Adj | | |
| INT-07 | External calendars | M | Adj | | |
| INT-08 | Exercise-prescription platforms | M | Adj | | |
| INT-09 | Mailing-list tools | M | Adj | | |
| INT-10 | Public API (start as beta, by request) and webhooks | M | Adj | | |
| INT-11 | Integration setup wizards (key, then options) with dependency messages | M | Adj | | |
| INT-12 | Personal vs organisation integrations | M | Adj | | |
| INT-13 | Tag manager for a practice's own analytics | M | Area | Conflicts with LushNote's rule of no tracking under /app; likely drop. | |

## ONB: Signup, trial, pricing and onboarding
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| ONB-01 | Signup steps with progress; country; practice-size bands (1–4, 5–14, 15–49, 50–99, 100+); business name | P | Core | 6-step onboarding today. | |
| ONB-02 | Trial card at signup: exact dates, first charge date and amount, reminder promise | P | Core | Emails go 7 days before and on the day. | |
| ONB-03 | Organisation subdomain | M | Adj | | |
| ONB-04 | Social proof on signup (ratings, user counts, awards) | M | Core | | |
| ONB-05 | Setup checklist ("1 of N") with show-me-how tours | M | Core | | |
| ONB-06 | Demo data labelled "Demo", with start-with-examples popovers | M | Core | | |
| ONB-07 | Friendly empty states with one clear action | P | Core | | |
| ONB-08 | Done screen with a next step | P | Core | | |
| ONB-09 | Permanent free tier with a daily allowance of premium actions | M | Core | Pricing decision. | |
| ONB-10 | Free unlimited scribing | M | Core | Pricing decision. | |
| ONB-11 | Show remaining quota | P | Core | | |
| ONB-12 | Coupons and promotional prices for a set period | M | Core | | |
| ONB-13 | Clinic plan: custom pricing, volume discounts, admin controls, onboarding, priority support | M | Adj | | |
| ONB-14 | Per-seat pricing with free non-clinical seats | M | Adj | | |
| ONB-15 | Change billing cycle (monthly / annual) | P | Core | | |
| ONB-16 | Billing history in the app | P | Core | Stripe portal today. | |
| ONB-17 | Price-change banner and notice | M | Core | | |
| ONB-18 | Reasons and help before cancelling | P | Core | Pause exists. | |
| ONB-19 | Add-ons sold separately (e.g. CPD only) | M | Adj | | |
| ONB-20 | Rural and complimentary access as a defined programme | P | Core | Manual exemption today. | |
| ONB-21 | Proration and credits | ? | Core | Check Stripe settings. | |

## SUP: Support and communication
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| SUP-01 | Public help centre with collections and videos | M | Core | | |
| SUP-02 | "Learn more" links on every feature and report | M | Core | | |
| SUP-03 | Sales and support chat on the website with quick replies | P | Core | Live Support inside the app only. | |
| SUP-04 | In-app surveys | M | Core | | |
| SUP-05 | Notifications bell | M | Core | | |
| SUP-06 | In-app "AI and your data" FAQ (what it does, security, where processed, retention and training, accuracy) | M | Core | Answers must match the code. | |
| SUP-07 | Public status page | M | Core | | |
| SUP-08 | Stated support hours | M | Core | | |
| SUP-09 | Contact form with role, practice and practice size | P | Core | Email only today. | |
| SUP-10 | Product-update emails | P | Core | What's New exists in the app. | |
| SUP-11 | Contextual upsell cards where a feature would help | M | Core | | |
| SUP-12 | Announcement and price banners | ✓ | Core | Campaign banner and What's New exist. | |

## UX: Interface patterns
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| UX-01 | Sortable and filterable tables; page-size selector | P | Core | | |
| UX-02 | Bulk-select actions | M | Core | | |
| UX-03 | "Show archived" and "show deleted" toggles | M | Core | | |
| UX-04 | Change log link on records | M | Core | | |
| UX-05 | Coach marks, dependency messages, irreversible-action warnings | P | Core | | |
| UX-06 | Status badges in the settings menu (e.g. "New", "Low") | M | Core | | |
| UX-07 | Collapsible side navigation on desktop | M | Core | | |
| UX-08 | Dark mode | M | Core | | |
| UX-09 | Offline mode | M | Core | | |
| UX-10 | Native mobile apps | M | Adj | | |

## FIX: Problems found in LushNote itself
| ID | Item | Now | Fit | Notes | Status |
|---|---|---|---|---|---|
| FIX-01 | Public pages say 116 templates; there are 117 | M | Core | | |
| FIX-02 | Redaction "optional" vs "on by default" | M | Core | Same as LEG-07. | |
| FIX-03 | "Photos not collected" claim | M | Core | Same as LEG-04. | |
| FIX-04 | `storage.rules` mentions an audio lifecycle rule that doesn't exist | M | Core | See PRV-07. | |
| FIX-05 | ARCHITECTURE.md says auto-stop 60 minutes; the code default is 55 | M | Core | | |
| FIX-06 | Positioning: "for psychiatrists" in the manifest and AGENTS.md vs "for doctors" on the site; built-ins mostly psychology | M | Core | See TPL-01. | |
| FIX-07 | Services list differs between the Terms and /privacy | M | Core | Same as LEG-08. | |
| FIX-08 | Drawn signature pad exists but is unused | M | Core | See DOC-18. | |
| FIX-09 | Letters can't export to Word | M | Core | Same as DOC-17. | |
| FIX-10 | Upload Recording is built but hidden | M | Core | Same as CAP-05. | |
| FIX-11 | Telehealth records tab audio only | M | Core | Same as CAP-07. | |
| FIX-12 | "Complimentary for rural hospitals" is a manual exemption, not a product rule | M | Core | Same as ONB-20. | |
| FIX-13 | Undisclosed IP address and billing country at billing consent | M | Core | Same as LEG-05. | |
| FIX-14 | Redaction overclaim in the Terms ("patient names") | M | Core | Same as LEG-06. | |

## Open evidence (ask the owner)
These still need evidence the owner holds or can capture:
- one more competitor not yet reviewed
- screens behind buttons in the reviewed products (booking settings, permission editor, custom-field editor, template and form editors, report results, AI-block editor)
- full texts of some policy documents
- the second page of appointment message templates

Add new items here as numbered rows in the right section once there is evidence.
