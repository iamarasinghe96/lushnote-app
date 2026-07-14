import { jsPDF } from 'jspdf'
import type { Note } from '@/types'

const MARGIN = 20
const PAGE_W = 210
const PAGE_H = 297
const TEXT_W = PAGE_W - MARGIN * 2
const BOTTOM_LIMIT = PAGE_H - MARGIN - 8


const SECTIONS: { key: keyof Note; label: string }[] = [
  { key: 'diagnosis',    label: 'Diagnosis' },
  { key: 'presentation', label: 'Presentation' },
  { key: 'history',      label: 'History' },
  { key: 'medications',  label: 'Medications' },
  { key: 'mse',          label: 'Mental Status Examination' },
  { key: 'content',      label: 'Session Content' },
  { key: 'scales',       label: 'Scales' },
  { key: 'risk',         label: 'Risk' },
  { key: 'referrals',    label: 'Referrals' },
  { key: 'summary',      label: 'Summary' },
  { key: 'nextsteps',    label: 'Next Steps' },
]

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
  // colour. Advances y past the last line.
  function drawRich(text: string, startX: number, wrapX: number) {
    const segs = parseBoldSegments(text)
    const tokens: { w: string; bold: boolean; italic: boolean; space: boolean }[] = []
    for (const s of segs) {
      for (const part of s.text.split(/(\s+)/)) {
        if (!part) continue
        tokens.push({ w: part, bold: s.bold, italic: s.italic, space: /^\s+$/.test(part) })
      }
    }
    const fontStyle = (bold: boolean, italic: boolean) =>
      bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal'
    const maxX = PAGE_W - MARGIN
    let x = startX
    let atLineStart = true
    for (const tok of tokens) {
      if (tok.space) {
        if (atLineStart) continue
        doc.setFont('helvetica', 'normal')
        x += doc.getTextWidth(tok.w)
        continue
      }
      doc.setFont('helvetica', fontStyle(tok.bold, tok.italic))
      const tw = doc.getTextWidth(tok.w)
      if (!atLineStart && x + tw > maxX) {
        y += 4.5
        ensureSpace(5)
        x = wrapX
        atLineStart = true
      }
      doc.setTextColor(tok.bold ? 80 : 60)
      doc.text(tok.w, x, y)
      x += tw
      atLineStart = false
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
  for (const { key, label } of SECTIONS) {
    const value = (note[key] as string | undefined)?.trim()
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
        ensureSpace(5)
        drawRich(trimmed, MARGIN, MARGIN)
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
  const filename = `LushNote_${note.patient || 'Note'}_${note.date || ''}`
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
  doc.save(`${filename}.pdf`)
}
