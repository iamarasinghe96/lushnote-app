# LushNote Monetization — Layered Implementation Plan

## Context

LushNote is currently free ("LushNote is free to use", `components/settings/SubscriptionPanel.tsx:55`). We are adding: a 3-month free Stripe subscription trial, then AUD $30/month worldwide (single AUD price, no localisation — foreign banks do FX). Cards worldwide; BECS Direct Debit for AU customers only. No payment details at signup; prompts at T-7d and trial-end day (email + in-app), 7-day grace with access if no payment method, then paywall. Access is decided ONLY by Stripe subscription status projected via signature-verified idempotent webhooks — never an app-computed date (BECS is delayed-notification). Invoices branded "Gaia Symbiosis" under the existing sole-trader ABN. Stripe Tax integrated with collection OFF; admin monitors AU-taxable rolling-12-month turnover vs the $75k GST threshold, plus a GST-registered toggle and Stripe Tax global obligation visibility. ATO 5-year retention overrides account deletion for financial records.

**User-confirmed decisions:** grace = **7 days**; GST display = **inclusive** ($30 stays $30 for AU, GST carved out); paywall = **block creation, keep reading** (AI + note/letter/form creation/editing blocked; read-only History/Patients, PDF/copy export, Settings, billing stay open — clinical records never held hostage).

**Env (test mode first):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. Feature flag = presence of `STRIPE_SECRET_KEY`; without it every billing route returns `{disabled:true}` and the app behaves exactly as today. Packages: `stripe` (server); `@stripe/stripe-js` + `@stripe/react-stripe-js` (Layer 4).

## Verified repo facts the design rests on

- `createProfile` (`lib/firestore/profiles.ts:15`) is a **non-merge `setDoc`** — would clobber server-written billing fields. Must become `{merge:true}` (onboarding `app/onboarding/page.tsx:132` is the only call site).
- `noPrivilegeEscalation()` (firestore.rules) pins only tier/status and does NOT survive field-removal on full setDoc — same hole would erase `billing`.
- Suspended-gate precedent: `app/(app)/layout.tsx:105` (client) + `status==='disabled'` 403s at `generate:763`, `chat:445`, `ocr:93`. **`/api/transcribe` has NO disabled check today** — entitlement layer adds one.
- Lifecycle mailer: `findCandidates()` (`lib/firestore/lifecycle.ts:60`) full-scan, one-email-per-doctor-per-run via `continue`; send-once = `users/{uid}.lifecycleEmails.{type}`; marks sent BEFORE logging. `trialEnding` derives trial end from `createdAt+182d` — must be retired. Email type constants are DUPLICATED in `components/admin/EmailsPanel.tsx:8-23` incl. client-side preview substitution.
- `trialEnding` template already links `{{site}}/billing` — route doesn't exist yet.
- Cron: single `vercel.json` entry `0 23 * * *` → `/api/lifecycle` GET (`maxDuration=300`, `MAX_PER_RUN=100`). Hobby plan caps crons → reuse this one.
- In-app "seen" today is per-device localStorage (`WhatsNewPopup`) — billing prompts need per-user flags.
- `redactUser()` (`lib/firestore/adminUsers.ts:41`) is an explicit allow-list — billing summary must be added there to be visible in admin.
- `cascadeDeleteUser` (`adminUsers.ts:143-163`) deletes users doc + subcollections + auth + storage — retention record must live OUTSIDE `users/{uid}`.
- Admin section = 2 entries in `app/admin/page.tsx` (`SECTIONS` L22, `PANELS` L38). `/terms` exists at `app/terms/page.tsx`. No Stripe anywhere in the repo today.

## Design decisions

### D1 — Data model
**Nested `billing` map on `users/{uid}`** (one rules pin, one redaction projection), server-written only:
`{ stripeCustomerId, subscriptionId, subscriptionStatus ('trialing'|'active'|'past_due'|'canceled'|'unpaid'|'incomplete'|'incomplete_expired'|'paused'-projection), trialEndsAt (ms — THE only trial date anywhere), currentPeriodEnd, cancelAtPeriodEnd, paused, paymentMethodType ('card'|'au_becs_debit'|null), paymentMethodStatus ('none'|'pending'|'active' — 'pending' = BECS mandate not yet active), country, gracePeriodEnd, paywalledAt, billingExempt?, consent {acceptedAt, ip, tosVersion}, updatedAt }`.
Client-writable, top-level (NOT inside billing): `billingPrompts?: { trialReminder7d?, trialReminderDue?, paywalled? }` (ms) — mirrors `lifecycleEmails`.

