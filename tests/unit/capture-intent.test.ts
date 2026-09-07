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

describe('the discharge summary', () => {
  const DISCHARGE = `Mrs Patel was admitted on the third of March with a relapse of
psychotic depression. During this admission she was commenced on olanzapine and
titrated to ten milligrams nightly. She improved steadily over the fortnight.
On discharge she is euthymic with no active psychotic symptoms. Discharge
medications are olanzapine ten milligrams nocte and sertraline one hundred
milligrams mane. She will follow up with the GP in one week.`

  it('reads an admission being closed off as a discharge summary', () => {
    const c = classifyCaptureIntent(DISCHARGE, 'audio')
    expect(c.intent).toBe('discharge')
    expect(isConfidentIntent(c)).toBe(true)
  })

  it('leads with the discharge summary and keeps a note available', () => {
    // A doctor recapping a stay inside a progress note is not necessarily
    // discharging anybody today.
    const actions = suggestedActions(classifyCaptureIntent(DISCHARGE, 'audio'))
    expect(actions[0].key).toBe('discharge-summary')
    expect(actions[0].primary).toBe(true)
    expect(actions.map(a => a.key)).toContain('note')
  })

  it('needs two markers — a mentioned past admission is not a discharge', () => {
    // "she was discharged in March" inside a referral is history, not the
    // document being dictated.
    const referral = `Dear Dr Singh, thank you for seeing this patient. I am writing
to refer Mrs Patel for review of her ongoing low mood. She was discharged home
in March and has been stable since. Kind regards.`
    expect(classifyCaptureIntent(referral, 'audio').intent).toBe('dictated-letter')
  })

  it('outranks the letter envelope when it is both', () => {
    // Template 40 is literally "Discharge Summary - Letter to Referrer". When a
    // capture is both, the more specific answer is the useful one.
    const both = `Dear Dr Singh, this is a discharge summary for Mrs Patel who was
admitted on the third of March. On discharge she is well. Kind regards.`
    expect(classifyCaptureIntent(both, 'audio').intent).toBe('discharge')
  })

  it('does not outrank a photograph', () => {
    // A photographed page is a record being copied, whatever it says.
    expect(classifyCaptureIntent(DISCHARGE, 'photo').intent).toBe('ward-note')
  })

  it('says why it decided', () => {
    expect(classifyCaptureIntent(DISCHARGE, 'audio').signals.join(' ')).toMatch(/summarises an admission/i)
  })
})

describe('the handover sheet', () => {
  it('is offered on a ward note and nowhere else', () => {
    // Photographing a ward note and printing a handover sheet from it are the
    // two halves of one ward round. On a dictated consultation there is no
    // round to hand over.
    const ward = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio'))
    expect(ward.map(a => a.key)).toContain('patient-pdf')

    for (const text of [CONSULTATION, DICTATED_NOTE, DICTATED_LETTER]) {
      const keys = suggestedActions(classifyCaptureIntent(text, 'audio')).map(a => a.key)
      expect(keys).not.toContain('patient-pdf')
    }
  })

  it('is marked as overwriting, because its first act is a record write', () => {
    const action = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio')).find(a => a.key === 'patient-pdf')
    expect(isDestructive(action!)).toBe(true)
  })

  it('never leads — the plain record write does', () => {
    // Downloading a file is the bigger surprise of the two, so it does not get
    // to be the button a doctor presses without reading.
    const actions = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio'))
    expect(actions[0].key).toBe('patient-record')
    expect(actions.find(a => a.key === 'patient-pdf')!.primary).toBe(false)
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

describe('the campus hospital form', () => {
  // "Hospital form is equal to AWH progress note template" — the doctor's own
  // paperwork, offered on the card when their active workplace has one.
  const AWH = { hospitalFormName: 'AWH Progress Note FAW0004' }

  it('is not offered at a workplace with no form, which is most of them', () => {
    for (const text of [CONSULTATION, DICTATED_NOTE, WARD_NOTE]) {
      const keys = suggestedActions(classifyCaptureIntent(text, 'audio')).map(a => a.key)
      expect(keys).not.toContain('hospital-form')
    }
  })

  it('is offered on every note-producing capture when the campus has one', () => {
    for (const text of [CONSULTATION, DICTATED_NOTE, WARD_NOTE]) {
      const keys = suggestedActions(classifyCaptureIntent(text, 'audio'), AWH).map(a => a.key)
      expect(keys).toContain('hospital-form')
    }
  })

  it('carries the form’s real name, not a generic label', () => {
    // A doctor knows their form by what it is called. "Hospital form" would
    // make one campus's paperwork look like a feature of the app.
    const action = suggestedActions(classifyCaptureIntent(DICTATED_NOTE, 'audio'), AWH)
      .find(a => a.key === 'hospital-form')
    expect(action!.label).toBe('AWH Progress Note FAW0004')
  })

  it('never leads', () => {
    // Whether an entry belongs on the hospital's paper form or in LushNote's
    // record is a decision about where the note will live — not something the
    // classifier can read out of the words.
    for (const text of [CONSULTATION, DICTATED_NOTE, WARD_NOTE]) {
      const actions = suggestedActions(classifyCaptureIntent(text, 'audio'), AWH)
      expect(actions.find(a => a.key === 'hospital-form')!.primary).toBe(false)
      expect(actions.filter(a => a.primary).length).toBeLessThanOrEqual(1)
    }
  })

  it('is not offered on a letter — a letter is not a progress note', () => {
    const keys = suggestedActions(classifyCaptureIntent(DICTATED_LETTER, 'audio'), AWH).map(a => a.key)
    expect(keys).not.toContain('hospital-form')
  })

  it('does not disturb what leads on any pathway', () => {
    // Adding an option must not change the answer the card was already giving.
    for (const text of [CONSULTATION, DICTATED_NOTE, DICTATED_LETTER, WARD_NOTE]) {
      const without = suggestedActions(classifyCaptureIntent(text, 'audio'))
      const with_ = suggestedActions(classifyCaptureIntent(text, 'audio'), AWH)
      expect(with_[0].key).toBe(without[0].key)
      expect(with_[with_.length - 1].key).toBe('other')
    }
  })

  it('writes no record, so it is never marked or blocked', () => {
    const action = suggestedActions(classifyCaptureIntent(WARD_NOTE, 'audio'), AWH)
      .find(a => a.key === 'hospital-form')!
    expect(isDestructive(action)).toBe(false)
  })
})
