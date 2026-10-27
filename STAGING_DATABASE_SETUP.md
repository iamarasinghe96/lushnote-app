# Staging database - the setup you do once

Until now staging (the `preview` alias, "Open staging" in Releases) and every
pull request preview used the **live** Firebase project. Every review click and
every browser suite run wrote into the same database that holds doctors'
patients. After this setup, staging has a Firebase project of its own and live
is never touched by anything under review.

How it works: Vercel lets one variable hold a different value per environment.
Production keeps the live Firebase values. Preview (staging and every pull
request preview) gets the staging project's values. No code decides this, only
which boxes are ticked in Vercel, which is why the Releases panel now checks
and tells you which database staging is on.

Budget about 40 minutes. Do the steps in order.

---

## 0. Before you start

Promote the pull request that added this file **first**, while staging is still
on the live database. Its browser suite then passes the normal way. Everything
below is console work and changes nothing for doctors.

Keep two tabs open: the **live** Firebase project (`lush-note`) to read from,
and the new **staging** one you are about to create. Every step below says
which one it means. Check the project name at the top of the Firebase console
before you change anything.

---

## 1. Firebase - create the project (5 min)

**console.firebase.google.com → Create a project**

| Field | Value |
|---|---|
| Name | `lush-note-staging`. If Firebase changes the **Project ID** under the name (because the ID is taken), write down the ID it shows; you need it later. |
| Google Analytics | Off |

Then **upgrade it to the Blaze (pay as you go) plan** (bottom left, Upgrade).
New projects cannot use Storage without it. Staging traffic stays inside the
free allowance, so expect $0 to a few cents a month. To be safe, set a budget
alert: Google Cloud console → Billing → Budgets & alerts → Create budget →
$5 AUD, for this project only.

---

## 2. Firestore - the database (5 min)

**Staging project → Build → Firestore Database → Create database**

- **Location:** the same as live. To find live's: open the **live** project →
  Firestore Database. The location shows at the top of the data view (for
  example `australia-southeast1 (Sydney)`). The location cannot be changed
  later.
- **Mode:** Start in **production mode**.

Then, still in the staging project:

1. **Rules** tab. Open `firestore.rules` from the repository on GitHub (main
   branch), copy the whole file, paste it over what is there, **Publish**.
2. **Indexes** tab → **Composite** → **Create index**:
   - Collection ID: `progress_notes`
   - Field 1: `userId`, Ascending
   - Field 2: `updatedAt`, Descending
   - Query scope: Collection

   It takes a few minutes to build. Without it, the notes list on staging
   fails to load.
3. Optional: **Time-to-live** tab. Live deletes old logs automatically. Staging
   can do the same, or you can skip this, since staging logs are few. If you add them:
   - collection group `system_logs`, field `expiresAt`
   - collection group `stripe_events`, field `expiresAt`

   **Never `createdAt`.** A TTL deletes a document once its field is in the
   past, so a TTL on `createdAt` deletes everything within a day.

---

## 3. Storage - letterheads and signatures (2 min)

**Staging project → Build → Storage → Get started**

- Same location as Firestore, **production mode**.
- Then the **Rules** tab: copy all of `storage.rules` from the repository,
  paste, **Publish**.

---

## 4. Authentication - sign-in (3 min)

**Staging project → Build → Authentication → Get started**

1. **Sign-in method** → **Google** → Enable → pick your support email → Save.
2. **Sign-in method** → **Email/Password** → Enable → Save. Only the browser
   suite uses this; no doctor sees a password form.
3. **Settings** → **Authorized domains** → **Add domain** →
   `lushnote-app-git-preview-indika-amarasinghe-s-projects.vercel.app`
   (the staging alias, without `https://`).

---

## 5. Firebase - copy the staging keys (3 min)

**Staging project → gear icon → Project settings**

1. **General** → **Your apps** → the web icon `</>` → nickname
   `LushNote staging` → leave Hosting unticked → **Register app**. It shows a
   `firebaseConfig` block with six values: `apiKey`, `authDomain`,
   `projectId`, `storageBucket`, `messagingSenderId`, `appId`. Keep it open.
2. **Service accounts** → **Generate new private key** → a `.json` file
   downloads. Open it in Notepad. You need `project_id`, `client_email` and
   `private_key`.

The JSON file is a password to the staging database. Do not email it or put
it in the repository. Delete it after step 6.

---

## 6. Vercel - give Preview the staging values (10 min)

**vercel.com → lushnote → Settings → Environment Variables**

Nine variables change. Each one currently has a single entry, probably ticked
for Production, Preview and Development. For **each** of the nine:

1. Open the existing entry → **Edit** → **untick Preview** → Save. Leave its
   value alone: that value is live.
2. **Add New** → the **same name** → the staging value → tick **Preview only**
   → Save.

| Name | Staging value (from step 5) |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |
| `FIREBASE_ADMIN_PROJECT_ID` | `project_id` from the JSON |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | `client_email` from the JSON |
| `FIREBASE_ADMIN_PRIVATE_KEY` | `private_key` from the JSON: everything between the quotes, starting `-----BEGIN PRIVATE KEY-----` and ending `-----END PRIVATE KEY-----\n`. Paste it exactly as it is, `\n`s included. |

