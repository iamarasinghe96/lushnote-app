// Text reflow engine for the ruled-table hospital-form editor.
//
// The original standalone form used one <input> per ruled line and hand-rolled
// "push the overflow to the next input" logic that measured with
// getComputedStyle(el).font — a shorthand that returns "" in several browsers,
// so measureText silently fell back to a default font and overflow was never
// detected. The result: typing never wrapped to the next line.
//
// This module is the fix, as pure (DOM-free) functions so it can be unit-tested
// in node. The source of truth is `paragraphs: string[]` (each a logical
// paragraph; "" is an intentional blank line). A fixed grid of `totalRows`
// visual rows is DERIVED from it by greedy word-wrap against an injected text
// measurer, so the same code path serves manual typing and AI fills.

export interface WrapConfig {
  maxWidth: number                 // usable px width of one row
  measure: (s: string) => number   // width of a string in px (canvas measureText)
}

export interface WrappedParagraph {
  lines: string[]    // visual lines, no trailing spaces
  starts: number[]   // offset of each line's first char within the paragraph text
}

// Greedy word wrap. A single word longer than maxWidth is hard-split by
// character so it can never overflow a row. Always returns at least one line
// (an empty paragraph yields ['']), and `starts[k]` is the index in `text`
// where line k begins (the wrap space between lines is consumed, i.e. not part
// of either line, but IS still present in `text`).
export function wrapParagraph(text: string, cfg: WrapConfig): WrappedParagraph {
  const lines: string[] = []
  const starts: number[] = []
  if (text.length === 0) return { lines: [''], starts: [0] }

  const { measure, maxWidth } = cfg
  // Walk the string word by word, tracking absolute offsets (including runs of
  // whitespace) so `starts` maps back into the original paragraph text.
  let i = 0
  let lineStart = 0
  let cur = ''
  const pushLine = (s: string, start: number) => { lines.push(s); starts.push(start) }

  const n = text.length
  while (i < n) {
    // Skip a single run of whitespace between words (collapsed to one space on
    // reconstruction). Leading whitespace of a line is dropped.
    let wsStart = i
    while (i < n && /\s/.test(text[i])) i++
    const hadLeadingWs = i > wsStart
    if (i >= n) break
    // Read the next word
    const wordStart = i
    while (i < n && !/\s/.test(text[i])) i++
    const word = text.slice(wordStart, i)

    if (cur === '') {
      // First word of a line
      if (measure(word) > maxWidth) {
        const chunks = hardSplit(word, cfg)
        for (let c = 0; c < chunks.length - 1; c++) {
          pushLine(chunks[c].text, c === 0 ? wordStart : chunks[c].start)
          lineStart = chunks[c].start
        }
        cur = chunks[chunks.length - 1].text
        lineStart = chunks[chunks.length - 1].start
      } else {
        cur = word
        lineStart = wordStart
      }
      continue
    }

    const trial = cur + ' ' + word
    if (measure(trial) <= maxWidth) {
      cur = trial
    } else {
      pushLine(cur, lineStart)
      // Start a new line with this word (hard-split if needed)
      void hadLeadingWs
      if (measure(word) > maxWidth) {
        const chunks = hardSplit(word, cfg)
        for (let c = 0; c < chunks.length - 1; c++) pushLine(chunks[c].text, chunks[c].start)
        cur = chunks[chunks.length - 1].text
        lineStart = chunks[chunks.length - 1].start
      } else {
        cur = word
        lineStart = wordStart
      }
    }
  }
  pushLine(cur, lineStart)
  return { lines, starts }
}

interface Chunk { text: string; start: number }

// Break a single over-long word into character chunks that each fit maxWidth.
// `start` offsets are relative to the word's position in the paragraph — the
// caller passes wordStart via the returned chunk[0].start being the word start;
// here starts are word-relative and fixed up by the caller through wordStart.
function hardSplit(word: string, cfg: WrapConfig): Chunk[] {
  const { measure, maxWidth } = cfg
  const chunks: Chunk[] = []
  let cur = ''
  let curStart = 0
  for (let k = 0; k < word.length; k++) {
    const ch = word[k]
    if (cur !== '' && measure(cur + ch) > maxWidth) {
      chunks.push({ text: cur, start: curStart })
      cur = ch
      curStart = k
    } else {
      cur += ch
    }
  }
  chunks.push({ text: cur, start: curStart })
  return chunks
}

export interface Layout {
  rows: string[]        // length totalRows — text of each visual row ('' padding)
  rowPara: number[]     // paragraph index each row belongs to (-1 = empty padding)
  rowStart: number[]    // offset of the row's first char within its paragraph
  paraEndRow: number[]  // for each paragraph index, the last row it occupies
  overflow: boolean     // true if paragraphs did not fit in totalRows
}

