'use client'

// The headers every call to an AI route needs.
//
// CLIENT ONLY. It imports the Firebase client SDK, so it must never be pulled
// into a server bundle - which is why this is not in lib/utils.ts, where
// quotaDate already is and where lib/firestore/profiles-admin imports from.
//
// Before this, every call site hand-built the same three lines and the uid was
// sent in the request BODY, unverified. That was survivable while the routes
// only ever spent the doctor's own key. It stops being survivable the moment a
// route can spend LushNote's paid key on the strength of that uid.

import { auth } from '@/lib/firebase'
import { getGroqKey, getGeminiKey } from '@/lib/utils'

/**
 * `Authorization` proves who is calling. The two key headers are what the
 * doctor brought, and stay optional: a Pro doctor may have none at all.
 *
 * A failed token fetch sends the request WITHOUT the header rather than
 * throwing. The route then answers 401, which the caller already handles - and
 * a rejected promise here would leave a dead button mid-clinic with nothing on
 * screen to explain it.
 */
export async function aiHeaders(opts: { json?: boolean } = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  if (opts.json !== false) headers['Content-Type'] = 'application/json'

  try {
    const token = await auth.currentUser?.getIdToken()
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* the 401 is a better message than a thrown click handler */ }

  const groqKey = getGroqKey()
  if (groqKey) headers['x-groq-key'] = groqKey
  const geminiKey = getGeminiKey()
  if (geminiKey) headers['x-gemini-key'] = geminiKey

  return headers
}
