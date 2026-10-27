# Local development - LushNote on your own computer

`npm run dev:local` runs the whole app on your computer: sign-in, the database
and file storage all run locally, filled with made-up doctors, patients and
notes. It needs no keys and no access to any real Firebase project, and it
cannot reach one by mistake.

Read [`AGENTS.md`](AGENTS.md) before changing anything. It is the rulebook for
everyone who works on LushNote, not only AI agents.

---

## Where this fits

| | Local mode (this file) | Staging | Live |
|---|---|---|---|
| Where | your computer, and GitHub's test runner | Vercel preview, "Open staging" | lushnote.com.au |
| Database | Firebase emulators, made-up data | **the live database** | real doctors and patients |
| For | writing code, and testing every change before it is promoted | a quick look only | doctors |

Each of us tests on our own computer. Staging shares the live database, so
nothing that saves data is tried there.

---

## One-time setup

1. **Node.js 22.** From nodejs.org, the 22 LTS installer.
2. **Java 21 or newer.** The database emulator is a Java program. Install the
   free **Temurin 21 (LTS)** from adoptium.net. Then open a **new** terminal so
   it is found.
3. **The code and its packages:**

   ```
   git clone https://github.com/iamarasinghe96/lushnote-app.git
   cd lushnote-app
   npm ci
   ```

---

## Testing a pull request

```
npm run review -- 81
```

Fetches pull request #81, installs packages if they changed, and starts it in
local mode at http://localhost:3000 (sign in as below). The Releases page shows
the exact command on every pull request. When you are done: **Ctrl+C**, then
`git checkout main`. It refuses to run over uncommitted changes, so nothing of
yours gets mixed in.

## Every day

```
npm run dev:local
```

The first run downloads the emulators, which takes about a minute. Then:

- open **http://localhost:3000/e2e-login**
- sign in as **admin@lushnote.local**, password **local-admin**

You are "Dr Alex Local", a doctor with three made-up patients and the admin
console (avatar menu → Admin Console). **Ctrl+C** stops everything and saves the
data for next time.

| Command | What it does |
|---|---|
| `npm run dev:local` | Start. Keeps what you did last time. |
| `npm run dev:local -- --reset` | Start again from fresh made-up data. |
| `npm run dev:local -- --real-ai` | Use real AI. Needs your own keys in `.env.local` (`GEMINI_API_KEY` and others, see `docs/ARCHITECTURE.md` → Environment Variables). Without this flag the AI answers with canned replies, so everything works with no keys. |

A second made-up account exists for testing as a non-admin doctor:
**e2e-tester@lushnote.com.au**, password **local-e2e-password**.

"Sign in with Google" also works locally. It opens the emulator's pretend
account picker, where you can make up any account; no real Google account is
involved. A new account made that way starts at onboarding.

---

## What is switched off locally, and why

`.env.local` is optional. If you have one, local mode overrides everything that
would act on the real world from a laptop:

| Off | Because |
|---|---|
| All Firebase settings | replaced by the emulators, always |
| `GITHUB_TOKEN` | Promote on the local admin console would merge to main for real |
| Live Stripe keys | test keys (`sk_test_`, `pk_test_`) are kept, live ones are dropped |
| Slack and email | local errors and test emails must not reach real people |

---

## Before you push

Same as everyone (AGENTS.md section 3):

```
npm run typecheck
npm run test:unit
```

Then push a branch and open a pull request. Never push to `main`, and never
merge your own pull request: the owner promotes from the admin Releases page
after looking at staging.

---

## When something goes wrong

| What you see | What to do |
|---|---|
| *Java is not installed* or *needs Java 21* | Install Temurin 21 from adoptium.net, open a new terminal. |
| *The emulators did not start* / port already in use | Another local session is still running. Close it, or restart the computer. |
| Data did not survive a restart, with *Automatic export failed... did not respond to a status check* | Your computer uses a network proxy (`HTTPS_PROXY`). The Firebase tools send even local requests through it, so saving on exit fails. Everything else works; you just start from fresh made-up data each time. |
| Want to start over | `npm run dev:local -- --reset` |
