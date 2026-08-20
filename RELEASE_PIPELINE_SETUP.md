# Release pipeline — the setup you do once

Everything in the code is built and pushed. These are the seven things only you
can do, because they live in consoles this app has no key to. Budget about
twenty minutes. Do them in order — step 6 is the switch that makes the rest
binding, so it comes last.

Until step 6, nothing changes: pushes to main still deploy exactly as they do
today.

---

## 1. GitHub — create the token (2 min)

**github.com → your avatar → Settings → Developer settings → Personal access
tokens → Fine-grained tokens → Generate new token**

| Field | Value |
|---|---|
| Name | `lushnote-releases` |
| Expiration | 1 year (calendar a renewal — the panel will start returning 401 the day it lapses) |
| Repository access | **Only select repositories** → `iamarasinghe96/lushnote-app` |

Repository permissions — set exactly these four, leave everything else at
No access:

| Permission | Access | Why |
|---|---|---|
| Contents | **Read and write** | merging a pull request writes to main |
| Pull requests | **Read and write** | listing and merging |
| Checks | **Read** | reading whether `quality` and `e2e` passed |
| Actions | **Read and write** | the Re-run button |

Generate, then copy the token. It is shown once.

---

## 2. Vercel — environment variables (4 min)

**vercel.com → lushnote → Settings → Environment Variables**

Two for every environment:

| Name | Value | Environments |
|---|---|---|
| `GITHUB_TOKEN` | the token from step 1 | Production, Preview, Development |
| `GITHUB_REPO` | `iamarasinghe96/lushnote-app` | Production, Preview, Development |

Two for **Preview only** — untick Production and Development, and check the
boxes twice before saving:

| Name | Value | Environments |
|---|---|---|
| `NEXT_PUBLIC_E2E` | `1` | **Preview only** |
| `E2E_MOCK_AI` | `1` | **Preview only** |

Those last two make the test sign-in page exist and make the AI answer from a
canned reply. The code refuses both in production regardless of how these boxes
are ticked, so a mis-click fails safe — but tick them correctly anyway.

While you are in Settings, check **Git → Preview Deployments** is enabled (it is
by default), and under **Deployment Protection** check whether previews are
password-protected. If they are, either turn that off for previews, or generate
a **Protection Bypass for Automation** secret and add it as a GitHub Actions
secret named `VERCEL_AUTOMATION_BYPASS_SECRET` in step 5.

Redeploy once after saving, so the new variables are baked in.

---

## 3. Firebase — turn on email sign-in (1 min)

**console.firebase.google.com → lush-note → Authentication → Sign-in method →
Email/Password → Enable → Save.**

This is the only step with no API, which is why it is done by hand. It affects
nothing else: doctors still sign in with Google, and no email/password form
exists anywhere except the preview-only test page.

---

## 4. LushNote — create the test account (1 min)

**lushnote.com.au/admin?section=releases → Setup → Provision test account**

You get an email and a password. **Copy both now** — the password is shown once
and is not stored anywhere it can be read back. Pressing the button again is
safe; it issues a new password.

The account is a plain non-admin doctor with a completed profile and no billing
obligations. It cannot reach the admin console even if the password leaks.

---

## 5. GitHub — repository secrets (2 min)

**github.com/iamarasinghe96/lushnote-app → Settings → Secrets and variables →
Actions → New repository secret**

| Name | Value |
|---|---|
| `E2E_USER_EMAIL` | the email from step 4 |
| `E2E_USER_PASSWORD` | the password from step 4 |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | only if you needed it in step 2 |

---

## 6. GitHub — protect main (3 min) — **this is the switch**

**Settings → Branches → Add branch ruleset** (or Add rule), targeting `main`.

Turn on:

- **Require a pull request before merging** — 0 approvals required (you are the
  only reviewer, and requiring one would block your own Promote button)
- **Require status checks to pass before merging**, and add both:
  - `quality`
  - `e2e`
- **Require branches to be up to date before merging**
- **Block force pushes**

Leave "Do not allow bypassing the above settings" **off**, so the Releases
panel's override can still ship an emergency fix. Every override is logged and
reaches Slack.

If `quality` and `e2e` do not appear in the search box, open any pull request
first so GitHub has seen the check names once, then come back.

From this moment, no code reaches doctors without a pull request, two green
checks and your click.

---

## 7. Prove it works (5 min)

Ask a session for a trivial change — a word in some copy. Then:

1. It pushes a branch and opens a pull request. It will not merge it.
2. **lushnote.com.au/admin?section=releases** shows the pull request.
3. Click **Open preview** — the real app with the change, at its own URL.
4. Watch the two badges. `quality` goes green in about a minute, `e2e` in about
   four.
5. **Promote to live.** The Live now card says "deploying…" and flips to the new
   commit within a couple of minutes.
6. Check lushnote.com.au. The change is there.

Then prove the gate bites: ask a session to break a test on a branch on purpose.
Promote should be disabled with the reason written on the button.

---

## What you will see day to day

The panel at `/admin?section=releases` answers three questions without opening
anything else:

- **What is live?** Asked of the site itself, not inferred — the sha and the
  build time production actually reports.
- **What is waiting?** Every open pull request, what it changes, a link to it
  running, and whether it was tested.
- **Can I ship it?** A green button, or a grey one that says why not.

## When something goes wrong

| Symptom | What it means |
|---|---|
| "No preview deployment has been tested yet" | Vercel has not finished, or skipped the build. Wait, or push again. |
| `e2e` failed but the app looks fine | Open the check's **log** link. Failures upload a Playwright report with a screenshot and a trace of the exact step. |
| The version check fails with "did not return JSON" | Deployment Protection is on for previews — step 2's bypass secret. |
| Panel says GitHub is not configured | `GITHUB_TOKEN` / `GITHUB_REPO` missing, or the deployment predates them. |
| Panel returns 403 from GitHub | The token is missing one of the four permissions, or it expired. |
| A test flakes | CI retries once. If it flakes twice in a week it gets quarantined with `test.fixme()` and a follow-up — never deleted. |

## Cost

Actions on a private repo: 2,000 free minutes a month. One push cycle is about
seven. That is roughly 280 pushes a month before anything is billable.