**`billing_records/{uid}`** — survives account deletion (5-year ATO retention). `{ uid, email, displayName, stripeCustomerId, subscriptionId, consent, country, createdAt, accountDeletedAt? }`. Invoices are NOT mirrored — Stripe is system of record; this doc is the durable uid→customer mapping + DDR/charge authorisation. No delete path exists anywhere, by construction. Catch-all rule already denies clients.

**`config/billing`** — Admin-SDK-only: `{ gstRegistered, gstEffectiveDate, gstInclusive: true, priceId, turnoverCache: { auTaxable12mCents, computedAt, byMonth[] }, updatedAt }`. AU rolling-12-month turnover = derived from Stripe paid invoices (paginated list, AU-tax-location only), recomputed nightly by the sweep into this cache — no parallel ledger, self-healing, refunds naturally reflected.

**`stripe_events/{eventId}`** — webhook idempotency ledger `{ type, created, processedAt }` + Firestore TTL (~30d) on `processedAt`.

`redactUser()` gains `billingSummary`: `{ subscriptionStatus, trialEndsAt, currentPeriodEnd, paymentMethodType, paymentMethodStatus, billingExempt, paywalledAt, stripeCustomerId, subscriptionId }` (IDs needed for dashboard deep links; not secrets).

### D2 — Rules
New `billingUntouched()` on `users/{uid}` update: if `billing` exists it must be present AND equal in the request; if absent it must stay absent. (Closes the field-removal hole `noPrivilegeEscalation()` has.) Create: add `!('billing' in request.resource.data)`. `billingPrompts` added to `profileValid()` as a map. `billing_records`/`config`/`stripe_events` stay under catch-all deny. **Because of the pin, `createProfile` MUST switch to `{merge:true}` in the same layer** or onboarding re-runs would be denied.

### D3 — Webhook (`app/api/stripe/webhook/route.ts`, runtime nodejs)
Raw body via `await req.text()` → `stripe.webhooks.constructEvent(raw, sig, secret)` (never `req.json()` first). Idempotency: `stripe_events/{event.id}` written with `.create()` before processing; exists → 200 immediately (Stripe retries ~3 days).
**Refetch pattern for ordering:** every subscription-shaped handler ignores payload state, does `stripe.subscriptions.retrieve()` + default-PM lookup, and projects CURRENT truth into `users/{uid}.billing` (uid from `customer.metadata.uid`). Order-independent, replay-safe, self-healing. Handlers stay small (one retrieve + one write); heavy work lives in the cron.

Event map (one `project(subscriptionId)` does most):
- `customer.subscription.created/updated/deleted` → project status/trialEndsAt/currentPeriodEnd/cancelAtPeriodEnd/paused; set `gracePeriodEnd = trialEndsAt + 7d` once when trial ends with `paymentMethodStatus==='none'`.
- `invoice.paid` → project; clear grace/paywalledAt. `invoice.payment_failed` → project (dunning owns emails). `invoice.finalized` → project only.
- `setup_intent.succeeded` → set customer default PM; project type; BECS → `paymentMethodStatus:'pending'`; clear grace; re-project (un-paywalls grace-paywalled).
- `payment_method.attached/detached` → project PM. `mandate.updated` → BECS active/inactive.
- `payment_intent.processing` (BECS clearing) → no change (entitlement covers it). `payment_intent.succeeded/failed` → project via invoice's subscription.
- `charge.dispute.created` → `logToSink({level:'error', tag:'billing-dispute'})` (→ Slack) + note on `billing_records`; NO automatic access change.