// Lay paragraphs out across a fixed grid of rows.
export function layoutRows(paragraphs: string[], totalRows: number, cfg: WrapConfig): Layout {
  const rows: string[] = []
  const rowPara: number[] = []
  const rowStart: number[] = []
  const paraEndRow: number[] = []
  let overflow = false
  let r = 0

  for (let p = 0; p < paragraphs.length; p++) {
    const { lines, starts } = wrapParagraph(paragraphs[p], cfg)
    for (let k = 0; k < lines.length; k++) {
      if (r >= totalRows) { overflow = true; break }
      rows[r] = lines[k]
      rowPara[r] = p
      rowStart[r] = starts[k]
      r++
    }
    paraEndRow[p] = Math.min(r - 1, totalRows - 1)
    if (overflow) break
  }
  while (r < totalRows) { rows[r] = ''; rowPara[r] = -1; rowStart[r] = 0; r++ }
  return { rows, rowPara, rowStart, paraEndRow, overflow }
}

// Map an absolute (paragraph, offset) caret to a (row, col) in the grid.
export function paraOffsetToRowCol(layout: Layout, para: number, offset: number): { row: number; col: number } {
  let last = -1
  for (let r = 0; r < layout.rows.length; r++) {
    if (layout.rowPara[r] !== para) { if (last !== -1) break; else continue }
    if (layout.rowStart[r] <= offset) last = r
    else break
  }
  if (last === -1) {
    // Paragraph not visible (overflowed) — clamp to the last real row.
    for (let r = layout.rows.length - 1; r >= 0; r--) if (layout.rowPara[r] !== -1) return { row: r, col: layout.rows[r].length }
    return { row: 0, col: 0 }
  }
  return { row: last, col: Math.max(0, Math.min(offset - layout.rowStart[last], layout.rows[last].length)) }
}

export interface EditResult { paragraphs: string[]; caretPara: number; caretOffset: number }

// Apply the new value of a single visual row's input and return updated
// paragraphs plus the caret's absolute position (for re-layout + refocus).
export function applyRowEdit(
  paragraphs: string[], layout: Layout, row: number, newValue: string, caretCol: number,
): EditResult {
  const p = layout.rowPara[row]
  if (p === -1) {
    // Typing into empty padding: append (or reuse a trailing empty paragraph).
    if (paragraphs.length && paragraphs[paragraphs.length - 1] === '') {
      const next = paragraphs.slice()
      next[next.length - 1] = newValue
      return { paragraphs: next, caretPara: next.length - 1, caretOffset: caretCol }
    }
    const next = [...paragraphs, newValue]
    return { paragraphs: next, caretPara: next.length - 1, caretOffset: caretCol }
  }
  const start = layout.rowStart[row]
  const oldLen = layout.rows[row].length
  const para = paragraphs[p]
  const nextPara = para.slice(0, start) + newValue + para.slice(start + oldLen)
  const next = paragraphs.slice()
  next[p] = nextPara
  return { paragraphs: next, caretPara: p, caretOffset: start + caretCol }
}

// Enter at (row, col): split the paragraph there into two paragraphs.
export function applyEnter(paragraphs: string[], layout: Layout, row: number, col: number): EditResult {
  const p = layout.rowPara[row]
  if (p === -1) {
    // Enter on empty padding → add a blank paragraph at the end.
    const next = [...paragraphs, '']
    return { paragraphs: next, caretPara: next.length - 1, caretOffset: 0 }
  }
  const o = layout.rowStart[row] + col
  const para = paragraphs[p]
  const next = paragraphs.slice()
  next.splice(p, 1, para.slice(0, o), para.slice(o))
  return { paragraphs: next, caretPara: p + 1, caretOffset: 0 }
}

// Backspace at col 0 of a row: delete across the wrap/paragraph boundary.
// Returns null when there is nothing before the caret (top of document), so the
// caller can let the default no-op happen.
export function applyBackspaceAtStart(paragraphs: string[], layout: Layout, row: number): EditResult | null {
  const p = layout.rowPara[row]
  if (p === -1) return null
  const start = layout.rowStart[row]
  if (start > 0) {
    // Soft-wrap boundary: delete the character before the row start (the
    // consumed wrap space) so the two words rejoin, then reflow.
    const para = paragraphs[p]
    const nextPara = para.slice(0, start - 1) + para.slice(start)
    const next = paragraphs.slice()
    next[p] = nextPara
    return { paragraphs: next, caretPara: p, caretOffset: start - 1 }
  }
  // First row of a paragraph: merge with the previous paragraph.
  if (p === 0) return null
  const prevLen = paragraphs[p - 1].length
  const merged = paragraphs[p - 1] + paragraphs[p]
  const next = paragraphs.slice()
  next.splice(p - 1, 2, merged)
  return { paragraphs: next, caretPara: p - 1, caretOffset: prevLen }
}

