import { jsPDF } from 'jspdf'
import type { Note } from '@/types'
import { orderedNoteSections } from '@/lib/utils'

const MARGIN = 20
const PAGE_W = 210
const PAGE_H = 297
const TEXT_W = PAGE_W - MARGIN * 2
const BOTTOM_LIMIT = PAGE_H - MARGIN - 8


const SECTION_LABELS: Record<string, string> = {
  diagnosis: 'Diagnosis', presentation: 'Presentation', history: 'History',
  medications: 'Medications', mse: 'Mental Status Examination', content: 'Session Content',
  scales: 'Scales', risk: 'Risk', referrals: 'Referrals', summary: 'Summary', nextsteps: 'Next Steps',
}

function calcAge(dob: string): number | null {
  const parts = dob.split('/')
  if (parts.length !== 3) return null
  const birth = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
  if (isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 ? age : null
}

export type RichSeg = { text: string; bold: boolean; italic: boolean }

// Split a line into normal/bold/italic segments based on **bold** and *italic*
// markdown markers. Bold is tried first in the alternation, so ** pairs are
// never misread as two single-* italic markers. Exported so the letter PDF
// generator (app/(app)/edit/page.tsx) can render the same inline formatting.
export function parseBoldSegments(text: string): RichSeg[] {
  const segs: RichSeg[] = []
  const rx = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = rx.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index), bold: false, italic: false })
    if (m[1] !== undefined) segs.push({ text: m[1], bold: true, italic: false })
    else segs.push({ text: m[2], bold: false, italic: true })
    last = m.index + m[0].length
  }
  if (last < text.length) segs.push({ text: text.slice(last), bold: false, italic: false })
  return segs
}

