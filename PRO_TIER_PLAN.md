# Pro tier: LushNote's paid AI keys for paying doctors

## Context

Today every doctor brings their own Gemini key and runs on Google's free tier: 20 requests
a day. One long consultation spends ten of those transcribing, so a doctor hits the limit
on their second or third session and falls back to Groq for the rest of the day.

Paying subscribers should stop managing keys altogether. When a subscription is active,
LushNote's own paid keys serve that doctor instead of theirs. Trial users keep their own
keys, which is what makes the upgrade concrete and keeps trial API cost at zero.

The hard part is not the routing. It is that **$30 AUD is a flat rate against a variable
cost**, and nothing in the app currently knows what any doctor costs. So this lands in
three stages, and the meter ships first and alone.

### Why not Groq for everything

Asked and answered against the code, not assumption. Groq is cheaper and stays the
default for the expensive bulk, but it cannot be the only provider:

| Blocker | Evidence |
|---|---|
| OCR has no Groq equivalent | `app/api/ocr/route.ts:124` — "reading handwriting is a vision job, and the Groq fallback models are text-only" |
| Ward-note fidelity | `CLAUDE.md` fidelity contract: `sourceCoverage()` exists because Groq answers drop `#` lines; under `COVERAGE_FLOOR` a Gemini re-run is forced. `preferGemini: true` on ward intake and hospital forms |
| Long transcripts do not fit | `app/api/generate/route.ts:878` — `groqViable = estimatedTokens <= 10000`; past it the route returns 413 with a "long session" message |

**The existing provider ladder is already cost-optimal.** Groq runs first on extraction to
save quota; Gemini leads only where fidelity outranks cost. So Pro is a change of *whose
key pays*, not *which provider runs*. That keeps this plan small and leaves the clinical
behaviour identical.

---

## Stage 1 — The meter (ships alone, no behaviour change)

Nothing here changes what a doctor sees. It answers "what does each doctor cost" so the
Stage 3 ceiling is chosen from data rather than from an estimate.

### What already exists (reuse, do not rebuild)

- `lib/gemini.ts:21-33` — every Gemini entry point already returns
  `usage: { prompt, output, thoughts, total }`, Google's own tokeniser counts.
- `lib/firestore/profiles-admin.ts:18-42` — `updateGeminiUsage(uid, modelKey, usage)`,
  transactional Admin SDK write, already called from all 11 AI call sites.
- `lib/utils.ts:117` — `quotaDate()`, the Pacific-aligned day key.
- `lib/firestore/adminUsers.ts:97` — `redactUser` already passes `geminiUsage` through raw;
  `components/admin/UsersPanel.tsx:123` already renders it.

### New: `lib/aiCost.ts` (pure, no Firestore import)

The only new pure module, and the only thing unit-tested in this stage.

```ts
export interface TokenUsage { prompt: number; output: number; thoughts: number; total: number }

// Micro-USD (1e-6 USD) per million tokens, so arithmetic stays in integers and
// never accumulates float error across thousands of calls.
export const PRICING = { /* per model: inputPerM, outputPerM, audioPerM */ }

export function geminiCostMicros(usage: TokenUsage, modelKey: string): number
export function groqTextCostMicros(totalTokens: number, model: string): number
export function whisperCostMicros(seconds: number): number
export function formatMicros(micros: number): string   // "$0.04" for the admin panel
```

**`PRICING` rates must be confirmed against the live pricing pages at implementation time**
(`ai.google.dev/gemini-api/docs/pricing`, `groq.com/pricing`) — they are not verifiable from
this environment and they change. Put the date checked in a comment above the table. Treat
every figure below as an order of magnitude, not a quote.

`thoughts` tokens are billed and appear in neither `prompt` nor `output`
(`lib/gemini.ts:24-27`) — they must be priced at the output rate or Pro under-reports.

### New: `recordAiSpend` in `lib/firestore/profiles-admin.ts`

Deliberately a **separate** transaction from `updateGeminiUsage` rather than a refactor of
it. Merging them would touch all 11 call sites and is the kind of change a follow-up pass
gets wrong; two fire-and-forget transactions on the same doc is a contention cost Firestore
already retries through.

