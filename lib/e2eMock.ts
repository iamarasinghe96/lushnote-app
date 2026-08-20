// Canned AI replies for the automated test suite.
//
// The end-to-end suite must be able to run a note from transcript to export on
// every pull request. Calling the real models there would be slow, would spend
// a doctor's daily Gemini quota, and would be flaky in the one place flakiness
// is most expensive — the check that decides whether a change reaches
// production. So on preview deployments only, the four AI routes answer from
// here instead.
//
// The payloads are shaped exactly like real ones, including the `[key]` section
// markers, so everything downstream — parseGeneratedContent, the typewriter,
// extraSections, autosave, the PDF and Word builders — runs for real. The only
// thing replaced is the model call.

/**
 * Double-locked, and deliberately so. The env var is scoped to Vercel's Preview
 * environment, and the runtime check refuses production regardless — a human
 * ticking the wrong box in the Vercel dashboard cannot serve a doctor a canned
 * note.
 */
export function aiMockEnabled(): boolean {
  return process.env.E2E_MOCK_AI === '1' && process.env.VERCEL_ENV !== 'production'
}

/** A generated note carrying the markers a template prompt asks the model for,
 *  so the client's section parser has something real to parse. */
export const MOCK_NOTE_CONTENT = `[presentation] Presenting Problem(s)
E2E smoke patient attended for review of low mood and disturbed sleep. Reports the past fortnight has been steadier than the one before.

[history] Background
Two prior episodes of depression, both responsive to treatment. No inpatient admissions.

[medications] Medications
1. Sertraline 100mg mane
2. Melatonin 2mg nocte

[mse] Mental State Examination
Appearance: neatly groomed, good eye contact.
Mood: "better than it was".
Affect: reactive, congruent.
Thought: no formal thought disorder.
Cognition: grossly intact.

[content] Session Content
Reviewed sleep hygiene and the graded activity plan agreed last session. Discussed the return-to-work timeline.

[risk] Risk Assessment
No current suicidal ideation, intent or plan. No thoughts of harm to others. Protective factors include stable housing and an engaged partner.

[nextsteps] Plan
1. Continue sertraline 100mg mane.
2. Review in four weeks.
3. Contact the clinic sooner if mood deteriorates.`

const MOCK_TRANSCRIPT = 'This is an automated test recording. The patient reports their mood has been steadier over the past fortnight and that sleep has improved with the current dose.'

const MOCK_LETTER_FIELDS = {
  salutation: 'Dear Dr Smith',
  reason: 'Referral for ongoing management of a depressive episode.',
  history: 'Two prior episodes, both treatment-responsive.',
  medications: 'Sertraline 100mg mane.',
  plan: 'Grateful for your review and ongoing management.',
}

const MOCK_PATIENT_FIELDS = {
  problems: '# Depression, recurrent\n# Insomnia',
  progress: 'Steadier over the past fortnight.',
  medications: 'Sertraline 100mg mane',
  plan: '1. Continue current dose\n2. Review in four weeks',
  otherTopics: '',
}

/**
 * The mock reply for a `/api/generate` request, or null when this mode has no
 * canned answer — in which case the route carries on to the real model rather
 * than inventing something. Shapes match the real returns exactly: the client
 * reads `content` for notes, `letterFields` for letters and so on, and a mock
 * that got that wrong would test nothing.
 */
export function mockGenerateResponse(mode: string | undefined, letterType?: string): Record<string, unknown> | null {
  if (mode === 'letter') {
    return {
      letterFields: letterType === 'custom'
        ? { sections: { background: 'Automated test content.', recommendations: 'Automated test content.' } }
        : MOCK_LETTER_FIELDS,
    }
  }
  if (mode === 'hospital-form') {
    return {
      formFields: {
        urNo: 'E2E0001',
        surname: 'Patient',
        givenNames: 'E2E Smoke',
        dob: '01/01/1980',
        sex: 'F',
        noteText: '**Progress**\nSteadier over the past fortnight.\n\n**Plan**\n1. Continue current dose\n2. Review in four weeks',
      },
    }
  }
  if (mode === 'patient-intake') {
    return { patientFields: MOCK_PATIENT_FIELDS }
  }
  return { content: MOCK_NOTE_CONTENT, provider: 'mock' }
}

export function mockTranscribeResponse(): Record<string, unknown> {
  return { text: MOCK_TRANSCRIPT, provider: 'mock' }
}

export function mockOcrResponse(): Record<string, unknown> {
  return {
    text: '# Depression, recurrent\nProgress: steadier.\nPlan:\n1. Continue current dose',
    patient: { name: 'E2E Smoke Patient', urNumber: 'E2E0001', dob: '01/01/1980', gender: 'female' },
  }
}

export function mockChatResponse(type: unknown): Record<string, unknown> {
  if (type === 'transcript-qa') {
    return {
      answer: 'The patient reports their mood has been steadier over the past fortnight.',
      quote: 'mood has been steadier over the past fortnight',
      found: true,
      inferred: false,
      provider: 'mock',
    }
  }
  return { answer: 'This is an automated test reply from the LushNote assistant.', provider: 'mock' }
}
