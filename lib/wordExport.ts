// Word export of a clinical note.
//
// Deliberately NOT the "save HTML with a .docx extension" trick. That produces a
// file Word opens under protest, with no real styles, which a doctor cannot
// restyle and a hospital template cannot absorb. This builds actual OOXML: the
// section labels are Heading 1, the sub-headings inside them Heading 2, lists
// are real numbered and bulleted lists. So the navigation pane works, Styles
// restyles the whole document at once, and pasting into a hospital template
// keeps the structure.
//
// The layout mirrors lib/pdf.ts line for line — same title, same rule, same meta
// row, same section order, same treatment of every line shape — because a doctor
// choosing Word instead of PDF should get the same document, not a different one.

import {
  AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer,
  Paragraph, TabStopType, TextRun, convertInchesToTwip,
} from 'docx'
import { orderedNoteSections } from '@/lib/utils'
import { parseBoldSegments } from '@/lib/pdf'
import type { Note } from '@/types'

const SECTION_LABELS: Record<string, string> = {
  diagnosis: 'Diagnosis', presentation: 'Presentation', history: 'History',
  medications: 'Medications', mse: 'Mental Status Examination', content: 'Session Content',
  scales: 'Scales', risk: 'Risk', referrals: 'Referrals', summary: 'Summary', nextsteps: 'Next Steps',
}

// docx measures in half-points and twips; the PDF's pt sizes are kept so the two
// documents read at the same weight.
const half = (pt: number) => pt * 2
const BODY_PT = 10
const BODY = '3C3C3C'
const HEADING = '1E1E1E'
const SUBHEADING = '505050'
const MUTED = '6E6E6E'

function calcAge(dob: string): number | null {
  const parts = dob.split('/')
  if (parts.length !== 3) return null
  const birth = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

/** `**bold**` and `*italic*` become real runs, so the emphasis survives editing. */
function richRuns(text: string, opts?: { color?: string; size?: number }): TextRun[] {
  return parseBoldSegments(text).map(s => new TextRun({
    text: s.text,
    bold: s.bold,
    italics: s.italic,
    color: opts?.color ?? BODY,
    size: half(opts?.size ?? BODY_PT),
  }))
}

interface BodyOptions {
  numbering?: { reference: string; level: number }
}

function bodyParagraph(runs: TextRun[], extra: BodyOptions = {}): Paragraph {
  return new Paragraph({
    children: runs,
    // Justified prose, matching the PDF. Lists and headings override this.
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 80, line: 276 },
    ...extra,
  })
}

