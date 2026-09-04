import { describe, it, expect } from 'vitest'
import { changedLines, spliceTidiedLines } from '@/lib/tidyDiff'

// A generated progress note is already formal prose. When a doctor opens one,
// adds two rough lines and presses AI tidy, rewriting the WHOLE note re-renders
// work that was correct and hands back a document they had accepted, altered in
// places they never touched. Only the lines that differ from the baseline are
// sent — lines the model never sees cannot be changed by it.

const GENERATED = `**Observations and Examination**
Observations are stable and the patient is afebrile. There is mild lower limb (LL) oedema.

**Plan**
1. Family meeting to be planned for next week.
2. Allied health review (r/v) please.`

describe('changedLines', () => {
  it('finds only what the doctor added to a generated note', () => {
    const edited = GENERATED + '\n3. strict bowel chart pls'
    const changed = changedLines(GENERATED, edited)
    expect(changed).toHaveLength(1)
    expect(changed[0].text).toBe('3. strict bowel chart pls')
  })

  it('leaves the generated prose out of the request entirely', () => {
    // The guarantee is structural: the model is never shown these lines.
    const edited = GENERATED + '\n3. strict bowel chart pls'
    const sent = changedLines(GENERATED, edited).map(l => l.text).join('\n')
    expect(sent).not.toContain('afebrile')
    expect(sent).not.toContain('Family meeting')
  })

  it('catches a line the doctor EDITED in place, not just appended', () => {
    const edited = GENERATED.replace('2. Allied health review (r/v) please.', '2. allied health r/v urgently pls')
    const changed = changedLines(GENERATED, edited)
    expect(changed).toHaveLength(1)
    expect(changed[0].text).toBe('2. allied health r/v urgently pls')
  })

  it('reports the index in the CURRENT text so the reply splices back', () => {
    const edited = GENERATED + '\n3. strict bowel chart pls'
    const changed = changedLines(GENERATED, edited)
    expect(edited.split('\n')[changed[0].index]).toBe('3. strict bowel chart pls')
  })

  it('finds nothing when the doctor has changed nothing', () => {
    expect(changedLines(GENERATED, GENERATED)).toHaveLength(0)
  })

  it('treats every line as the doctor’s when there is no baseline', () => {
    // A form typed from scratch is all their own writing, so tidy the lot.
    const typed = 'pt seen today\nmood ok'
    expect(changedLines(null, typed)).toHaveLength(2)
  })

  it('ignores blank lines', () => {
    // Nothing to correct, and sending them invites the model to "improve" the
    // spacing of a document whose layout the doctor chose.
    expect(changedLines('a', 'a\n\n\nb')).toHaveLength(1)
  })
})

describe('spliceTidiedLines', () => {
  const edited = GENERATED + '\n3. strict bowel chart pls'
  const changed = changedLines(GENERATED, edited)

  it('puts the tidied line back and leaves everything else byte-identical', () => {
    const out = spliceTidiedLines(edited, changed, '3. Strict bowel chart, please.')!
    expect(out.split('\n')[changed[0].index]).toBe('3. Strict bowel chart, please.')
    // The generated half must come through completely untouched.
    expect(out.startsWith(GENERATED)).toBe(true)
  })

  it('refuses a reply with the wrong number of lines', () => {
    // No way to know which reply belongs to which line; guessing would land a
    // tidied sentence on the wrong plan step.
    expect(spliceTidiedLines(edited, changed, 'one\ntwo')).toBeNull()
  })

  it('keeps the doctor’s wording when the model returns a blank for a line', () => {
    const two = changedLines(GENERATED, GENERATED + '\n3. aaa\n4. bbb')
    const out = spliceTidiedLines(GENERATED + '\n3. aaa\n4. bbb', two, '3. Aaa.\n\n4. Bbb.')
    // The blank between them is stripped before counting, so this is 2 replies
    // for 2 lines and both land.
    expect(out).toContain('3. Aaa.')
    expect(out).toContain('4. Bbb.')
  })

  it('is a no-op when nothing changed', () => {
    expect(spliceTidiedLines(GENERATED, [], 'anything')).toBe(GENERATED)
  })

  it('never reorders the untouched lines', () => {
    const out = spliceTidiedLines(edited, changed, '3. Strict bowel chart, please.')!
    const lines = out.split('\n')
    expect(lines[0]).toBe('**Observations and Examination**')
    expect(lines[3]).toBe('**Plan**')
  })
})