// Split AI/pasted text into logical paragraphs (blank line = paragraph break).
// A single newline inside a block is treated as a soft break → joined with a
// space so the wrapper reflows it; double newline is a hard paragraph break.
export function fillFromText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n{2,}/)
  const paras = blocks.map(b => b.split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim())
  const cleaned = paras.filter((p, i) => p.length > 0 || i < paras.length)
  return cleaned.length ? cleaned : ['']
}

// Reconstruct the full note text from paragraphs (for saving to `content`).
export function paragraphsToText(paragraphs: string[]): string {
  return paragraphs.map(p => p).join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ── Styled (bold/italic) layout for the read-only A4 renderer ─────────────────
// The generated note may use **bold** / *italic* markers (e.g. bold subtopic
// headings) and explicit line breaks (numbered lists). This wraps that into a
// fixed grid of rows where each row is a list of styled runs.

export interface StyledRun { text: string; bold: boolean; italic: boolean }
export interface StyledWrapConfig {
  maxWidth: number
  measure: (s: string, bold: boolean, italic: boolean) => number
}

// Parse **bold** and *italic* inline markers into styled runs (markers removed).
function parseInline(text: string): StyledRun[] {
  const runs: StyledRun[] = []
  let bold = false, italic = false, buf = ''
  const flush = () => { if (buf) { runs.push({ text: buf, bold, italic }); buf = '' } }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '*' && text[i + 1] === '*') { flush(); bold = !bold; i++; continue }
    if (text[i] === '*') { flush(); italic = !italic; continue }
    buf += text[i]
  }
  flush()
  return runs
}

function mergeRuns(runs: StyledRun[]): StyledRun[] {
  const out: StyledRun[] = []
  for (const r of runs) {
    const last = out[out.length - 1]
    if (last && last.bold === r.bold && last.italic === r.italic) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

// Greedy word-wrap a line's styled runs into visual lines of styled runs.
function wrapRuns(runs: StyledRun[], cfg: StyledWrapConfig): StyledRun[][] {
  const toks: StyledRun[] = []
  for (const r of runs) {
    for (const part of r.text.split(/(\s+)/)) {
      if (part === '') continue
      toks.push({ text: part, bold: r.bold, italic: r.italic })
    }
  }
  const lines: StyledRun[][] = []
  let cur: StyledRun[] = []
  let curW = 0
  const w = (t: StyledRun) => cfg.measure(t.text, t.bold, t.italic)
  const trimTrailing = () => { while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) { curW -= w(cur[cur.length - 1]); cur.pop() } }
  for (const tok of toks) {
    const isSpace = /^\s+$/.test(tok.text)
    const tw = w(tok)
    if (isSpace) { if (cur.length) { cur.push(tok); curW += tw } continue }
    if (cur.length > 0 && curW + tw > cfg.maxWidth) { trimTrailing(); lines.push(mergeRuns(cur)); cur = []; curW = 0 }
    if (cur.length === 0 && tw > cfg.maxWidth) {
      let chunk = ''
      for (const ch of tok.text) {
        if (chunk && cfg.measure(chunk + ch, tok.bold, tok.italic) > cfg.maxWidth) { lines.push([{ text: chunk, bold: tok.bold, italic: tok.italic }]); chunk = ch }
        else chunk += ch
      }
      cur = [{ text: chunk, bold: tok.bold, italic: tok.italic }]; curW = cfg.measure(chunk, tok.bold, tok.italic)
      continue
    }
    cur.push(tok); curW += tw
  }
  trimTrailing()
  if (cur.length) lines.push(mergeRuns(cur))
  if (lines.length === 0) lines.push([])
  return lines
}

export function layoutStyledRows(text: string, totalRows: number, cfg: StyledWrapConfig): { rows: StyledRun[][]; overflow: boolean } {
  const src = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const rows: StyledRun[][] = []
  let overflow = false
  for (const line of src) {
    if (rows.length >= totalRows) { overflow = true; break }
    if (line.trim() === '') { rows.push([]); continue }
    for (const wrapped of wrapRuns(parseInline(line), cfg)) {
      if (rows.length >= totalRows) { overflow = true; break }
      rows.push(wrapped)
    }
    if (overflow) break
  }
  while (rows.length < totalRows) rows.push([])
  return { rows, overflow }
}
