import { describe, it, expect } from 'vitest'
import { classifyPastedText, isConfidentWardNote, CONFIDENT } from '@/lib/pastedText'

// This decides whether a paste writes a NOTE or rewrites a PATIENT RECORD.
// Getting it wrong toward ward-note is the expensive direction: the record path
// supersedes tracked fields, while a wrongly-generated note is just discarded.
// The bias is asserted explicitly at the bottom.

const WARD_NOTE = `Ward round 21/08
# Depression, recurrent - active
# Insomnia
# Hypertension - stable

Current Issues
Mood low but improving. Sleeping 5-6 hours.

Obs
BP 138/84, HR 72, afebrile

Impression
Depressive episode, partial response.

Plan
1. Continue sertraline 100mg mane
2. Review in four weeks
3. Bloods - FBC, UEC
4. Cease if no improvement by review`

// The consultation from the app's own paste screen.
const TRANSCRIPT = `Hi Cara. Um, I understand that you're here today because you've been
experiencing some low mood? Yeah, I just um recently I've just I'm just feeling down a lot
and I can't really like snap out of it. Okay, and how long has that been going on for?
Um, maybe two months? I think it started after work got really busy. Right, and are you
sleeping okay? Not really, I wake up a lot. Do you know what wakes you? I mean, I just
sort of lie there thinking. Okay. And what about your appetite, has that changed at all?
Yeah I guess I'm eating less. You know, I just don't feel hungry.`

describe('classifyPastedText — ward notes', () => {
  it('recognises a ward round', () => {
    const c = classifyPastedText(WARD_NOTE)
    expect(c.kind).toBe('ward-note')
    expect(c.confidence).toBeGreaterThan(CONFIDENT)
  })

  it('explains itself', () => {
    // "Why did it think that" is the first question when it is wrong.
    const c = classifyPastedText(WARD_NOTE)
    expect(c.signals.join(' ')).toMatch(/problem-list|headings/)
  })

  it('recognises a problem list on its own', () => {
    expect(classifyPastedText('# Depression\n# Insomnia\n# CKD stage 3').kind).toBe('ward-note')
  })

  it('recognises headings without a problem list', () => {
    expect(classifyPastedText(`Progress
Settled overnight.

Plan
1. Continue current dose
2. Review Monday
3. Discharge planning`).kind).toBe('ward-note')
  })
})

describe('classifyPastedText — transcripts', () => {
  it('recognises a consultation', () => {
    const c = classifyPastedText(TRANSCRIPT)
    expect(c.kind).toBe('transcript')
    expect(c.confidence).toBeGreaterThan(CONFIDENT)
  })

  it('recognises one long unbroken block from a transcription service', () => {
    const c = classifyPastedText('The patient reports their mood has been steadier. '.repeat(20))
    expect(c.kind).toBe('transcript')
  })

  it('is not fooled by a transcript that mentions a plan', () => {
    // Clinical words appear in speech too; only the SHAPE separates them.
    const c = classifyPastedText(`${TRANSCRIPT} So the plan is to continue the medication and review you in a month, does that sound okay to you?`)
    expect(c.kind).toBe('transcript')
  })
})

describe('the bias when it cannot tell', () => {
  it('treats empty text as a transcript, which changes nothing', () => {
    const c = classifyPastedText('')
    expect(c.kind).toBe('transcript')
    expect(c.confidence).toBe(0)
  })

  it.each(['   \n  \n ', 'Some notes.', 'Reviewed today. Doing well.'])(
    'treats featureless text (%j) as a transcript', text => {
      // Today's behaviour, so an uncertain call is a no-op rather than a
      // surprise — and it keeps the cost of being wrong recoverable.
      expect(classifyPastedText(text).kind).toBe('transcript')
    })

  it('needs a clear majority before calling something a ward note', () => {
    // A tie is NOT a ward note. Pinned because flipping this comparison would
    // silently route ambiguous pastes at a patient record.
    const mixed = `# Depression
Hi there, um, how have you been feeling? Yeah I mean, not great, you know?
Have you been sleeping? I sort of wake up a lot.`
    expect(classifyPastedText(mixed).kind).toBe('transcript')
  })
})

describe('isConfidentWardNote', () => {
  it('is true only for a ward note the classifier is sure about', () => {
    expect(isConfidentWardNote(classifyPastedText(WARD_NOTE))).toBe(true)
  })

  it('is false for every transcript, however confident', () => {
    expect(isConfidentWardNote(classifyPastedText(TRANSCRIPT))).toBe(false)
    expect(isConfidentWardNote(classifyPastedText(''))).toBe(false)
  })

  it('is false for a borderline ward note', () => {
    // The UI keeps its default wording rather than announcing a guess.
    const c = { kind: 'ward-note' as const, confidence: 0.1, signals: [] }
    expect(isConfidentWardNote(c)).toBe(false)
  })
})