**Subscription creation at onboarding completion:** `app/api/billing/route.ts` POST `action:'start-trial'` — `customers.create({email, name, metadata:{uid}})` + `subscriptions.create({customer, items:[{price}], trial_end: now+3 calendar months, trial_settings:{end_behavior:{missing_payment_method:'create_invoice'}}})` (`create_invoice` keeps the sub alive into past_due with a real first invoice — what grace+dunning needs; VERIFY enum + status sequence). Idempotent (refuses if customer exists); refuses stubs (`onboardingComplete !== true`). Fire-and-forget from onboarding `handleComplete` after the welcome-email call; nightly sweep backfills anyone missed (= also the launch backfill mechanism).

### D4 — Entitlement
- `lib/entitlement.ts` — PURE resolver shared by client and server: `resolveEntitlement(billing, now) → { entitled, state, reason }`.
- `lib/billing.ts` — server: Stripe singleton, `stripeEnabled()`, `priceString()`, `getEntitlement(uid)` (Admin SDK read → resolver), `stripeOffboard(uid)`.

Rules: no `billing` → entitled (`legacy`, pre-backfill safety). `billingExempt` → entitled. `trialing|active` → entitled (`cancel_at_period_end` keeps status active until period end — cancel-with-access falls out free). `past_due` → entitled if PM present (dunning/BECS clearing) OR `now <= gracePeriodEnd`, else paywalled. `paused` → entitled until `currentPeriodEnd`, then paywalled. `canceled|unpaid|incomplete_expired` or `paywalledAt` set → paywalled.

**Pause = `pause_collection: { behavior:'void' }`** — keeps subscription, PM AND BECS mandate intact (brief requires it); paid period runs out naturally; our `paused` projection + `currentPeriodEnd` cut access at period end. Resume clears it (VERIFY billing-anchor behavior on resume).

Enforcement: 402 under the existing disabled-403s in generate/chat/ocr + NEW check in transcribe; client paywall blocks `/generate`, `/edit`, `/transcript` (PaywallScreen) while History/Patients/Export/Settings stay reachable read-only (edit/create affordances hidden). AI routes are the hard wall.

### D5 — Payment capture (`app/billing/page.tsx`, OUTSIDE the (app) group so paywalled users reach it)
SetupIntent + Payment Element with `automatic_payment_methods` — Stripe shows card everywhere, BECS for AU, and renders the BECS DDR mandate text itself (you can't accept a mandate on someone's behalf; the element does it first-person). Consent checkbox (ToS + "I authorise Gaia Symbiosis to charge my card / debit my account under the Direct Debit Request") gates submit; `action:'record-consent'` writes `{acceptedAt, ip (x-forwarded-for first hop), tosVersion}` to `billing` AND `billing_records` BEFORE `confirmSetup` (3DS-safe return_url). VERIFY BECS surfaces via automatic_payment_methods on SetupIntent; fallback = explicit `payment_method_types: ['card','au_becs_debit']`.
**Customer Portal** for cancel/PM-update/invoice history (config: cancel-at-period-end, no plan switch). **Pause/resume = custom buttons** (Portal lacks pause_collection control — VERIFY; prefer Portal if since added). Invoicing branding ("Gaia Symbiosis", ABN footer) is Stripe dashboard config, not code.

### D6 — Reminders
`LifecycleEmailType` gains `'paymentSetup7d'|'paymentSetupDue'|'paywalled'`; **`'trialEnding'` deleted** from BOTH `lib/emails/lifecycle.ts` and the duplicated `EmailsPanel.tsx` constants + preview. New `{{price}}` placeholder (from `priceString()`) in both files + `RenderContext`/`fill()`. New `findCandidates()` branches ABOVE `apiSetup` (priority via `continue` design), reading STORED `billing.trialEndsAt`; delete the `createdAt+182d` branch + `FREE_TRIAL_DAYS`/`TRIAL_NOTICE_DAYS`. No recent-use gating on billing emails — they're service messages about impending state change. Skip when `billingExempt`/no billing/`emailOptOut`.
Failed-payment emails: **Stripe dunning handles them** (Smart Retries + customer emails ON in dashboard); we email only when access changes (`paywalled`).
In-app: `components/BillingBanner.tsx` (RateLimitBanner precedent), rendered from `app/(app)/layout.tsx`; shows when resolver says T-7d/due/grace AND `billingPrompts[key]` unset; dismissal writes the flag (per-user, cross-device — deliberately NOT the WhatsNew localStorage pattern). "Once, on or after threshold" semantics everywhere.

