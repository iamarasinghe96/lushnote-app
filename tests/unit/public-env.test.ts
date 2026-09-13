import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// NEXT_PUBLIC_ is not a naming convention. It instructs Next to INLINE the
// value into the JavaScript every visitor downloads, so a secret carrying that
// prefix is published to anyone who opens the page source.
//
// Two of ours are public on purpose - a Firebase web config and a Stripe
// publishable key are both designed to be seen. Everything else must not be.
// This is the mistake that would be easiest to make and hardest to notice: the
// app keeps working perfectly while the key is readable by the world.

const ROOTS = ['app', 'components', 'hooks', 'lib', 'scripts']

/** Named individually. A pattern would let the next one through. */
const PUBLIC_ON_PURPOSE = new Set([
  'NEXT_PUBLIC_FIREBASE_API_KEY',        // Firebase web config; public by design
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',  // Stripe's own name for it is "publishable"
])

const SECRET_WORDS = /KEY|SECRET|TOKEN|PASS/

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|mjs|js)$/.test(p)) out.push(relative(process.cwd(), p))
    }
  }
  ROOTS.forEach(walk)
  return out
}

describe('no server secret carries the NEXT_PUBLIC_ prefix', () => {
  it('finds none in the codebase', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8')
      for (const m of Array.from(src.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g))) {
        const name = m[0]
        if (PUBLIC_ON_PURPOSE.has(name)) continue
        if (SECRET_WORDS.test(name)) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${file}:${line}  ${name}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  // The Pro tier's whole point is that LushNote pays for the AI. A published
  // key would mean anyone could spend that budget.
  it('keeps the paid AI keys server-side', () => {
    for (const name of ['LUSHNOTE_GEMINI_PRO_KEY', 'LUSHNOTE_GROQ_KEY', 'GEMINI_API_KEY']) {
      expect(PUBLIC_ON_PURPOSE.has(`NEXT_PUBLIC_${name}`)).toBe(false)
    }
  })

  it('allows exactly the two that are public by design', () => {
    expect(Array.from(PUBLIC_ON_PURPOSE).sort()).toEqual([
      'NEXT_PUBLIC_FIREBASE_API_KEY',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ])
  })
})
