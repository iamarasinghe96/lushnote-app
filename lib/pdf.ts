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

export function generateNotePDF(note: Partial<Note>, clinicianName?: string): jsPDF {
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
    y += 9
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

    const lines = doc.splitTextToSize(value, TEXT_W) as string[]
    for (const line of lines) {
      ensureSpace(5)
      doc.text(line, MARGIN, y)
      y += 4.5
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

export function downloadNotePDF(note: Partial<Note>, clinicianName?: string): void {
  if (typeof window === 'undefined') return
  const doc = generateNotePDF(note, clinicianName)
  const filename = `LushNote_${note.patient || 'Note'}_${note.date || ''}`
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
  doc.save(`${filename}.pdf`)
}