### D7 — Cron
Reuse the single 23:00 UTC cron. Lifecycle GET calls new `runBillingSweep()` (`lib/firestore/billingSweep.ts`) BEFORE `findCandidates()` — so a paywall flipped tonight emails tonight. Steps (idempotent): (1) backfill trials for `onboardingComplete && !billing && !disabled`; (2) grace expiry: `gracePeriodEnd < now && paymentMethodStatus==='none' && !paywalledAt` → set `paywalledAt` (cron-driven because Stripe emits no event for "nothing happened"); (3) turnover cache + tax snapshot refresh. Timezone: thresholds are `now >= threshold` vs Stripe's UTC seconds; ≤24h slack, always in the customer's favour.

### D8 — Admin
New Billing section (`SECTIONS`+`PANELS`), `components/admin/BillingPanel.tsx` + `app/api/admin/billing/route.ts` (requireAdmin + writeAudit; actions: overview / setGst / setExempt / recordsExport / refreshTurnover). Turnover card alerts at ≥80% of $75k. Per-user billing card in UsersPanel (via `billingSummary`) + exempt toggle + deep links to Stripe customer/subscription pages.
**GST toggle without price mutation (Stripe constraint: `tax_behavior` immutable once a price is used):** create THE price with `tax_behavior:'inclusive'` on day one (inclusive is the locked default, so a second price is never needed). Toggle = (a) write `config/billing`; (b) create AU registration in Stripe Tax (VERIFY `stripe.tax.registrations` API shape); (c) enable `automatic_tax` on new + existing AU subscriptions (VERIFY update on live subs). AU invoices then show "$30.00 incl. $2.73 GST"; non-AU untouched. Global obligation monitoring: likely NO public API (VERIFY) → show our AU computation + a labelled deep link to Stripe Tax → Thresholds dashboard.
Records export = CSV of `billing_records` (includes deleted accounts) + Stripe dashboard export link. No delete-financial-records verb exists anywhere.

### D9 — Copy (exact strings in Layer 8 tasks)
`priceString(gstRegistered, isAU)` → `'AUD $30/month'` | `'AUD $30/month (incl. GST)'` — single source for SubscriptionPanel, /billing, landing, emails, paywall. Public unauthenticated `action:'public-config'` returns `{gstRegistered}` for the landing page. FX note: "Prices are in Australian dollars. If your card is issued outside Australia, your bank converts the charge and may add a small foreign-transaction fee."

### D10 — ToS (`app/terms/page.tsx`)
New "Subscriptions & Billing" section: trial, price, cancel (access to period end, no partial refunds, ACL rights unaffected), pause (stops future charges, access ends at period end, details kept, resume anytime), DDR authorisation naming Gaia Symbiosis + ABN, 5-year record retention surviving account deletion. Bump `tosVersion` used in consent.

---

## Layers (each independently shippable)

### Layer 1 — Foundation: SDK, types, rules, Stripe dashboard config (no user-visible change)
Tasks: add `stripe`; create `lib/billing.ts` + `lib/entitlement.ts`; extend `User` with `billing`+`billingPrompts`; rules `billingUntouched()` + create-denial + `billingPrompts` in `profileValid()` (mirror into CLAUDE.md); `createProfile` → `{merge:true}`. Stripe test dashboard: product + AUD $30/month price with `tax_behavior:'inclusive'` AT CREATION; Stripe Tax on (no registrations); Invoicing branded Gaia Symbiosis + ABN; BECS enabled; Portal configured; dunning Smart Retries + failure emails ON.
Files: `package.json`, `types/index.ts`, `firestore.rules`, `CLAUDE.md`, `lib/billing.ts`*, `lib/entitlement.ts`*, `lib/firestore/profiles.ts`.
Accept: `tsc --noEmit` clean. Rules: client write to `billing` DENIED; full setDoc omitting existing `billing` DENIED; ordinary profile update ALLOWED; create with `billing` DENIED. Onboarding completes (merge regression). App runs with zero Stripe env.

