import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { aiMockEnabled, mockForCaller, mockGenerateResponse, MOCK_NOTE_CONTENT } from '@/lib/e2eMock'

// The only thing that matters about this module is that it can never fire in
// production. A doctor served a canned note would have a fabricated clinical
// record with no sign anything went wrong.

describe('aiMockEnabled', () => {
  const saved = { flag: process.env.E2E_MOCK_AI, env: process.env.VERCEL_ENV }

  beforeEach(() => {
    delete process.env.E2E_MOCK_AI
    delete process.env.VERCEL_ENV
  })
  afterEach(() => {
    if (saved.flag === undefined) delete process.env.E2E_MOCK_AI; else process.env.E2E_MOCK_AI = saved.flag
    if (saved.env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved.env
  })

  it('is off when nothing is set — the state every real deployment is in', () => {
    expect(aiMockEnabled()).toBe(false)
  })

  it('is off in production even if the flag is set', () => {
    // The second lock: a human ticking "Production" on the Vercel env var
    // still cannot serve a doctor a canned note.
    process.env.E2E_MOCK_AI = '1'
    process.env.VERCEL_ENV = 'production'
    expect(aiMockEnabled()).toBe(false)
  })

  it('is on for a preview deployment with the flag set', () => {
    process.env.E2E_MOCK_AI = '1'
    process.env.VERCEL_ENV = 'preview'
    expect(aiMockEnabled()).toBe(true)
  })

  it('needs the exact flag value, not merely a truthy one', () => {
    process.env.VERCEL_ENV = 'preview'
    for (const v of ['true', 'yes', '0', '']) {
      process.env.E2E_MOCK_AI = v
      expect(aiMockEnabled()).toBe(false)
    }
  })
})

describe('mockGenerateResponse', () => {
  it('returns note content carrying the section markers the parser reads', () => {
    const r = mockGenerateResponse(undefined) as { content: string }
    expect(r.content).toBe(MOCK_NOTE_CONTENT)
    for (const key of ['presentation', 'history', 'medications', 'mse', 'content', 'risk', 'nextsteps']) {
      expect(r.content).toContain(`[${key}]`)
    }
  })

  it('answers each mode in the shape that mode client actually reads', () => {
    expect(mockGenerateResponse('letter', 'referral')).toHaveProperty('letterFields')
    expect(mockGenerateResponse('letter', 'custom')).toHaveProperty('letterFields.sections')
    expect(mockGenerateResponse('hospital-form')).toHaveProperty('formFields.noteText')
    expect(mockGenerateResponse('patient-intake')).toHaveProperty('patientFields')
  })
})

describe('mockForCaller', () => {
  const saved = { flag: process.env.E2E_MOCK_AI, env: process.env.VERCEL_ENV }
  beforeEach(() => { process.env.E2E_MOCK_AI = '1'; process.env.VERCEL_ENV = 'preview' })
  afterEach(() => {
    if (saved.flag === undefined) delete process.env.E2E_MOCK_AI; else process.env.E2E_MOCK_AI = saved.flag
    if (saved.env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = saved.env
  })

  it('mocks for the test fixture', () => {
    expect(mockForCaller({ e2eFixture: true })).toBe(true)
  })

  it('does NOT mock for a real doctor on the same preview', () => {
    // The bug this prevents: the owner reviewing a change on staging pasted a
    // ward note and got "Sertraline 100mg mane" back — canned data, because the
    // deployment was mocking everyone. Staging has to behave like the real
    // thing for a real person, or it cannot be used to judge a release.
    expect(mockForCaller({})).toBe(false)
    expect(mockForCaller({ e2eFixture: false })).toBe(false)
  })

  it('fails toward the REAL model when the profile is unreadable', () => {
    // A wasted API call is honest; silently showing fabricated clinical content
    // to someone evaluating a release is not.
    expect(mockForCaller(null)).toBe(false)
    expect(mockForCaller(undefined)).toBe(false)
  })

  it('never mocks in production, fixture or not', () => {
    process.env.VERCEL_ENV = 'production'
    expect(mockForCaller({ e2eFixture: true })).toBe(false)
  })
})
