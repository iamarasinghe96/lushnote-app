import { describe, it, expect } from 'vitest'
import {
  pickCaptureTemplate,
  actionBlocker,
  captureExcerpt,
  isTrackedPatient,
  INTENT_LABEL,
  TEMPLATE_REASON_LABEL,
  DEFAULT_TEMPLATE_ID,
} from '@/lib/captureFlow'
import { classifyCaptureIntent } from '@/lib/captureIntent'
import { suggestedActions } from '@/lib/suggestedActions'

const CONSULTATION = 'Hi, how are you today? I have been feeling low. Do you sleep well? Not really, no.'
const WARD_NOTE = '# Delirium - resolving\nUR: 4402219\nObs: afebrile\nPlan:\n1. Continue quetiapine\n2. TWOC in the morning'
const DICTATED_LETTER = 'Dear Dr Singh, thank you for seeing her. Kind regards.'

// The capture card runs the intermediate steps unattended and presents one tap.
// These tests pin the two things that makes safe: the doctor can SEE what the
// tap will do, and the tap that overwrites a record can be refused.

describe('pickCaptureTemplate', () => {
  it('uses the template the doctor last chose', () => {
    // Their own revealed preference is the only evidence that is about THIS
    // doctor. Nothing about pressing Record says which template.
    expect(pickCaptureTemplate(['42', '7', '1'])).toEqual({ id: '42', reason: 'recent' })
  })

  it('falls back to the default when there is no history', () => {
    expect(pickCaptureTemplate([])).toEqual({ id: DEFAULT_TEMPLATE_ID, reason: 'default' })
  })

  it('calls the default the default even when it is also the most recent', () => {
    // A first-time doctor has "1" written into their usage list by the picker.
    // Showing that back as "last used" would be technically true and useless.
    expect(pickCaptureTemplate([DEFAULT_TEMPLATE_ID])).toEqual({ id: DEFAULT_TEMPLATE_ID, reason: 'default' })
  })

  it('accepts the numeric ids the built-in templates actually carry', () => {
    // Built-ins are numeric, custom templates are `custom_<ts>` strings, and the
    // usage list holds whichever was last used.
    expect(pickCaptureTemplate([42])).toEqual({ id: '42', reason: 'recent' })
    expect(pickCaptureTemplate(['custom_1712345678'])).toEqual({ id: 'custom_1712345678', reason: 'recent' })
  })

  it('skips blank entries rather than generating on an empty id', () => {
    expect(pickCaptureTemplate(['', '  ', '9'])).toEqual({ id: '9', reason: 'recent' })
    expect(pickCaptureTemplate(['', '   '])).toEqual({ id: DEFAULT_TEMPLATE_ID, reason: 'default' })
  })

  it('has a label for every reason it can give', () => {
    for (const ids of [[], ['1'], ['42']]) {
      expect(TEMPLATE_REASON_LABEL[pickCaptureTemplate(ids).reason]).toBeTruthy()
    }
  })
})

describe('actionBlocker', () => {
  const captured = { transcript: 'A recording of a consultation.', patientName: '' }

  it('refuses the record write until a patient is named', () => {
    // The fidelity contract says a later entry SUPERSEDES tracked fields. With
    // no name that is either an invented profile or somebody else's record.
    expect(actionBlocker('patient-record', captured)).toBeTruthy()
    expect(actionBlocker('patient-record', { ...captured, patientName: 'Mrs Patel' })).toBeNull()
  })

  it('refuses the handover sheet too — its first act is the same write', () => {
    // Added with the action: gating on the two key names by hand is how the
    // second record-writing action would have slipped through unguarded.
    expect(actionBlocker('patient-pdf', captured)).toBeTruthy()
    expect(actionBlocker('patient-pdf', { ...captured, patientName: 'Mrs Patel' })).toBeNull()
  })

  it('lets everything that only makes a document run unnamed', () => {
    // The edit page already carries an unnamed note and its autosave no-ops
    // until a patient is named, so nothing is written until they supply one.
    for (const key of ['note', 'letter', 'discharge-summary', 'other'] as const) {
      expect(actionBlocker(key, captured)).toBeNull()
    }
  })

  it('blocks exactly the actions marked as overwriting', () => {
    // The two lists must not drift: an action the card marks "Replaces" but
    // does not gate would write an unnamed record, and one it gates without
    // marking would refuse for a reason the doctor cannot see.
    const named = { transcript: 'x', patientName: 'Mrs Patel' }
    for (const text of [CONSULTATION, WARD_NOTE, DICTATED_LETTER]) {
      for (const a of suggestedActions(classifyCaptureIntent(text, 'audio'))) {
        const blockedUnnamed = actionBlocker(a.key, { transcript: 'x', patientName: '' }) !== null
        expect(blockedUnnamed).toBe(a.overwritesRecord === true)
        expect(actionBlocker(a.key, named)).toBeNull()
      }
    }
  })

  it('treats a whitespace-only name as no name', () => {
    expect(actionBlocker('patient-record', { ...captured, patientName: '   ' })).toBeTruthy()
  })

  it('blocks everything when the capture produced nothing', () => {
    for (const key of ['note', 'patient-record', 'letter', 'other'] as const) {
      expect(actionBlocker(key, { transcript: '  ', patientName: 'Mrs Patel' })).toBeTruthy()
    }
  })

  it('never blocks the way out of a real capture', () => {
    // "Something else" is what a doctor reaches for when the guess is wrong. It
    // must not be gated on the guess having been right.
    expect(actionBlocker('other', { transcript: 'anything', patientName: '' })).toBeNull()
  })
})

