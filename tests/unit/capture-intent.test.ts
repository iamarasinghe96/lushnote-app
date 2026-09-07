import { describe, it, expect } from 'vitest'
import { classifyCaptureIntent, isConfidentIntent } from '@/lib/captureIntent'
import { suggestedActions, isDestructive } from '@/lib/suggestedActions'

// The capture button records and then decides, unaided, what the doctor meant —
// that is the whole feature. Getting it wrong is not equally costly in every
// direction: offering a note wastes a tap, offering the patient record offers to
// overwrite tracked fields. Everything below is biased accordingly.

const CONSULTATION = `Hi Lacey, how are you doing today? Yeah, not too bad I guess.
Okay. So how did that exam period go for you in the end? Not very well.
I've been feeling worse since then, and I've just been beating myself up about it.
Mhm. And do you feel you should always do your best? Probably, yeah.
My parents have always taught me that. Okay. So when you don't do that, what happens?
I don't know. It annoys me a lot and I worry that it annoys them.`

const DICTATED_NOTE = `The patient was reviewed today on the ward round.
The patient reports his mood has been steadier over the past fortnight.
On examination he is settled, no agitation. He denies suicidal ideation.
Mental state examination shows reactive affect. Past medical history is unremarkable.
Continue sertraline one hundred milligrams and review in four weeks.`

const DICTATED_LETTER = `Dear Dr Singh, thank you for seeing this patient.
I am writing to refer Mrs Patel, a fifty two year old woman, for assessment of
her ongoing low mood. The patient reports six months of poor sleep and appetite.
I would be grateful for your opinion. Kind regards.`

const WARD_NOTE = `# Delirium - resolving
# Hypokalaemia
UR: 4402219  DOB: 12/12/1948  Ward: 4B  Bed: 12
Obs: afebrile, stable
Impression: improving
Plan:
1. Continue quetiapine
2. TWOC in the morning
3. Repeat bloods Friday`

describe('classifyCaptureIntent — the four things that arrive', () => {
  it('reads a two-way session as a consultation', () => {
    const c = classifyCaptureIntent(CONSULTATION, 'audio')
    expect(c.intent).toBe('consultation')
    expect(isConfidentIntent(c)).toBe(true)
  })

  it('reads a doctor narrating about a patient as a dictated note', () => {
    const c = classifyCaptureIntent(DICTATED_NOTE, 'audio')
    expect(c.intent).toBe('dictated-note')
  })

  it('reads a salutation and sign-off as a dictated letter', () => {
    const c = classifyCaptureIntent(DICTATED_LETTER, 'audio')
    expect(c.intent).toBe('dictated-letter')
  })

  it('reads a record read aloud as a ward note, not a monologue', () => {
    // Structure outranks voice: this IS a monologue, but it is a record being
    // copied, and that is the more useful answer.
    const c = classifyCaptureIntent(WARD_NOTE, 'audio')
    expect(c.intent).toBe('ward-note')
  })
})

describe('classifyCaptureIntent — evidence the text does not carry', () => {
  it('treats any photograph as a record, whatever it says', () => {
    // A doctor does not photograph a conversation. Pointing a camera at a page
    // is a stated intention, and no voice signal should outweigh it — the same
    // reasoning as resolvePastedKind for scans.
    const c = classifyCaptureIntent(CONSULTATION, 'photo')
    expect(c.intent).toBe('ward-note')
    expect(c.confidence).toBe(1)
  })
})

