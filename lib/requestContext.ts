// One id per incoming request, readable from anywhere inside it.
//
// A single click by a doctor can produce several log lines from different
// places — Groq refused, then Gemini refused, then the route gave up — and
// until now the only way to tell they belonged together was to compare
// timestamps and hope no one else was working at the same second. That guesswork
// is what made the last few faults slow to read.
//
// AsyncLocalStorage carries the id down the call stack instead of threading a
// parameter through every function that might log. Node's async context is
// per-request by construction, so two doctors generating at once cannot see each
// other's. Requires the Node runtime; nothing here runs on edge.

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  route: string
  /** What the caller asked for — 'patient-intake', 'letter', 'note' … */
  mode?: string
  uid?: string
  startedAt: number
}

const store = new AsyncLocalStorage<RequestContext>()

// Short by design: an admin reads this off a screenshot and types it into a
// search box, so eight hex characters beats a full UUID. Collisions only matter
// within the log-retention window, where eight characters is ample.
function newRequestId(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  } catch {
    return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  }
}

export function currentRequest(): RequestContext | undefined {
  return store.getStore()
}

/** Fill in what was not known when the request started — the mode it turned out
 *  to be, the uid once the body is parsed. */
export function noteRequest(patch: Partial<RequestContext>): void {
  const ctx = store.getStore()
  if (ctx) Object.assign(ctx, patch)
}

export function elapsedMs(): number | undefined {
  const ctx = store.getStore()
  return ctx ? Date.now() - ctx.startedAt : undefined
}

/** Wrap a route handler so everything it does shares one id. */
export function withRequest<T>(route: string, fn: (ctx: RequestContext) => Promise<T>): Promise<T> {
  const ctx: RequestContext = { requestId: newRequestId(), route, startedAt: Date.now() }
  return store.run(ctx, () => fn(ctx))
}