describe('isTrackedPatient — the duplicate-profile guard', () => {
  // Found while wiring the card: savePatientProfile with no id calls addDoc, so
  // "create the profile" for somebody who already has one adds a SECOND card
  // holding a name and a DOB and nothing else, splitting their record in two.
  const profiles = [{ displayName: 'Mrs Patel' }, { displayName: 'John Smith' }]

  it('recognises a patient who already has a profile', () => {
    expect(isTrackedPatient('Mrs Patel', profiles)).toBe(true)
  })

  it('ignores case and surrounding space — a transcript supplies both', () => {
    expect(isTrackedPatient('  mrs patel ', profiles)).toBe(true)
    expect(isTrackedPatient('MRS PATEL', profiles)).toBe(true)
  })

  it('matches a stored name that itself carries stray space', () => {
    expect(isTrackedPatient('Mrs Patel', [{ displayName: ' Mrs Patel  ' }])).toBe(true)
  })

  it('says no for a patient nobody has tracked', () => {
    expect(isTrackedPatient('Ms Nguyen', profiles)).toBe(false)
  })

  it('never matches on an empty name', () => {
    // An empty needle against an empty-named profile would otherwise report a
    // match and suppress the profile the doctor is owed.
    expect(isTrackedPatient('', profiles)).toBe(false)
    expect(isTrackedPatient('   ', [{ displayName: '' }])).toBe(false)
  })

  it('says no when nothing is loaded yet', () => {
    expect(isTrackedPatient('Mrs Patel', [])).toBe(false)
  })
})

describe('the card can always describe itself', () => {
  it('has a label for every intent the classifier can return', () => {
    const texts = [
      'Hi, how are you? I have been feeling low. Do you sleep well? Not really.',
      'The patient was reviewed today. On examination he is settled.',
      'Dear Dr Singh, thank you for seeing her. Kind regards.',
      '# Delirium\nUR: 4402219\nPlan:\n1. Continue quetiapine',
    ]
    for (const t of texts) {
      expect(INTENT_LABEL[classifyCaptureIntent(t, 'audio').intent]).toBeTruthy()
    }
  })

  it('can name a blocker or nothing for every action it offers', () => {
    // A card that renders an action it has no verdict on would present a button
    // that does nothing when tapped.
    const c = classifyCaptureIntent('The patient was reviewed today.', 'audio')
    const review = { transcript: 'The patient was reviewed today.', patientName: '' }
    for (const a of suggestedActions(c)) {
      expect(actionBlocker(a.key, review)).not.toBeUndefined()
    }
  })
})

describe('captureExcerpt', () => {
  it('leaves a short capture alone', () => {
    expect(captureExcerpt('Short enough.')).toBe('Short enough.')
  })

  it('collapses the line breaks a transcript arrives with', () => {
    expect(captureExcerpt('One line.\n\nAnother   line.')).toBe('One line. Another line.')
  })

  it('cuts on a word boundary, not mid-word', () => {
    const out = captureExcerpt('alpha bravo charlie delta echo foxtrot golf hotel', 20)
    expect(out.endsWith('…')).toBe(true)
    // A hard slice would leave a fragment; every word before the ellipsis is whole.
    for (const w of out.replace('…', '').trim().split(' ')) {
      expect('alpha bravo charlie delta echo foxtrot golf hotel'.split(' ')).toContain(w)
    }
  })

  it('still truncates when there is no space to cut on', () => {
    const out = captureExcerpt('a'.repeat(200), 20)
    expect(out.length).toBeLessThanOrEqual(21)
    expect(out.endsWith('…')).toBe(true)
  })
})