describe('classifyCaptureIntent — the bias when it cannot tell', () => {
  it('falls to consultation on a tie', () => {
    // The consultation action generates a note, which is discardable. The other
    // directions offer to overwrite a record or address a third party.
    const c = classifyCaptureIntent('Some words with no particular shape at all.', 'audio')
    expect(c.intent).toBe('consultation')
  })

  it('reports no confidence for empty input rather than guessing', () => {
    const c = classifyCaptureIntent('', 'audio')
    expect(c.confidence).toBe(0)
    expect(c.signals).toContain('empty')
  })

  it('says why it decided', () => {
    // "Why did it think that" is the first question asked when it is wrong.
    expect(classifyCaptureIntent(CONSULTATION, 'audio').signals.length).toBeGreaterThan(0)
    expect(classifyCaptureIntent(DICTATED_LETTER, 'audio').signals.join(' ')).toMatch(/addressed as a letter/i)
  })

  it('does not call a plain dictated note a letter', () => {
    // Third-person narration and dictation cues describe a NOTE. Offering a
    // letter here would drop the doctor into the wrong editor.
    expect(classifyCaptureIntent(DICTATED_NOTE, 'audio').intent).not.toBe('dictated-letter')
  })
})

describe('suggestedActions', () => {
  it('leads a consultation with the note', () => {
    const actions = suggestedActions(classifyCaptureIntent(CONSULTATION, 'audio'))
    expect(actions[0].key).toBe('note')
    expect(actions[0].primary).toBe(true)
  })

  it('leads a ward note with the patient record, not a note', () => {
    // Generating a note from a record produces a worse copy of a document that
    // already exists — the reason the paste classifier was built.
    const actions = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio'))
    expect(actions[0].key).toBe('patient-record')
    expect(actions[0].primary).toBe(true)
  })

  it('leads a dictated letter with the letter', () => {
    const actions = suggestedActions(classifyCaptureIntent(DICTATED_LETTER, 'audio'))
    expect(actions[0].key).toBe('letter')
  })

  it('always offers a way out', () => {
    // The classifier will be wrong sometimes. A doctor must never be stuck with
    // a card offering only the wrong thing.
    for (const text of [CONSULTATION, DICTATED_NOTE, DICTATED_LETTER, WARD_NOTE, '']) {
      const actions = suggestedActions(classifyCaptureIntent(text, 'audio'))
      expect(actions[actions.length - 1].key).toBe('other')
    }
  })

  it('leads with nothing when it is not confident', () => {
    // Present the choices; do not assert a guess it cannot support.
    const actions = suggestedActions({ intent: 'consultation', confidence: 0.1, signals: [] })
    expect(actions.some(a => a.primary)).toBe(false)
  })

  it('has exactly one primary when it IS confident', () => {
    const actions = suggestedActions(classifyCaptureIntent(CONSULTATION, 'audio'))
    expect(actions.filter(a => a.primary)).toHaveLength(1)
  })

  it('marks the record write as destructive and the note as not', () => {
    // The card shows the difference between "make me a document" and "change
    // the record" at the one moment it is being decided.
    const actions = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio'))
    expect(isDestructive(actions.find(a => a.key === 'patient-record')!)).toBe(true)
    expect(isDestructive(actions.find(a => a.key === 'note')!)).toBe(false)
  })

  it('never offers the record without marking it, on any pathway', () => {
    for (const text of [CONSULTATION, DICTATED_NOTE, WARD_NOTE]) {
      const record = suggestedActions(classifyCaptureIntent(text, 'audio')).find(a => a.key === 'patient-record')
      if (record) expect(isDestructive(record)).toBe(true)
    }
  })
})

describe('the letter envelope', () => {
  // Added after the first run: "thank you for seeing" and "your opinion" scored
  // as someone being addressed IN THE ROOM, so a referral letter classified as
  // a consultation. Second-person pronouns cannot separate the two — a letter is
  // full of them by definition. The envelope can.
  it('identifies a letter by its salutation and sign-off, not its pronouns', () => {
    const pronounHeavy = 'Dear Dr Singh, thank you for seeing her. Kind regards.'
    expect(classifyCaptureIntent(pronounHeavy, 'audio').intent).toBe('dictated-letter')
  })

  it('needs two markers — one is not an envelope', () => {
    // "many thanks" or a stray "re:" turns up inside plenty of spoken notes and
    // must not on its own send the doctor into the letter editor.
    const stray = `The patient was reviewed today. The patient reports better sleep.
On examination he is settled. Many thanks.`
    expect(classifyCaptureIntent(stray, 'audio').intent).not.toBe('dictated-letter')
  })
})