### Layer 2 — Trial subscription at onboarding + webhook projector (ships dark)
Tasks: `app/api/billing/route.ts`* (`start-trial`, D3); `app/api/stripe/webhook/route.ts`* (D3 full map); write `billing_records/{uid}`; fire-and-forget call in onboarding `handleComplete`; Firestore TTL on `stripe_events.processedAt`; register webhook endpoint (test).
Accept (with `stripe listen --forward-to localhost:3000/api/stripe/webhook`): fresh onboarding → customer (metadata.uid) + trialing sub in dashboard; `billing.subscriptionStatus==='trialing'`, `trialEndsAt`≈+3mo; `billing_records` exists. Redeliver same event → 200, no duplicate processing. `stripe subscriptions update <id> --cancel-at-period-end` → `cancelAtPeriodEnd:true` projected. Stub user gets nothing.

### Layer 3 — Entitlement enforcement: 402s, paywall UI, grace sweep
Tasks: 402 via `getEntitlement()` in generate/chat/ocr (under existing disabled checks) + transcribe (new); layout paywall for `/generate|/edit|/transcript` via `components/PaywallScreen.tsx`* (D9 copy); pass `entitled` so History/Patients hide create/edit affordances; `lib/firestore/billingSweep.ts`* (backfill + grace flip) called from lifecycle GET; client 402 → toast → `/billing`.
Accept: trialing user unaffected. Hand-set `{status:'unpaid', paywalledAt:now}` → paywall on create routes, History/Patients/Export/Settings readable, API 402. `billingExempt` → entitled. Grace: past `trialEndsAt`, no PM → `gracePeriodEnd` set by webhook; access continues; past `gracePeriodEnd` + cron run (curl with CRON_SECRET) → `paywalledAt` set once (idempotent on rerun). Legacy no-billing user entitled.

### Layer 4 — /billing page: Payment Element, consent, Portal, pause
Tasks: `app/billing/page.tsx`* + `components/billing/PaymentSetup.tsx`*; extend billing API: `state`, `setup-intent`, `record-consent`, `portal`, `pause`, `resume`; webhook `setup_intent.succeeded` → default PM + clear grace + un-paywall.
Accept (test mode): card 4242… → PM active, default set. 3DS 4000 0000 0000 3220 → challenge → success. 4000 0000 0000 0341 → attaches, then payment fails → past_due, still entitled (dunning). BECS BSB 000-000: acct 000123456 → mandate pending→active via `mandate.updated`; 111111113 → fails after processing (VERIFY test-table semantics); 666666660 → dispute → Slack error, no access change. Consent blocks submit until ticked; `consent.acceptedAt/.ip` in both docs. Portal cancel → `cancelAtPeriodEnd` projected, "access until {date}" shown. Pause → `pause_collection` in dashboard, projected; resume clears.

### Layer 5 — Reminders: emails + banner, trialEnding retired
Tasks: D6 across `lib/emails/lifecycle.ts`, `lib/firestore/lifecycle.ts`, `components/admin/EmailsPanel.tsx` (both constant copies + preview + `{{price}}`); delete 182d branch + constants; `components/BillingBanner.tsx`* + layout render + `billingPrompts` dismissal write.
Accept: `trialEndsAt` now+6d, no PM → admin Emails shows 1 due `paymentSetup7d`; cron sends once (second run: 0 due); stamp written; email links `/billing`, renders price. Banner shows in-app; dismiss → flag → gone on second device. Past-due and paywalled variants fire once each. `emailOptOut`/`billingExempt` → nothing. No `trialEnding` remains anywhere (grep).

### Layer 6 — Deletion & retention
Tasks: `stripeOffboard(uid)` in `lib/billing.ts`: cancel sub immediately, detach all PMs (VERIFY detach cancels BECS mandate), stamp `billing_records.accountDeletedAt`; never touches customer/invoices. Pre-step in `cascadeDeleteUser`; self-delete gets `action:'offboard-self'` (requireUser) called from ProfilePanel delete flow (best-effort; admin cascade is backstop).
Accept: admin-remove a subscribed test user → Stripe sub canceled + PM detached, customer + invoices INTACT; `billing_records` intact with `accountDeletedAt`; `users/{uid}` gone. BECS variant → mandate inactive. Self-delete same. Grep: nothing deletes from `billing_records`.