export function buildNoteDocument(
  note: Partial<Note>,
  clinicianName?: string,
  patientInfo?: { dob?: string; gender?: string },
): Document {
  const children: Paragraph[] = []

  // ── Title row: patient · date, with the clinician right-aligned ──────────
  // One paragraph with a right tab stop rather than a table, so the doctor can
  // edit either side without fighting a layout.
  const title = [note.patient, note.date].filter(Boolean).join('   ·   ')
  children.push(new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: convertInchesToTwip(6.27) }],
    spacing: { after: 60 },
    children: [
      new TextRun({ text: title, bold: true, size: half(14), color: HEADING }),
      ...(clinicianName ? [new TextRun({ text: `\t${clinicianName}`, size: half(9), color: MUTED })] : []),
    ],
  }))

  // The rule under the title is a paragraph border, so it moves with the text
  // instead of floating at a fixed position.
  children.push(new Paragraph({
    spacing: { after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DCDCDC', space: 1 } },
    children: [],
  }))

  // ── Meta row ─────────────────────────────────────────────────────────────
  const meta: string[] = []
  if (note.reg_number) meta.push(`Reg: ${note.reg_number}`)
  if (note.session_number) meta.push(`Session ${note.session_number}`)
  if (patientInfo?.dob) {
    const age = calcAge(patientInfo.dob)
    if (age !== null) meta.push(`Age: ${age}`)
  }
  if (patientInfo?.gender && patientInfo.gender !== 'prefer-not-to-say') {
    const g = ({ male: 'Male', female: 'Female', other: 'Other' } as Record<string, string>)[patientInfo.gender]
    if (g) meta.push(g)
  }
  if (meta.length) {
    children.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: meta.join('   ·   '), size: half(9), color: MUTED })],
    }))
  }

  // ── Sections ─────────────────────────────────────────────────────────────
  for (const { label, content } of orderedNoteSections(note, key => SECTION_LABELS[key] ?? key)) {
    const value = content.trim()
    if (!value) continue

    // Heading 1 — this is what fills Word's navigation pane and lets a doctor
    // restyle every section label at once.
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 240, after: 100 },
      keepNext: true,   // a label must never sit alone at the foot of a page
      children: [new TextRun({ text: label.toUpperCase(), bold: true, size: half(11), color: HEADING })],
    }))

    for (const raw of value.split('\n')) {
      const trimmed = raw.trim()
      if (!trimmed) continue

      // Same line classification the PDF uses, in the same order of precedence.
      const markdownHeading = trimmed.match(/^#{1,3}\s+(.+)$/)
      const boldHeading = !markdownHeading && trimmed.match(/^\*\*(.+?)\*\*:?\s*$/)
      const isStandalone = !markdownHeading && !boldHeading && /^[A-Za-z][A-Za-z &/\-()]{0,40}:\s*$/.test(trimmed)
      const numMatch = !markdownHeading && !boldHeading && !isStandalone && trimmed.match(/^(\d+)\.\s+(.*)$/)
      const bulletMatch = !markdownHeading && !boldHeading && !isStandalone && !numMatch && trimmed.match(/^[-•]\s+(.*)$/)
      const inlineMatch = !markdownHeading && !boldHeading && !isStandalone && !numMatch && !bulletMatch
        && trimmed.match(/^([A-Za-z][A-Za-z ,&/\-()]{0,50}):\s+(.+)/)

      if (markdownHeading || boldHeading || isStandalone) {
        let heading = markdownHeading ? markdownHeading[1] : boldHeading ? boldHeading[1] : trimmed
        heading = heading.replace(/[:#*]+$/, '').replace(/\*+/g, '').trim()
        if (/:\s*$/.test(trimmed) && !heading.endsWith(':')) heading += ':'
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 120, after: 60 },
          keepNext: true,
          children: [new TextRun({ text: heading, bold: true, size: half(BODY_PT), color: SUBHEADING })],
        }))
      } else if (numMatch) {
        // A real numbered list, not "1." typed as text — so Word renumbers when
        // the doctor inserts an item.
        children.push(bodyParagraph(richRuns(numMatch[2]), {
          numbering: { reference: 'note-numbers', level: 0 },
        }))
      } else if (bulletMatch) {
        children.push(bodyParagraph(richRuns(bulletMatch[1]), {
          numbering: { reference: 'note-bullets', level: 0 },
        }))
      } else if (inlineMatch) {
        // "Label: content" keeps the label bold in the same paragraph.
        children.push(bodyParagraph([
          new TextRun({ text: `${inlineMatch[1]}: `, bold: true, size: half(BODY_PT), color: SUBHEADING }),
          ...richRuns(inlineMatch[2]),
        ]))
      } else {
        children.push(bodyParagraph(richRuns(trimmed)))
      }
    }
  }

  return new Document({
    creator: clinicianName || 'LushNote',
    title: [note.patient, note.date].filter(Boolean).join(' - '),
    description: 'Clinical note exported from LushNote',
    // Defining the built-in styles means Word's own Styles pane restyles the
    // whole document — the point of exporting Word rather than a PDF.
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: half(BODY_PT), color: BODY } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Calibri', size: half(11), bold: true, color: HEADING },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { font: 'Calibri', size: half(BODY_PT), bold: true, color: SUBHEADING },
          paragraph: { spacing: { before: 120, after: 60 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'note-numbers',
          levels: [{
            level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.3) } } },
          }],
        },
        {
          reference: 'note-bullets',
          levels: [{
            // Indented one level further than the numbering, matching the PDF,
            // where bullets read as sub-items of the numbered list.
            level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.55), hanging: convertInchesToTwip(0.25) } } },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },   // 20mm, as the PDF
      },
      children,
    }],
  })
}

function noteFilename(note: Partial<Note>): string {
  return `LushNote_${note.patient || 'Note'}_${note.date || ''}`
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-.]/g, '')
}

export async function downloadNoteWord(
  note: Partial<Note>,
  clinicianName?: string,
  patientInfo?: { dob?: string; gender?: string },
): Promise<void> {
  if (typeof window === 'undefined') return
  const blob = await Packer.toBlob(buildNoteDocument(note, clinicianName, patientInfo))
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${noteFilename(note)}.docx`
  a.click()
  URL.revokeObjectURL(url)
}
