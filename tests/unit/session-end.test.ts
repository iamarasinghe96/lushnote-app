import { describe, expect, it } from 'vitest'
import {
  hasClosingPhrase, evaluateSessionEnd, sessionEndReducer,
  MIN_SESSION_MS, SILENCE_MS,
  type SessionEndInput, type SessionEndState,
} from '@/lib/sessionEnd'

// This feature stops a live consultation recording. Every test below is a way
// it could stop one it should not have, or fail to stop one it should.

describe('hasClosingPhrase', () => {
  it.each([
    'Alright, goodbye.',
    'OK then, good bye!',
    'Good-bye.',
    'Right, take care.',
    'Take care of yourself.',
    'See you next time.',
    'See you in four weeks, then see you.',
    'Thanks for coming in.',
    'Thank you for coming.',
    'Have a good week.',
    "That's all for today.",
    "We'll leave it there.",
    'All the best.',
    'Look after yourself.',
  ])('hears %j as a closing', text => {
    expect(hasClosingPhrase(text)).toBe(true)
  })

  it('does not care about case, punctuation or spacing', () => {
    expect(hasClosingPhrase('   GOODBYE!!!   ')).toBe(true)
    expect(hasClosingPhrase('...take   CARE...')).toBe(true)
  })

  // The failure that would be most alarming: a patient describing a farewell.
  it.each([
    'She said goodbye to her mother and has not spoken to her since.',
    'He told me to take care of myself, which I found patronising.',
    'My sister asked me to say goodbye for her.',
    'He wrote goodbye on a note and left.',
  ])('does not hear reported speech: %j', text => {
    expect(hasClosingPhrase(text)).toBe(false)
  })

  // A closing has to be AT the end. Mid-segment it is part of the story.
  it('ignores a closing that is not at the end', () => {
    expect(hasClosingPhrase(
      'We talked about goodbye and endings, and then moved on to her sleep, appetite and mood over the past fortnight.',
    )).toBe(false)
  })

  it('has an answer for nothing at all', () => {
    expect(hasClosingPhrase('')).toBe(false)
    expect(hasClosingPhrase('   ')).toBe(false)
    expect(hasClosingPhrase('...')).toBe(false)
  })
})

describe('evaluateSessionEnd', () => {
  const NOW = 1_700_000_000_000
  const SEG_AT = NOW - 30_000

  function input(over: Partial<SessionEndInput> = {}): SessionEndInput {
    return {
      enabled: true,
      mode: 'conversation',
      sessionMs: MIN_SESSION_MS + 60_000,
      segment: { text: 'Right, take care.', at: SEG_AT },
      lastSpeechAt: SEG_AT - 1_000,
      silenceMs: SILENCE_MS + 5_000,
      micLost: false,
      ...over,
    }
  }

  it('raises a candidate when every signal agrees', () => {
    expect(evaluateSessionEnd(input())).toBe('possible-end')
  })

  // Requirement one: a phrase on its own never stops a recording.
  it('will not act on a phrase without the silence', () => {
    expect(evaluateSessionEnd(input({ silenceMs: 3_000 }))).toBe('listening')
  })

  it('will not act on silence without a phrase', () => {
    expect(evaluateSessionEnd(input({
      segment: { text: 'and the sleep has been much better this fortnight', at: SEG_AT },
    }))).toBe('listening')
  })

  // The stale candidate: they said goodbye, then carried on talking.
  it('will not act on a candidate that newer speech has overtaken', () => {
    expect(evaluateSessionEnd(input({ lastSpeechAt: SEG_AT + 1_000 }))).toBe('listening')
  })

  it('will not act before the session has run long enough', () => {
    expect(evaluateSessionEnd(input({ sessionMs: MIN_SESSION_MS - 1 }))).toBe('listening')
  })

  // A mic taken by a phone call reads as perfect silence. It is not a goodbye.
  it('treats an interrupted microphone as a reason to keep recording', () => {
    expect(evaluateSessionEnd(input({ micLost: true }))).toBe('listening')
  })

  // Fail open: no voice activity detection, no automatic stop, ever.
  it('keeps recording when voice activity detection is not reporting', () => {
    expect(evaluateSessionEnd(input({ lastSpeechAt: null }))).toBe('listening')
  })

  // Transcription failing means no segment arrives. Silence alone is not enough.
  it('keeps recording when no segment has come back', () => {
    expect(evaluateSessionEnd(input({ segment: null }))).toBe('listening')
  })

  it('never runs for dictation', () => {
    expect(evaluateSessionEnd(input({ mode: 'dictation' }))).toBe('listening')
  })

  it('never runs when the doctor has turned it off', () => {
    expect(evaluateSessionEnd(input({ enabled: false }))).toBe('listening')
  })
})

describe('sessionEndReducer', () => {
  const run = (from: SessionEndState, ...events: Parameters<typeof sessionEndReducer>[1][]) =>
    events.reduce(sessionEndReducer, from)

  it('walks listening to stopping the long way round', () => {
    expect(run('LISTENING', { type: 'CANDIDATE' })).toBe('POSSIBLE_END')
    expect(run('LISTENING', { type: 'CANDIDATE' }, { type: 'ARM_COUNTDOWN' })).toBe('COUNTDOWN')
    expect(run('LISTENING', { type: 'CANDIDATE' }, { type: 'ARM_COUNTDOWN' }, { type: 'COUNTDOWN_ELAPSED' }))
      .toBe('STOPPING')
  })

  it('returns to listening the moment anyone speaks', () => {
    expect(run('COUNTDOWN', { type: 'SPEECH' })).toBe('LISTENING')
    expect(run('POSSIBLE_END', { type: 'SPEECH' })).toBe('LISTENING')
  })

  it('returns to listening when the doctor says to keep going', () => {
    expect(run('COUNTDOWN', { type: 'KEEP_RECORDING' })).toBe('LISTENING')
  })

  it('cannot elapse a countdown that speech already cancelled', () => {
    expect(run('COUNTDOWN', { type: 'SPEECH' }, { type: 'COUNTDOWN_ELAPSED' })).toBe('LISTENING')
  })

  // The race the brief asks about: manual Stop, the fixed-duration auto-stop and
  // this one can all arrive at once. Whichever lands first moves the machine and
  // the rest change nothing, so stop() is called once.
  it('absorbs every later event once it is stopping', () => {
    const stopped = run('COUNTDOWN', { type: 'STOP' })
    expect(stopped).toBe('STOPPING')
    expect(run(stopped, { type: 'STOP' })).toBe('STOPPING')
    expect(run(stopped, { type: 'COUNTDOWN_ELAPSED' })).toBe('STOPPING')
    expect(run(stopped, { type: 'SPEECH' })).toBe('STOPPING')
    expect(run(stopped, { type: 'KEEP_RECORDING' })).toBe('STOPPING')
    expect(run(stopped, { type: 'CANDIDATE' })).toBe('STOPPING')
  })

  it('lets a manual stop win from anywhere', () => {
    expect(run('LISTENING', { type: 'STOP' })).toBe('STOPPING')
    expect(run('POSSIBLE_END', { type: 'STOP' })).toBe('STOPPING')
  })
})
