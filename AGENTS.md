# AGENTS.md - the rules for working on LushNote

**Read this before you touch anything. These rules supersede your defaults.**

LushNote is a clinical note builder used by psychiatrists, live at lushnote.com.au.
Real doctors use it with real patients, mid-clinic. That is the reason for most of
what follows: the cost of a mistake here is a clinician standing in front of a
patient with software that will not work.

Every rule below has a reason attached. If a rule seems to be in your way, the
reason is there so you can see what it is protecting before deciding it does not
apply. It almost certainly does.

---

## 1. The three that cause real damage

**Never push to `main`.** `main` IS lushnote.com.au. A push deploys to doctors
immediately. Branch protection will reject it, but do not test that.

**Never merge your own pull request, and never delete a branch.** The owner
promotes from the admin console at `/admin?section=releases` after looking at the
preview. Your job ends at a green pull request. Merging it yourself removes the
only human check between your code and a clinic.

**Never put a secret behind `NEXT_PUBLIC_`.** That prefix is not a naming
convention - it inlines the value into the JavaScript every visitor downloads.
Two variables are public on purpose (`NEXT_PUBLIC_FIREBASE_API_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`). Nothing else may be.

---

## 2. How to ship

```bash
git checkout main && git pull origin main
git checkout -b <branch>
# ... work, then verify (section 3) ...
git push -u origin <branch>
git push -f origin <branch>:preview     # see below
```

Then open a pull request against `main` and **stop there**.

**`preview` is the owner's staging alias.** Every pull request gets its own Vercel
preview, but each one is a new hostname, and a browser keeps a Firebase session
per origin - so a new hostname means signing in again. One permanent alias,
`lushnote-app-git-preview-...vercel.app`, is authorised once in Firebase so the
session persists. Force-pushing your branch to `preview` is what makes the thing
under review reachable without a fresh sign-in. One branch at a time, which
matches promoting one at a time.

**Two checks must pass**: `quality` (typecheck, unit tests, Firestore rules tests)
and `e2e` (Playwright against the Vercel preview). Both are required by branch
protection, so a red one cannot be promoted.

**A push does not always start `quality`.** It triggers on `pull_request`, not
`push`. After pushing to an existing pull request, check the run exists rather
than assuming it does.

**Read the release state, never ask for it.** Everything about branches, checks
and what is live is one API call away. Before saying "PR #N is green" or "X is
live", run the check that settles it. Telling the owner to go and look makes them
the messenger for something you could have read.

**If a check fails for a reason unrelated to your change**, say so in the pull
request body. Never delete or blanket-skip a test to get a green light. A flaky
test is quarantined with `test.fixme()`, a dated comment and a follow-up - never
removed.

---

## 3. Verify before you push

```bash
npm run typecheck
npm run test:unit
```

