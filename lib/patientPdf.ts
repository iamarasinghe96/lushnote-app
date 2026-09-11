import { patientOtherTopics, calculateAgeFromDOB } from './utils'
import type { PatientProfile } from '@/types'

// The patient handover sheet.
//
// Lifted out of PatientTable when the capture card needed it too: a ward round
// photographed into the record and a handover sheet printed from it are one
// workflow, and the doctor should not have to go and find a toolbar button to
// finish it. Takes an ARRAY, so one patient and a whole ward list are the same
// call — a single row is simply a one-row sheet.

// Download the shown patients as a landscape A4 grid — one row per patient, one
// column per field — so a ward list reads like a handover sheet rather than a
// stack of paragraphs. Column widths are relative and scaled to the page, so a
// column can be dropped or added without re-tuning millimetres by hand. jsPDF is
// code-split so it only loads when exporting.
export async function exportPatientsPDF(rows: PatientProfile[]) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PAGE_W = 297, PAGE_H = 210, MARGIN = 8
  const USABLE = PAGE_W - MARGIN * 2
  const HEAD_H = 7
  const LINE_H = 2.9
  const PAD_X = 1.4, PAD_Y = 2.2

  const val = (p: PatientProfile, k: keyof PatientProfile) =>
    typeof p[k] === 'string' ? String(p[k]).trim() : ''
  const pmhSocial = (p: PatientProfile) =>
    [val(p, 'pastMedicalHistory'), val(p, 'socialHistory')].filter(Boolean).join('\n')

  type Col = { label: string; weight: number; get: (p: PatientProfile) => string }
  const allCols: Col[] = [
    { label: 'Patient', weight: 3.0, get: p => {
        const age = calculateAgeFromDOB((p.dob ?? '').trim())
        return p.displayName + (age !== null && age >= 0 ? ` (${age}Y)` : '')
      } },
    { label: 'UR Number', weight: 2.2, get: p => val(p, 'urNumber') },
    { label: 'Status', weight: 1.8, get: p => val(p, 'status') },
    { label: 'Date of Birth', weight: 2.0, get: p => val(p, 'dob') },
    { label: 'Bed', weight: 1.6, get: p => val(p, 'bedNumber') },
    { label: 'Presenting Issue', weight: 3.2, get: p => val(p, 'presentingIssue') },
    { label: 'Current Issues', weight: 3.4, get: p => val(p, 'currentIssues') },
    { label: 'Management (IP)', weight: 3.4, get: p => val(p, 'managementIP') },
    { label: 'Past Medical & Social History', weight: 3.4, get: pmhSocial },
    { label: 'Medications', weight: 2.8, get: p => val(p, 'medications') },
    { label: 'Bloods & Pathology', weight: 2.6, get: p => val(p, 'bloodsPathology') },
    { label: 'Imaging', weight: 2.6, get: p => val(p, 'imaging') },
    { label: 'Plan', weight: 2.8, get: p => val(p, 'plan') },
    { label: 'Other Topics', weight: 3.0, get: p => patientOtherTopics(p).trim() },
  ]
  // Drop columns nobody has filled — the remaining ones then get the space,
  // which matters a great deal at 14 columns across one page.
  const cols = allCols.filter((c, i) => i < 4 || rows.some(p => c.get(p).trim()))
  const totalWeight = cols.reduce((n, c) => n + c.weight, 0)
  const widths = cols.map(c => (c.weight / totalWeight) * USABLE)

  // Wrap one cell, bulleting each source line when there is more than one.
  type Line = { text: string; bullet: boolean; indent: number }
  function cellLines(text: string, w: number): Line[] {
    const items = text.split('\n').map(t => t.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
    if (!items.length) return [{ text: '-', bullet: false, indent: 0 }]
    const many = items.length > 1
    const indent = many ? 2.2 : 0
    const out: Line[] = []
    for (const item of items) {
      const wrapped = doc.splitTextToSize(item, w - PAD_X * 2 - indent) as string[]
      wrapped.forEach((ln, i) => out.push({ text: ln, bullet: many && i === 0, indent }))
    }
    return out
  }

  function drawHeader(y: number): number {
    doc.setDrawColor(148, 163, 184)
    doc.setLineWidth(0.2)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.2)
    let x = MARGIN
    cols.forEach((c, i) => {
      // The fill MUST be re-set for every cell. jsPDF emits a text colour as the
      // PDF non-stroking colour, so after the first header label is drawn the
      // next filled rect inherits it — which painted every column after the
      // first in the dark text colour, hiding its label.
      doc.setFillColor(226, 232, 240)
      doc.rect(x, y, widths[i], HEAD_H, 'FD')
      doc.setTextColor(15, 23, 42)
      const lines = doc.splitTextToSize(c.label, widths[i] - PAD_X * 2) as string[]
      lines.slice(0, 2).forEach((ln, li) => doc.text(ln, x + widths[i] / 2, y + 3 + li * 2.6, { align: 'center' }))
      x += widths[i]
    })
    return y + HEAD_H
  }

  const now = new Date()
  const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

  function drawTitle(): number {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(29, 78, 216)
    doc.text(`PATIENT LIST - ${dateStr}  (TOTAL: ${rows.length} PATIENT${rows.length !== 1 ? 'S' : ''})`,
      PAGE_W / 2, MARGIN + 4, { align: 'center' })
    return MARGIN + 8
  }

  let y = drawHeader(drawTitle())

  rows.forEach((p, rowIndex) => {
    const cells = cols.map((c, i) => cellLines(c.get(p), widths[i]))
    const rowH = Math.max(...cells.map(l => l.length)) * LINE_H + PAD_Y * 2

    // Start a new page when the row won't fit — unless it's taller than a whole
    // page on its own, in which case a fresh page wouldn't help.
    if (y + rowH > PAGE_H - MARGIN && rowH < PAGE_H - MARGIN * 2 - HEAD_H) {
      doc.addPage()
      y = drawHeader(MARGIN)
    }

    if (rowIndex % 2 === 1) {
      doc.setFillColor(248, 250, 252)
      doc.rect(MARGIN, y, USABLE, rowH, 'F')
    }

    let x = MARGIN
    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.15)
    cells.forEach((lines, i) => {
      doc.rect(x, y, widths[i], rowH)
      // The name column carries the row, so give it weight.
      doc.setFont('helvetica', i === 0 ? 'bold' : 'normal')
      doc.setFontSize(6.2)
      doc.setTextColor(i === 0 ? 15 : 51, i === 0 ? 23 : 65, i === 0 ? 42 : 85)
      lines.forEach((ln, li) => {
        const ty = y + PAD_Y + 1 + li * LINE_H
        if (ln.bullet) {
          doc.setTextColor(100, 116, 139)
          doc.text('•', x + PAD_X, ty)
          doc.setTextColor(i === 0 ? 15 : 51, i === 0 ? 23 : 65, i === 0 ? 42 : 85)
        }
        doc.text(ln.text, x + PAD_X + ln.indent, ty)
      })
      x += widths[i]
    })
    y += rowH
  })

  // Page numbers last, once the total is known.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(148, 163, 184)
    doc.text(`LushNote · ${dateStr}`, MARGIN, PAGE_H - 3)
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, PAGE_H - 3, { align: 'right' })
  }

  doc.save(`patient-list-${dateStr.replace(/\//g, '-')}.pdf`)
}