Writes `users/{uid}.aiCost`, keyed by month so the Stage 3 ceiling is one field read from a
profile the routes have already loaded:

```
aiCost: {
  "2026-09": { micros, calls, gemini, groq, updatedAt },
  ...                       // prune to the most recent 13 keys in the same transaction
}
```

Month key from a new `monthKey(now)` in `lib/utils.ts`, alongside `quotaDate()`.

### Wiring

- Every `updateGeminiUsage(...)` call site gains a sibling `recordAiSpend(...)`, same
  `.catch(() => {})` fire-and-forget discipline. Sites are listed in
  `app/api/{generate,chat,ocr}/route.ts` — 11 in total.
- **Groq text**: `lib/groq.ts:132` already returns `totalTokens`; it reaches the client as
  `groqTokensUsed` but is never persisted. Record it server-side at the same points.
- **Groq audio** is the one genuine gap: `transcribeAudioGroq` returns a bare string, so
  there is no duration to price. Change it to return `{ text, seconds }` by requesting
  `response_format: 'verbose_json'`, which carries `duration`. **Verify that field is
  present before relying on it**; if absent, fall back to the segment length the recorder
  already knows (`hooks/useSegmentedRecorder.ts`) sent as a header. Client-supplied duration
  is acceptable here because Stage 1 gates nothing — but note it in the code, because
  Stage 3 *does* gate on it.
- `app/api/chat/route.ts:430` currently bumps with a literal `0` and loses that call's
  tokens. Fix while here.

### Admin visibility

- Add `aiCost` to the `redactUser` allow-list (`lib/firestore/adminUsers.ts:83-104`),
  following the raw pass-through precedent already set by `geminiUsage:97`.
- `components/admin/UsersPanel.tsx` — render this month's cost next to the existing token
  meter.
- `components/admin/BillingPanel.tsx` — add a "This month's AI cost" card: total, the ten
  most expensive doctors, and cost per doctor against the $30 they pay. The panel already
  fans out actions over `/api/admin/billing`; add one `action: 'aiCost'`.
  Gate with `requireAdmin` and audit with `writeAudit({ action: 'billing.aiCost' })`,
  matching `app/api/admin/billing/route.ts:29-30, 67`.
- **Label it "estimated"** everywhere it appears. It is our arithmetic over token counts,
  not an invoice, and it will not match Google's bill to the cent.

### Tests — `tests/unit/ai-cost.test.ts`

Follows the house style in `tests/unit/` (node environment, no mocks, pure modules only,
frozen `NOW` const, prose comment explaining why the behaviour matters):

- a known usage object prices to a known figure
- `thoughts` tokens are billed, not dropped
- zero usage costs zero; a missing model key does not throw or silently price at zero
- integer micro-USD, no float drift across 10,000 accumulated calls

---

## Stage 2 — Authenticate the AI routes (hard gate before Stage 3)

**None of the four AI routes verify anything today.** `uid` arrives in the JSON body
(`generate:319`, `chat:442`) or a multipart field (`transcribe:27`, `ocr:77`) and is checked
only for length. `requireUser` exists (`lib/adminGuard.ts:37-46`) and is used by
`/api/billing` and `/api/admin/*`, but by none of the AI routes.

Metering a wrong uid is a data-quality problem. **Routing a paid API key on one is an open
door**: the endpoints are public, so anyone who learns a Pro subscriber's uid spends your
Gemini budget. This is the "no exposed keys" requirement, and Stage 3 must not ship without
it.

### Changes

- Each of the four routes: replace the client-supplied uid with
  `const uid = await requireUser(req)` inside the existing `try`, returning
  `unauthorized()` on failure. Keep the body/form uid **only** as a cross-check, and log a
  `warn` when the two disagree — that mismatch is the signal that someone is probing.
- `noteRequest({ uid })` after resolving it, so log lines correlate. `transcribe`, `chat`
  and `ocr` import `noteRequest` but never call it (`lib/requestContext.ts`); fix while here.
