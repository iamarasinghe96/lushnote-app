# LushNote Deployment Guide

## Prerequisites
- Vercel account (vercel.com)
- GitHub repo: https://github.com/iamarasinghe96/lushnote-app
- Custom domain: lushnote.com.au (registered at Crazy Domains)
- Firebase project: lush-note (already configured)

## Step 1 — Connect to Vercel
1. Go to vercel.com and sign in
2. Click "Add New Project"
3. Import from GitHub → select `iamarasinghe96/lushnote-app`
4. Framework preset: Next.js (auto-detected)
5. Root directory: `.` (leave default)
6. Click "Deploy" — first deploy will fail (missing env vars — that's OK)

## Step 2 — Set Environment Variables
In Vercel dashboard → Project → Settings → Environment Variables,
add each variable for Production, Preview, and Development:

| Variable | Value |
|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY | AIzaSyAEgpB1eCm-zh9Rx-uTMoageFZWEBRXzQo |
| NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN | lush-note.firebaseapp.com |
| NEXT_PUBLIC_FIREBASE_PROJECT_ID | lush-note |
| NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET | lush-note.firebasestorage.app |
| NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID | 557843066844 |
| NEXT_PUBLIC_FIREBASE_APP_ID | 1:557843066844:web:4f120d8d9adee5fc716919 |

Note: No GEMINI_API_KEY needed — users provide their own.

## Step 3 — Redeploy
After setting env vars:
Vercel dashboard → Project → Deployments → click "Redeploy" on the latest deployment.

## Step 4 — Add Custom Domain
1. Vercel dashboard → Project → Settings → Domains
2. Add `lushnote.com.au`
3. Also add `www.lushnote.com.au` → redirect to `lushnote.com.au`
4. Vercel will show DNS records to add

## Step 5 — Configure DNS at Crazy Domains
Log in to Crazy Domains → DNS Settings for `lushnote.com.au`:

Add these records:
| Type | Name | Value |
|---|---|---|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

Note: Vercel may give you slightly different values — use whatever Vercel shows.
DNS propagation takes 10–60 minutes.

## Step 6 — Update Firebase Authorized Domains
Firebase Console → Authentication → Settings → Authorized domains:
Add `lushnote.com.au` and `www.lushnote.com.au`

Without this step, Google sign-in will fail on the production domain.

## Step 7 — Verify
1. Visit https://lushnote.com.au
2. Sign in with Google
3. Create a test note
4. Check Firestore → progress_notes for the saved document

## Environment Variable Reference
All secrets are user-provided at runtime (Gemini key, Groq key).
The only server-side config needed is Firebase (public keys — safe to expose).