export function generateNotePDF(
  note: Partial<Note>,
  clinicianName?: string,
  patientInfo?: { dob?: string; gender?: string }
): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  function ensureSpace(needed: number) {
    if (y + needed > BOTTOM_LIMIT) {
      doc.addPage()
      y = MARGIN
    }
  }

  // Draws text containing **bold** markdown segments with word wrapping.
  // The first line starts at startX; wrapped lines align to wrapX.
  // Bold segments render in the sub-heading weight/colour; normal text in body
  // colour. Advances y past the last line. When `justify` is true, every line
  // except a paragraph's last is stretched flush to the right margin (jsPDF has
  // no native justify) — used for prose paragraphs, not list items.
  function drawRich(text: string, startX: number, wrapX: number, justify = false) {
    const fontStyle = (bold: boolean, italic: boolean) =>
      bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'
    const maxX = PAGE_W - MARGIN
    const partW = (p: { w: string; bold: boolean; italic: boolean }) => {
      doc.setFont('helvetica', fontStyle(p.bold, p.italic)); return doc.getTextWidth(p.w)
    }

    // Group consecutive non-space tokens into word "units" (so mid-word bold
    // like **Trans**ference stays glued and justification only spaces words).
    const units: { parts: { w: string; bold: boolean; italic: boolean }[]; width: number }[] = []
    let cur: (typeof units)[number] | null = null
    for (const s of parseBoldSegments(text)) {
      for (const part of s.text.split(/(\s+)/)) {
        if (!part) continue
        if (/^\s+$/.test(part)) { cur = null; continue }
        const p = { w: part, bold: s.bold, italic: s.italic }
        if (!cur) { cur = { parts: [], width: 0 }; units.push(cur) }
        cur.parts.push(p); cur.width += partW(p)
      }
    }
    if (units.length === 0) return

    doc.setFont('helvetica', 'normal')
    const sw = doc.getTextWidth(' ')

    // Greedy wrap into visual lines.
    const lines: { units: typeof units; width: number; startX: number }[] = []
    let line: (typeof lines)[number] | null = null
    for (const u of units) {
      if (!line) { line = { units: [u], width: u.width, startX }; continue }
      if (line.startX + line.width + sw + u.width > maxX) {
        lines.push(line); line = { units: [u], width: u.width, startX: wrapX }
      } else { line.units.push(u); line.width += sw + u.width }
    }
    if (line) lines.push(line)

    for (let li = 0; li < lines.length; li++) {
      const ln = lines[li]
      const isLast = li === lines.length - 1
      ensureSpace(5)
      let gap = sw
      if (justify && !isLast && ln.units.length > 1) {
        gap = sw + (maxX - ln.startX - ln.width) / (ln.units.length - 1)
      }
      let x = ln.startX
      for (let ui = 0; ui < ln.units.length; ui++) {
        for (const p of ln.units[ui].parts) {
          doc.setFont('helvetica', fontStyle(p.bold, p.italic))
          doc.setTextColor(p.bold ? 80 : 60)
          doc.text(p.w, x, y)
          x += partW(p)
        }
        if (ui < ln.units.length - 1) x += gap
      }
      if (!isLast) y += 4.5
    }
    y += 4.5
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60)
  }

  // ── Header ──────────────────────────────────────────────
  // No product/trade name on the exported document — just the clinical
  // content, so the note is unambiguously the clinician's own document.
  const titleParts = [note.patient, note.date].filter(Boolean).join('  ·  ')
  if (titleParts) {
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15)
    doc.text(titleParts, MARGIN, y)
  }

  if (clinicianName) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(120)
    doc.text(clinicianName, PAGE_W - MARGIN, y, { align: 'right' })
  }

  y += 4
  doc.setDrawColor(220)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 7

  // ── Patient meta row ────────────────────────────────────
  const metaParts: string[] = []
  if (note.reg_number) metaParts.push(`Reg: ${note.reg_number}`)
  if (note.session_number) metaParts.push(`Session ${note.session_number}`)
  if (patientInfo?.dob) {
    const age = calcAge(patientInfo.dob)
    if (age !== null) metaParts.push(`Age: ${age}`)
  }
  if (patientInfo?.gender && patientInfo.gender !== 'prefer-not-to-say') {
    const gMap: Record<string, string> = { male: 'Male', female: 'Female', other: 'Other' }
    const g = gMap[patientInfo.gender]
    if (g) metaParts.push(g)
  }
  if (metaParts.length) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(110)
    doc.text(metaParts.join('   ·   '), MARGIN, y)
    y += 7
  } else {
    y += 3
  }

  // ── Sections ─────────────────────────────────────────────
  // Ordered core + template-specific extra sections (extraSections), falling
  // back to canonical field order for notes without that field.
  for (const { label, content } of orderedNoteSections(note, key => SECTION_LABELS[key] ?? key)) {
    const value = content.trim()
    if (!value) continue

    ensureSpace(14)

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30)
    doc.text(label.toUpperCase(), MARGIN, y)
    y += 5

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(60)

    const rawLines = value.split('\n')
    for (const raw of rawLines) {
      const trimmed = raw.trim()
      if (!trimmed) continue

      // Markdown subheading: ## Goals or ### Interventions
      const markdownHeading = trimmed.match(/^#{1,3}\s+(.+)$/)
      // Whole-line bold heading: **Goals:** or **Obstacles, Setbacks and Progress:**
      const boldHeading = !markdownHeading && trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
      // Standalone plain subheading: entire line is "Label:" with nothing after
      const isStandalone = !markdownHeading && !boldHeading && /^[A-Za-z][A-Za-z &\/\-()]{0,40}:\s*$/.test(trimmed)
      // Numbered list item: "1. text" or "10. text"
      const numMatch = !markdownHeading && !boldHeading && !isStandalone && trimmed.match(/^(\d+\.)\s+(.*)$/)
      // Bullet list item
      const bulletMatch = !markdownHeading && !boldHeading && !isStandalone && !numMatch && trimmed.match(/^[-•]\s+(.*)$/)
      // Inline plain subheading: "Label: rest of content..."
      const inlineMatch = !markdownHeading && !boldHeading && !isStandalone && !numMatch && !bulletMatch && trimmed.match(/^([A-Za-z][A-Za-z ,&\/\-()]{0,50}):\s+(.+)/)

      if (markdownHeading) {
        ensureSpace(6)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        const heading = markdownHeading[1].replace(/[:#*]+$/, '').trim()
        doc.text(heading, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        y += 5
      } else if (boldHeading) {
        ensureSpace(5)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        let heading = boldHeading[1].replace(/\*+/g, '').trim()
        if (/:\s*$/.test(trimmed) && !heading.endsWith(':')) heading += ':'
        doc.text(heading, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        y += 4.5
      } else if (isStandalone) {
        ensureSpace(5)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        doc.text(trimmed, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        y += 4.5
      } else if (numMatch) {
        // Hanging indent: number sits at MARGIN, wrapped lines align under the text
        const prefix = numMatch[1] + ' '
        const prefixW = doc.getTextWidth(prefix)
        ensureSpace(5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        doc.text(prefix, MARGIN, y)
        drawRich(numMatch[2], MARGIN + prefixW, MARGIN + prefixW)
      } else if (bulletMatch) {
        const prefix = '•  '
        const prefixW = doc.getTextWidth(prefix)
        ensureSpace(5)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        doc.text(prefix, MARGIN, y)
        drawRich(bulletMatch[1], MARGIN + prefixW, MARGIN + prefixW)
      } else if (inlineMatch) {
        const label = inlineMatch[1] + ': '
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        const labelW = doc.getTextWidth(label)
        ensureSpace(5)
        doc.text(label, MARGIN, y)
        drawRich(inlineMatch[2], MARGIN + labelW, MARGIN)
      } else {
        // Plain prose paragraph — justify (list items/headings above stay left).
        ensureSpace(5)
        drawRich(trimmed, MARGIN, MARGIN, true)
      }
    }

    y += 4
  }

  // ── Footers (all pages) ───────────────────────────────────
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(String(i), PAGE_W / 2, PAGE_H - MARGIN / 2, { align: 'center' })
  }

  return doc
}

export function downloadNotePDF(
  note: Partial<Note>,
  clinicianName?: string,
  patientInfo?: { dob?: string; gender?: string }
): void {
  if (typeof window === 'undefined') return
  const doc = generateNotePDF(note, clinicianName, patientInfo)
  doc.save(`${noteFilename(note)}.pdf`)
}

function noteFilename(note: Partial<Note>): string {
  return `LushNote_${note.patient || 'Note'}_${note.date || ''}`
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
}

// Share the actual PDF FILE via the OS share sheet (not a blob: URL), so apps
// like WhatsApp attach a clean "Name.pdf" card with a readable caption. Falls
// back to a normal download where file-sharing isn't supported.
export async function shareNotePDF(
  note: Partial<Note>,
  clinicianName?: string,
  patientInfo?: { dob?: string; gender?: string }
): Promise<void> {
  if (typeof window === 'undefined') return
  const doc = generateNotePDF(note, clinicianName, patientInfo)
  const filename = noteFilename(note)
  const file = new File([doc.output('blob')], `${filename}.pdf`, { type: 'application/pdf' })
  const caption = ['Progress note', note.patient, note.date].filter(Boolean).join(' · ')
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare({ files: [file] }))) {
    try { await navigator.share({ files: [file], title: `${filename}.pdf`, text: caption }); return }
    catch (e) { if ((e as Error)?.name === 'AbortError') return }
  }
  doc.save(`${filename}.pdf`)
}