When you are done, each of the nine names shows **two** rows: one for
Production (and Development) with the live value, one for Preview with the
staging value.

**Never delete the live entry.** If Vercel will not let you untick Preview on
one (some sensitive variables are locked), stop and ask rather than deleting
and re-creating it: a mistyped live value takes sign-in down for every doctor.

Then delete the JSON file from your Downloads.

**Redeploy staging** so the new values are built in: **Deployments** → filter
by branch `preview` → the newest one → `⋯` → **Redeploy**, with **Use existing
Build Cache unticked**.

---

## 7. Make yourself the admin of staging (5 min)

Staging has its own user list, so you are a new user there with a different
user ID, and the admin check does not recognise you yet.

1. Open the staging URL and **sign in with Google**. You arrive as a brand-new
   doctor. Complete onboarding with your own details.
2. **Staging Firebase project → Authentication → Users** → copy your **User
   UID**.
3. **Vercel → Environment Variables**, the same two-step change as step 6, for
   these two:

   | Name | Staging value |
   |---|---|
   | `NEXT_PUBLIC_ADMIN_UID` | your staging UID |
   | `ADMIN_UID` | your staging UID (skip if this variable does not exist) |

4. **Redeploy staging** again, the same way as before.

---

## 8. The browser suite's test account (3 min)

The suite now signs in to the staging database, so its account has to exist
there.

1. Open **staging URL → `/admin?section=releases`** → **Setup** →
   **Provision test account**. Copy the email and password it shows; the
   password is shown once.
2. **GitHub → the repository → Settings → Secrets and variables → Actions**.
   Update `E2E_USER_EMAIL` and `E2E_USER_PASSWORD` with those values.

On the **live** admin console, the Provision button is replaced by a link to
staging once staging is on its own database. Pressing it on live would create an
account the suite never uses.

---

## 9. Check it worked (2 min)

1. **lushnote.com.au/admin?section=releases → Setup** shows, in green:
   *Staging database: lush-note-staging, separate from live (lush-note).*
2. On any open pull request, press **re-run** on Browser suite. It passes.
3. The **live** project's Authentication → Users list has no new accounts
   from today, and nothing named "E2E" appears in its data.

---

## What changes day to day

- **Staging starts empty.** Use made-up patients only. Never copy real
  patients or notes into staging: keeping clinical records in one place is the
  whole point.
- **Rules go to both projects.** When `firestore.rules` or `storage.rules`
  changes, publish to **staging first**, try it there, then publish to live
  after promoting. Staging now catches a bad rule before doctors do.
- **Admin content is separate.** Letterheads, hospital forms, announcements
  and email drafts on staging are their own copies. Upload what you need to test.
- **Billing on staging is not wired up.** The Stripe webhook points at live
  only, so subscribing on staging would not update staging. Do not put real
  card details into staging unless Preview has Stripe **test** keys.
- **The nightly job** (trials, emails, billing sweep) runs on production only.
  This setup does not affect it.
- **AI on staging is real** for you and mocked for the test account, the same
  as before.

---

## When something goes wrong

| What you see | What it means |
|---|---|
| Releases → Setup, amber: *Staging is using the live database* | One of the six `NEXT_PUBLIC_FIREBASE_*` variables still has Preview ticked on its live entry, or staging was not redeployed. |
| *Could not ask staging which database it uses* | Staging is running a build from before this change (push anything to `preview` and Refresh), or Vercel's Deployment Protection is blocking the check. The check passes Vercel's automation bypass secret when Vercel provides it to the app. If the message stays, check staging by hand: open `<staging URL>/api/version` while signed in to Vercel; it shows `firebaseProject`. |
| Google sign-in on staging: a popup that closes, or *unauthorized domain* | Step 4.3: the staging alias is missing from the staging project's Authorized domains. |
| Staging signs in but loads nothing, or *Missing or insufficient permissions* | Step 2.1: the rules were not published in the staging project (a new project denies everything). |
| The notes list on staging fails with an index error | Step 2.2: the composite index is missing or still building. |
| Admin console on staging says you are not an admin | Step 7: the UID is the live one, or staging was not redeployed after setting it. |
| Browser suite fails at sign-in | Step 8: the GitHub secrets still hold the live test account's password. |
| Server errors on staging (generate, billing, admin) | `FIREBASE_ADMIN_PRIVATE_KEY` was pasted with its quotes, or with the `\n`s turned into real line breaks. |

---

## Backups are a separate thing

A staging database is **not a backup**. It holds made-up data and protects
live from untested changes. A backup protects live from loss: a bad deploy, a
mistaken delete. LushNote should have both. A backup is console-only, with no
code:

**Live project → Firestore Database → Disaster recovery** (labelled **Backups**
in some versions of the console) → **Create backup schedule** → **Daily**,
keep for **14 days** or more. While you are there, consider turning on
**Point-in-time recovery**, which allows a restore to any minute of the last 7
days. A restore creates a new database beside the live one; it never overwrites
it.

Storage files (letterheads, signatures) are not part of a Firestore backup.
Roadmap item `PRV-28` tracks covering those.