### Layer 7 — Admin: Billing panel, GST toggle, turnover, exempt
Tasks: D8 — SECTIONS/PANELS entries; `components/admin/BillingPanel.tsx`*; `app/api/admin/billing/route.ts`*; `redactUser` billingSummary; UsersPanel billing card + exempt toggle (audited); sweep step 3 (turnover cache); `config/billing` bootstrap.
Accept: with paid test invoices, refreshTurnover shows AUD sum; alert styling at hand-set ≥$60k. GST toggle → config written, AU registration in Stripe Tax, new AU sub invoice "incl. $2.73 GST", non-AU untouched, audit row. User card renders with working deep links; exempt flips entitlement immediately. Export CSV includes deleted account's row. No delete action.

### Layer 8 — Copy, ToS, landing, launch backfill
Tasks: SubscriptionPanel L54-69 → state-aware card ("Your LushNote subscription", state chip, D9 body incl. the kept hardship sentence, "Manage billing" → `/billing`). Landing: new pricing section — "Three months free. Then {price}." + methods + FX note. `/terms`: D10 section; bump tosVersion. Launch backfill = deploy with live keys (sweep backfills all existing complete users onto fresh 3-month trials) + What's New announcement via existing AnnouncementsPanel. Update CLAUDE.md (billing section, envs, rules).
Accept: Subscription tab correct per persona (trialing/active/paused/grace/paywalled/exempt). Landing price flips with GST toggle. Terms renders; consent records new tosVersion. Staged sweep gives a pre-existing user a trialing sub ≈+3mo; announcement shows once.

---

## Risks & edge cases (watched)

- **BECS clearing:** `past_due` with PM = entitled; `payment_intent.processing` = no-op. A first debit that fails late lands in dunning, never an instant paywall.
- **Last-day payment entry:** `setup_intent.succeeded` clears grace; dunning retry (or force `invoices.pay` — VERIFY for snappier UX) collects; grace ≥7d means no race can paywall.
- **First-charge failure:** past_due + PM → entitled through dunning; final failure → webhook → paywalled + email.
- **Tax location:** Stripe Tax determines from PM billing details/address/IP; we store only `billing.country` (for priceString + turnover bucketing) and the consent IP — nothing more.
- **Idempotency/ordering:** create-guard + refetch projection; replay-safe, order-independent. TTL bounds the ledger.
- **`createProfile` clobber:** real (verified non-merge setDoc) — fixed by merge + denied by rules. Same removal hole exists today for tier/status — fix in passing, same style.
- **Stubs never get subscriptions** (start-trial + sweep both filter `onboardingComplete`).
- **Existing users at launch:** fresh 3-month trial from launch night for everyone via sweep backfill + announcement (more generous than crediting the old 182-day copy; flagged as business decision, recommended).
- **Cron limits:** sweep rides the existing 23:00 UTC cron; no vercel.json change.
- **MoR future:** all Stripe specifics confined to `lib/billing.ts` + 2 API routes; the app consumes only the neutral `billing` projection + resolver. A Merchant-of-Record switch replaces the projector, not the app.
- **VERIFY-DURING-IMPLEMENTATION register:** `trial_settings.end_behavior.missing_payment_method` enums/status sequence; BECS via automatic_payment_methods on SetupIntent; Portal pause support (assumed absent); pause-resume billing anchor; `automatic_tax` update on live subs; `stripe.tax.registrations` API shape; existence of a Tax obligations API (assumed dashboard-only); BECS test-number failure semantics; PM detach cancelling BECS mandate; force-`invoices.pay` on PM attach.

## Verification (end-to-end)

Stripe test mode + `stripe listen --forward-to localhost:3000/api/stripe/webhook` + a Stripe **test clock** customer to advance time through: signup → trialing → T-7d email/banner → trial end → (a) card path 4242 → active → invoice paid; (b) BECS path 000123456 → processing → active days later; (c) no-PM path → grace → day-7 cron flip → paywalled email → add card → restored; (d) failing card 0341 → dunning → final failure → paywalled. Each layer's acceptance criteria above are the per-layer gates; `npx tsc --noEmit` after every layer; rules checks via console/emulator at Layer 1.

(* = new file)