- Client: one shared helper — extend `lib/utils.ts` with `aiHeaders()` returning
  `Authorization: Bearer <idToken>` plus the existing `x-groq-key` / `x-gemini-key`.
  Replace the hand-rolled header blocks at all ~15 call sites. `PaymentSetup.tsx` and
  `BillingPanel.tsx` already have a private `authHeaders()` — this is the same idea, hoisted.
- **`components/modals/ScanNoteModal.tsx:96` is the odd one out**: it builds an object
  literal and returns early if there is no Gemini key. It must still send the token.
- `app/api/chat/route.ts` `support-triage` deliberately carries no uid
  (`hooks/useSupportThread.tsx:262`). It should still authenticate — knowing who is asking
  for support is useful — but must not require an entitlement.

### Dead ends to avoid

| Risk | Handling |
|---|---|
| `getIdToken()` throws or returns null | Send the request without the header and let the route 401, rather than throwing in the click handler and leaving a dead button |
| Token expired mid-clinic | `getIdToken()` refreshes automatically; do **not** add retry logic on top |
| E2E fixture account | The suite signs in for real via `/e2e-login`, so it has a token. Verify the mock paths still run — they return before key use, but now sit behind auth |
| A 401 looks like a generation failure | Map 401 on an AI route to a distinct message ("Please sign in again"), not the generic failure copy |

---

## Stage 3 — Pro routing

### Who is Pro

`lib/entitlement.ts` returns eight states. `entitled: true` does **not** mean paying —
`trialing`, `legacy`, `grace` and `exempt` are all entitled without money moving.

```ts
// lib/serverAiKeys.ts
export const PRO_STATES: EntitlementState[] = ['active', 'dunning', 'paused', 'exempt']
```

- `active` — paying.
- `dunning` — `past_due` with a method on file: a card retry or a BECS debit clearing. Cutting
  their Pro API off mid-clearing would punish a doctor whose money is already moving.
- `paused` — collection paused, but a period they already paid for is still running.
- `exempt` — complimentary accounts, deliberately granted. A comp account means the full
  product. There are a handful; if that ever stops being true, remove one entry from this list.

Not Pro: `trialing`, `legacy`, `grace`, `paywalled`. Trial users keep their own keys —
that is the whole point of the upgrade, and it keeps trial API cost at zero.

### Key selection

Two new server-only env vars. **Neither may be `NEXT_PUBLIC_`** — a `NEXT_PUBLIC_` var is
inlined into the browser bundle and would publish the key to every visitor:

- `LUSHNOTE_GEMINI_PRO_KEY` — a **paid** Google Cloud project, distinct from the existing
  `GEMINI_API_KEY`, which is a free-tier shared key gated by the 20/day `checkQuota`. Pro
  must not be quota-gated, so it cannot reuse that variable.
- `LUSHNOTE_GROQ_KEY` — already exists, already the shared safety net
  (`lib/serverAiKeys.ts:27`). Pro uses the same key; only the priority changes.

Extend `lib/serverAiKeys.ts` with one function that every AI route calls:

```ts
export function resolveAiKeys(input: {
  entitlementState: EntitlementState
  monthSpendMicros: number
  userGeminiKey: string | null
  userGroqKey: string | null
}): { geminiKey: string | null; groqKey: string | null; pro: boolean; degraded: boolean }
```

One pure function, so it is unit-testable in the node environment and both the routes and
the admin console reach the same verdict — the same reasoning that keeps
`resolveEntitlement` pure.

- Pro and under ceiling → LushNote's keys first, doctor's own as fallback.
- Not Pro → doctor's own keys first, `LUSHNOTE_GROQ_KEY` as the existing safety net.
  **Identical to today's behaviour.**
- Pro and over ceiling → `degraded: true`, doctor's own keys first, shared Groq behind them.

### The ceiling

```ts
export const PRO_MONTHLY_CEILING_MICROS = 0   // TODO: set from Stage 1 data
```

**Ship Stage 3 with the ceiling disabled (`0` meaning "no ceiling") and turn it on after a
fortnight of real numbers.** A ceiling guessed now would either never fire or fire on a
doctor doing ordinary work. Read it from `users/{uid}.aiCost[monthKey].micros`, which the
route already has in the profile it loaded — no extra read.

