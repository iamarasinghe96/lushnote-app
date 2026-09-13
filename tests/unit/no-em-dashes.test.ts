import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { scanForDashes, PROMPT_FILES } from '../../scripts/dashScan.mjs'

// Em dashes read as machine-written, which is the whole reason for the rule.
// It has been broken twice by merged work, because until now nothing checked it:
// the repo has no lint step and no git hooks, so the rule held only while the
// person or agent writing the copy happened to remember it.
//
// A grep cannot enforce it. The rule deliberately exempts code comments, AI
// prompt text (rewording a prompt changes what the model returns), Slack
// messages, and regex character classes - TimePicker's [–-] must keep accepting
// BOTH characters or every session time saved before the rule stops parsing.
// scripts/dashScan.mjs tracks string, comment and regex state so it can tell the
// difference.

const ROOTS = ['app', 'components', 'hooks', 'lib']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(p)) out.push(relative(process.cwd(), p))
    }
  }
  ROOTS.forEach(walk)
  return out
}

describe('no em or en dashes in text a doctor reads', () => {
  it('finds none anywhere in app, components, hooks or lib', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      for (const hit of scanForDashes(readFileSync(file, 'utf8'), file)) {
        offenders.push(`${file}:${hit.line}  ${hit.char}  ${hit.text}`)
      }
    }
    // Named individually so a failure says WHERE, not just how many.
    expect(offenders).toEqual([])
  })

  // The exemptions are the part most likely to rot. A blanket pattern would
  // quietly grow until the rule meant nothing, so every exempt file is named.
  it('exempts only files that are entirely AI prompt text', () => {
    expect(Array.from(PROMPT_FILES).sort()).toEqual([
      'app/api/chat/route.ts',
      'app/api/generate/route.ts',
      'app/api/ocr/route.ts',
      'lib/dictationTemplate.ts',
      'lib/gemini.ts',
      'lib/letterTemplateRefine.ts',
      'lib/personalisation.ts',
      'lib/supportKb.ts',
    ])
  })

  it('still reads doctor-facing copy in a file that also holds prompts', () => {
    // lib/utils.ts carries both, which is why it is NOT on the list above: its
    // prompt strings are marked line by line instead.
    expect(Array.from(PROMPT_FILES)).not.toContain('lib/utils.ts')
  })
})

describe('the scanner itself', () => {
  // A checker that cannot tell a comment from a caption would either pass
  // always or fail always, and both are useless.
  it('reads JSX text and string literals', () => {
    expect(scanForDashes('<p>Hello — there</p>')).toHaveLength(1)
    expect(scanForDashes('const s = "a — b"')).toHaveLength(1)
    expect(scanForDashes('const t = `a — b`')).toHaveLength(1)
  })

  it('ignores comments', () => {
    expect(scanForDashes('// a comment — here')).toHaveLength(0)
    expect(scanForDashes('/* block — here */')).toHaveLength(0)
    expect(scanForDashes('<div>x</div>{/* jsx — comment */}')).toHaveLength(0)
  })

  // The TimePicker case. Losing this breaks every previously saved session time.
  it('ignores a regex character class', () => {
    expect(scanForDashes('const rx = /^(\\d{2}:\\d{2})\\s*[–-]\\s*/')).toHaveLength(0)
  })

  // Closing tags and self-closing tags are on nearly every line of JSX. Reading
  // either as the start of a regex swallows the rest of the file.
  it('does not mistake JSX for a regex', () => {
    expect(scanForDashes('<Foo bar={1} />{/* — */}')).toHaveLength(0)
    expect(scanForDashes('<div>a</div>{/* — */}')).toHaveLength(0)
  })

  it('honours the line opt-out, and the line above a multi-line literal', () => {
    expect(scanForDashes('const s = "x — y" // dash-ok: prompt')).toHaveLength(0)
    expect(scanForDashes('// dash-ok: prompt\nconst p = `\n  a — b\n`')).toHaveLength(0)
    expect(scanForDashes('const p = `\n  a — b\n`')).toHaveLength(1)
  })
})
