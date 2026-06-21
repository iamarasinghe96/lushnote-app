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

  // ── Header ──────────────────────────────────────────────
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(90, 214, 167) // mint #5ad6a7
  doc.text('LushNote', MARGIN, y)

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

  // ── Title ────────────────────────────────────────────────
  const titleParts = [note.patient, note.date].filter(Boolean).join('  ·  ')
  if (titleParts) {
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15)
    doc.text(titleParts, MARGIN, y)
    y += 6
  }

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
      // Standalone subheading: entire line is "Label:" with nothing after
      const isStandalone = !markdownHeading && /^[A-Za-z][A-Za-z &\/\-()]{0,40}:\s*$/.test(trimmed)
      // Inline subheading: "Label: rest of content..." (only when line starts with a letter)
      const inlineMatch = !markdownHeading && !isStandalone && trimmed.match(/^([A-Za-z][A-Za-z ,&\/\-()]{0,50}):\s+(.+)/)
      // Numbered list item: "1. text" or "10. text"
      const numMatch = !markdownHeading && !isStandalone && !inlineMatch && trimmed.match(/^(\d+\.)\s+(.*)$/)

      if (markdownHeading) {
        ensureSpace(6)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        const heading = markdownHeading[1].replace(/[:#*]+$/, '').trim()
        doc.text(heading, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        y += 5
      } else if (isStandalone) {
        ensureSpace(5)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        doc.text(trimmed, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        y += 4.5
      } else if (inlineMatch) {
        const label  = inlineMatch[1] + ':'
        const rest   = ' ' + inlineMatch[2]
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(80)
        const labelW = doc.getTextWidth(label)
        const restLines = doc.splitTextToSize(rest, TEXT_W - labelW) as string[]
        ensureSpace(5)
        doc.text(label, MARGIN, y)
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(60)
        doc.text(restLines[0], MARGIN + labelW, y)
        y += 4.5
        for (let ri = 1; ri < restLines.length; ri++) {
          ensureSpace(5)
          doc.text(restLines[ri], MARGIN, y)
          y += 4.5
        }
      } else if (numMatch) {
        // Hanging indent: number sits at MARGIN, wrapped lines align under the text
        const prefix = numMatch[1] + ' '
        const content = numMatch[2]
        const prefixW = doc.getTextWidth(prefix)
        const contentLines = doc.splitTextToSize(content, TEXT_W - prefixW) as string[]
        ensureSpace(5)
        doc.text(prefix, MARGIN, y)
        if (contentLines[0]) doc.text(contentLines[0], MARGIN + prefixW, y)
        y += 4.5
        for (let ci = 1; ci < contentLines.length; ci++) {
          ensureSpace(5)
          doc.text(contentLines[ci], MARGIN + prefixW, y)
          y += 4.5
        }
      } else {
        const wrapped = doc.splitTextToSize(raw, TEXT_W) as string[]
        for (let wi = 0; wi < wrapped.length; wi++) {
          ensureSpace(5)
          doc.text(wrapped[wi], MARGIN, y)
          y += 4.5
        }
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