### Over the ceiling: never blocked

Per the rule the rest of the app is built on. Past the ceiling the doctor falls back to
their own key; if they have none, to the shared Groq key, which is exactly what a free-tier
doctor gets today. Work never stops.

A `proDegraded: true` flag rides back on the response the same way `geminiDailyLimit`
already does (`app/api/generate/route.ts:968-970` — "the note arrived, so nothing else in a
successful response would tell the doctor"). The notice must follow the tone already
established for `UpgradeNotice`: say what happened, that it is fine, what the trade-off is,
and leave. Never mid-recording.

### Client changes (small)

- `components/settings/ApiKeysPanel.tsx` — for a Pro doctor, say their keys are not needed
  and are kept only as a backup. Do not delete them; they are the degrade path.
- `app/(app)/generate/page.tsx:256` — the Gemini quota bar is meaningless on Pro. Replace
  with a plain "Pro" chip.
- `lib/quotaNotice.ts` — **verified, no change needed.** `CAN_UPGRADE` is an allow-list of
  `{trialing, legacy}` (`lib/quotaNotice.ts:35`), which is disjoint from `PRO_STATES`, so no
  Pro doctor can ever be shown the upgrade notice. Do not "fix" this.

### Tests — `tests/unit/pro-routing.test.ts`

- every `EntitlementState` maps to the intended key owner; the four non-Pro states get the
  doctor's own key
- over the ceiling returns `degraded` and never returns a null pair when any key exists
- a missing `LUSHNOTE_GEMINI_PRO_KEY` degrades to the doctor's own key rather than throwing
- `exempt` gets Pro (pins the decision above so a refactor cannot quietly drop it)

---

## No dead ends — the ones worth stating

| Failure | Behaviour |
|---|---|
| `LUSHNOTE_GEMINI_PRO_KEY` unset or invalid | Falls through to the doctor's own key, then Groq. Pro silently becomes today's behaviour; the admin panel shows the key as missing |
| Pro key hits Google's rate limit | Existing `lib/gemini.ts` model-walk and backoff apply unchanged, then Groq |
| Cost write fails | Fire-and-forget, `.catch(() => {})` — never blocks a note |
| Ceiling reached mid-consultation | Degrades on the next call; the in-flight one completes |
| Doctor is Pro but has no key of their own and is over ceiling | Shared `LUSHNOTE_GROQ_KEY`, i.e. a working clinic |
| Subscription lapses | `resolveEntitlement` returns `paywalled`; AI routes already 402 before any key is chosen |
| Pricing table drifts from Google's real rates | Labelled "estimated" everywhere; it informs the ceiling, it never bills anyone |

---

## Verification

**Stage 1** — `npm run test:unit` (new `ai-cost.test.ts` passes). Generate a note on a
preview deployment as the test account, then confirm `users/{uid}.aiCost` gained a month
key with non-zero `micros`, and that `/admin?section=billing` shows a figure for that
doctor. Confirm no doctor-visible change anywhere.

**Stage 2** — every AI path still works signed in: record, dictate, paste, scan a ward note,
create a document, ask the assistant, transcript Q&A. Then confirm each of the four routes
returns **401 to a curl with no Authorization header** — that is the actual security
assertion and it is worth doing by hand.

**Stage 3** — on preview, with a test account: as `trialing`, confirm the request still uses
the doctor's own key (the Gemini quota bar still counts up). Flip the account to `active`
via the admin console, confirm it now uses the Pro key and the quota bar is replaced by the
Pro chip. Set `PRO_MONTHLY_CEILING_MICROS` to something tiny, confirm `proDegraded` rides
back and the note still arrives.

**Every stage** — `npm run typecheck`, `npm run test:unit`, and
`npm run build` **with dummy `NEXT_PUBLIC_FIREBASE_*` values so it exits 0**. Without them
every page fails prerender and the build exits 1 regardless, which is how a real
`useSearchParams` error shipped on #36.

**Release** — one PR per stage, in order, each green on `quality` and a real (not skipped)
`e2e` run before the next begins. Add a row to `WORKFLOWS.md` for the Pro pathway before
Stage 3, per the regression contract.