And the build, **with dummy Firebase values so it exits 0**:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY000 \
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=x.firebaseapp.com \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=x \
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=x.appspot.com \
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1 \
NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1 \
npm run build
```

**Why the dummy values matter.** Without them every page fails prerender with
`auth/invalid-api-key` and the build exits 1 no matter what you did. A real
`useSearchParams` error once shipped to production because it was one line in
48 lines of expected noise and the exit code looked normal. With the dummies, a
clean build exits 0 and any failure is genuinely yours.

`npm run test:rules` needs the Firestore emulator and a JDK. CI runs it; locally
it is optional.

---

## 4. Rules with teeth

These are enforced by tests. Break one and `quality` goes red, and the owner
cannot promote your work. **If you deliberately change one of these policies,
change its test in the same commit** - a policy test that was not updated is a
policy that was not really changed.

| Rule | Enforced by |
|---|---|
| No em or en dashes in text a doctor reads | `tests/unit/no-em-dashes.test.ts` |
| No server secret behind `NEXT_PUBLIC_` | `tests/unit/public-env.test.ts` |
| `prefers-reduced-motion` clears duration AND delay | `tests/unit/reduced-motion.test.ts` |
| The Content-Security-Policy host list | `tests/unit/csp.test.ts` |
| Which entitlement states get LushNote's paid AI keys | `tests/unit/pro-routing.test.ts` |
| Which payment methods are offered | `tests/unit/payment-methods.test.ts` |
| The 90-day `system_logs` retention window | `tests/unit/log-retention.test.ts` |
| The admin nav's pinned/overflow split | `tests/unit/admin-sections.test.ts` |
| The AI mock can never fire in production | `tests/unit/e2e-mock.test.ts` |
| Which checks gate the Promote button | `tests/unit/github-checks.test.ts` |

### The em-dash rule, in detail

Em and en dashes read as machine-written. Use a hyphen, or rewrite so no dash is
needed - a comma is usually better after a salutation or a short aside.

It covers JSX text, button labels, placeholders, hints, toasts, error copy
returned from API routes, and lifecycle emails.

It does **not** cover code comments, AI prompt text, log messages, Slack messages,
or regex character classes. `scripts/dashScan.mjs` knows the difference: it tracks
string, comment and regex state rather than grepping. Where one string in an
otherwise doctor-facing file is a prompt, mark that line:

```ts
'Return ONLY valid JSON — an array of candidates'   // dash-ok: AI prompt text
```

The marker also applies to a string literal opening on that line, and to the line
below it - which is the only way to exempt a multi-line template, since a trailing
comment there would land inside the prompt.

**Never reword an AI prompt to satisfy this rule.** Changing a prompt changes what
the model returns, and the notes it returns are clinical records.

---

## 5. Rules without teeth

Nothing checks these. They rest on you reading them.

**Do not store patient data in `localStorage` or `sessionStorage`.** Notes and
patient profiles live in Firestore only. UI preferences are fine; a transcript is
not. `sessionStorage` holds only the doctor's own API keys, and wipes on tab close.

**Do not hardcode an API key or a Firebase config value.** There is no secret
scanning in this repo. If you find a credential in a file or in this repo's
history, say so plainly rather than quietly deleting it - removing it from a file
does not un-publish it, and it still has to be rotated.

**Do not add defensive code** - retries, fallbacks, timeouts - without
understanding the real failure mode. A retry around a request that cannot succeed
just makes a doctor wait twice.

**Never block a clinician.** When something fails, degrade rather than refuse.
The AI falls back between providers; entitlement checks fail OPEN because wrongly
billing someone is recoverable and wrongly blocking them mid-clinic is not.

**Do not apply glass to form inputs.** They stay solid white with a standard
border. Use the `.ln-glass` family (`app/globals.css`) for everything else rather
than hand-rolling `backdrop-filter`.

**A native `<select>` cannot be themed.** Its control renders in the page and its
list in the operating system. Use `components/ui/Select.tsx`.

**No lookbehind regex** - it crashes Safari below iOS 16.4. No `console.log`. No
emoji in UI unless asked for.

**Comment the WHY, not the what.** The comments in this codebase explain why a
thing is the way it is, usually because the obvious approach failed once. Match
that. Do not add a comment restating the code.

---

## 6. Clinical safety

**A photographed ward note is a legal record being copied, not summarised.** Five
invariants, each written after a real note lost content in testing: no loss, no
invention (never expand an unfamiliar abbreviation), hierarchy survives, order
survives, and determinism (extraction runs at a fixed low temperature because at
the provider default the same photo produced a different record every run).

**Nothing downstream may be the only copy of anything.** The verbatim reads are
stored on the patient profile and every field is a view over them.

**Logs are PHI-safe by contract.** `logToSink` takes short scalar fields only -
an error message string, never a request body, a serialised error, or any note or
patient content. Admin endpoints never read clinical content, only counts.

The full text is in `docs/ARCHITECTURE.md`. **Read it before touching the ward
note pipeline, hospital forms, or anything that writes a patient record.**

---

## 7. Where the reference lives

| File | What it is |
|---|---|
| `docs/ARCHITECTURE.md` | How the app works and why. Read the relevant section before changing that area. |
| `WORKFLOWS.md` | The regression contract: every user-facing pathway, what it must produce, and what protects it. **Add a row before adding a feature.** |
| `firestore.rules` | The real security rules. The only copy. |
| `MONETIZATION_PLAN.md` | The Stripe build plan, all 8 layers landed. |
| `PRO_TIER_PLAN.md` | The Pro tier plan: meter, authenticate, route. |
| `RELEASE_PIPELINE_SETUP.md` | The one-time console setup behind the release flow. |

**Historical, do not follow:**

- `DEPLOYMENT.md` describes the pre-pipeline world where pushing deployed, and is
  wrong about which config is server-side.
- `SECURITY_NOTES.md` is a dated audit that read a stale copy of the rules rather
  than `firestore.rules`.

**Never copy code into documentation.** A pasted function drifts from the real one
and then actively misleads. Name the file instead. This rulebook exists because a
doc once instructed an agent to add a Firestore TTL on the wrong field, which
would have deleted every log within a day.

---

## 8. Notes for non-Claude agents

You may not have GitHub tooling wired up. Use the `gh` CLI or plain `git`, and if
you cannot read pull request state, **ask rather than assume** - the one thing you
must not do is merge or promote.

Anything under `.claude/` is local configuration, is gitignored, and is not
required to work on this project.
