'use client'

import { parseBoldSegments } from '@/lib/pdf'
import { letterSalutation, formatDateForLetter, calculateAgeFromDOB, autoNumberLines } from '@/lib/utils'
import type { LetterType, LetterCommonFields, ReferralFields, RecordsFields, FreetextFields } from '@/types'

// Shared letter PDF + email builders, extracted from the edit page so the Export
// tab and (historically) the edit toolbar produce byte-identical output. All the
// state a letter needs is passed in — no store/profile coupling here.
export interface LetterExportParams {
  letterType: LetterType
  common: LetterCommonFields
  referral: ReferralFields
  records: RecordsFields
  freetext: FreetextFields
  customSections: { heading: string; content: string }[]
  letterheadHeaderUrl?: string | null
  letterheadFooterUrl?: string | null
  signatureUrl?: string | null
  signatureScale?: number   // percent
  fontSize?: number         // pt
  lineSpacing?: number      // multiplier
  margin?: number           // mm
  clinicianName?: string
  credentials?: string
  providerNumber?: string
  workPhone?: string
  position?: string
  workplaceName?: string
}

function loadImageAsDataURL(url: string): Promise<{ dataUrl: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const MAX_W = 1240
      const scale = img.naturalWidth > MAX_W ? MAX_W / img.naturalWidth : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight })
    }
    img.onerror = reject
    img.src = url
  })
}

// Storage image via the same-origin proxy so it can be drawn onto a canvas
// without cross-origin tainting.
function loadPdfImage(url: string): Promise<{ dataUrl: string; w: number; h: number }> {
  return loadImageAsDataURL('/api/proxy-image?url=' + encodeURIComponent(url))
}

// The exact letter body sequence, expressed as write()/para() calls.
function flowLetterBody(p: LetterExportParams, write: (text: string, bold?: boolean) => void, para: () => void) {
  const { letterType, common, referral, records, freetext, customSections } = p
  write(common.letterDate || '')
  para()
  write('To:')
  write(common.recipientName || '[Recipient Name]')
  if (common.recipientAddress) {
    common.recipientAddress.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
  }
  para()

  if (letterType !== 'freetext') {
    write(`Re: ${common.patientName || '[Patient Name]'}`, true)
    if (common.dob) write(`DOB: ${common.dob}`, true)
  } else {
    write(`Subject: ${common.patientName || '[Subject]'}`, true)
  }
  para()

  if (letterType === 'referral') {
    write(letterSalutation(common.recipientName))
    para()
    write(`I am writing to refer to you ${common.patientName || '[Patient Name]'}, who was admitted to the ${referral.admissionUnit || '[Unit]'} from the ${formatDateForLetter(referral.admissionDateStart)} to the ${formatDateForLetter(referral.admissionDateEnd)}.`)
    para()
    const age = calculateAgeFromDOB(common.dob)
    const agePart = age !== null ? `${age} year old ` : ''
    const firstName = (common.patientName || '').split(' ')[0] || 'Patient'
    const title = referral.gender === 'male' ? 'Mr.' : referral.gender === 'female' ? 'Ms.' : ''
    write(`Thank you for seeing ${title} ${common.patientName || '[Patient Name]'}. ${firstName} is a ${agePart}${referral.gender || '[gender]'} who presented with ${referral.presentingComplaint || '[presenting complaint]'}.`)
    if (referral.secondParagraph) { para(); write(referral.secondParagraph) }
    para()
    write(`${referral.referralReason || '[reason for referral]'}${referral.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)
    if (referral.showPastMedicalHistory && referral.pastMedicalHistory) {
      para(); write('Past Medical History:', true)
      referral.pastMedicalHistory.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
    }
    if (referral.showMedicationList && referral.medicationList) {
      para(); write('Medication List:', true)
      autoNumberLines(referral.medicationList).split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
    }
    para()
    write('Please do not hesitate to contact me if there are any queries regarding this referral.')
  } else if (letterType === 'records') {
    write('To whom it may concern,')
    para()
    write(`I am writing to request any correspondence or documentation from their previous visits at ${records.recordsLocation || '[Location]'}.`)
    if (records.secondParagraphRecords) { para(); write(records.secondParagraphRecords) }
  } else if (letterType === 'freetext') {
    freetext.freeTextContent.split('\n').map(l => l.trim()).forEach(l => { if (l) write(l); else para() })
  } else if (letterType === 'custom') {
    write(letterSalutation(common.recipientName))
    para()
    customSections.filter(s => s.content.trim()).forEach((s, i) => {
      if (i > 0) para()
      write(`${s.heading}:`, true)
      s.content.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => write(l))
    })
    para()
    write('Please do not hesitate to contact me if you require any further information.')
  }
}

function buildSigLines(p: LetterExportParams): { text: string; bold?: boolean; small?: boolean }[] {
  const sigLines: { text: string; bold?: boolean; small?: boolean }[] = [{ text: 'Thank you and kind regards,' }]
  const nameWithCreds = p.clinicianName ? (p.credentials ? `${p.clinicianName} (${p.credentials})` : p.clinicianName) : ''
  if (nameWithCreds) sigLines.push({ text: nameWithCreds, bold: true })
  const providerLine = [
    p.providerNumber ? `Provider No: ${p.providerNumber}` : '',
    p.workPhone ? `Ph no: ${p.workPhone}` : '',
  ].filter(Boolean).join(' | ')
  if (providerLine) sigLines.push({ text: providerLine })
  if (p.position) sigLines.push({ text: p.position, small: true })
  if (p.workplaceName) sigLines.push({ text: p.workplaceName, small: true })
  return sigLines
}

export async function downloadLetterPDF(p: LetterExportParams) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const PW = 210, PH = 297
  const ML = (p.margin ?? 0) > 0 ? p.margin! : 20
  const MR = ML, CW = PW - ML - MR

  const fs = (p.fontSize ?? 0) > 0 ? p.fontSize! : 11
  const ls = (p.lineSpacing ?? 0) > 0 ? p.lineSpacing! : 1.4
  const LH = fs * 0.3528 * ls
  const PS = LH * 0.5
  const smallFs = Math.max(7, fs - 2)

  let headerImg: { dataUrl: string; w: number; h: number } | null = null
  let footerImg: { dataUrl: string; w: number; h: number } | null = null
  if (p.letterheadHeaderUrl) { try { headerImg = await loadPdfImage(p.letterheadHeaderUrl) } catch { headerImg = null } }
  if (p.letterheadFooterUrl) { try { footerImg = await loadPdfImage(p.letterheadFooterUrl) } catch { footerImg = null } }

  const headerH = headerImg ? (headerImg.h / headerImg.w) * PW : 0
  const footerH = footerImg ? (footerImg.h / footerImg.w) * PW : 0
  const contentTop = headerImg ? headerH + 8 : 20
  const footerY = PH - footerH
  const maxY = footerImg ? footerY - 4 : PH - 15
  const sigZoneBottom = footerImg ? footerY + footerH * 0.42 : maxY

  const stampLetterhead = () => {
    if (headerImg) doc.addImage(headerImg.dataUrl, 'JPEG', 0, 0, PW, headerH)
    if (footerImg) doc.addImage(footerImg.dataUrl, 'JPEG', 0, footerY, PW, footerH)
  }

  let y = contentTop
  stampLetterhead()

  const write = (text: string, bold = false, size = fs) => {
    const segs = parseBoldSegments(text)
    const tokens: { w: string; bold: boolean; italic: boolean; space: boolean }[] = []
    for (const s of segs) {
      for (const part of s.text.split(/(\s+)/)) {
        if (!part) continue
        tokens.push({ w: part, bold: bold || s.bold, italic: s.italic, space: /^\s+$/.test(part) })
      }
    }
    const fontStyle = (b: boolean, i: boolean) => (b && i ? 'bolditalic' : b ? 'bold' : i ? 'italic' : 'normal')
    doc.setFontSize(size)
    const maxX = ML + CW
    let x = ML
    let atLineStart = true
    const startNewLine = () => {
      y += LH
      if (y + LH > maxY) { doc.addPage(); stampLetterhead(); y = contentTop }
      x = ML
      atLineStart = true
    }
    if (y + LH > maxY) { doc.addPage(); stampLetterhead(); y = contentTop }
    for (const tok of tokens) {
      if (tok.space) {
        if (atLineStart) continue
        doc.setFont('helvetica', 'normal')
        x += doc.getTextWidth(tok.w)
        continue
      }
      doc.setFont('helvetica', fontStyle(tok.bold, tok.italic))
      const tw = doc.getTextWidth(tok.w)
      if (!atLineStart && x + tw > maxX) startNewLine()
      doc.text(tok.w, x, y)
      x += tw
      atLineStart = false
    }
    y += LH
  }
  const nl = (n = 1) => { y += PS * n }
  const para = () => nl(2)

  flowLetterBody(p, write, para)

  let sigDataUrl: string | null = null
  if (p.signatureUrl) { try { sigDataUrl = (await loadPdfImage(p.signatureUrl)).dataUrl } catch { sigDataUrl = null } }
  const sigF = ((p.signatureScale ?? 0) > 0 ? p.signatureScale! : 100) / 100
  const sigImgH = sigDataUrl ? 14 * sigF + 3 : 0
  const sigLines = buildSigLines(p)

  const blockH = sigImgH + sigLines.length * LH
  let sy = sigZoneBottom - blockH
  // The signature block is anchored just above the footer, leaving generous
  // whitespace above it (and the signature image has blank space at its own top).
  // Rather than reserve a blank line of clearance, let the body run one line
  // height into that top whitespace, breaking to a second page only when it goes
  // beyond that — squeezing one more body line onto the first page.
  if (sy < y - LH) { doc.addPage(); stampLetterhead(); sy = sigZoneBottom - blockH }
  if (sy < contentTop) sy = contentTop

  const cx = PW / 2
  if (sigDataUrl) {
    try { doc.addImage(sigDataUrl, 'JPEG', cx - (40 * sigF) / 2, sy, 40 * sigF, 14 * sigF) } catch {}
    sy += 14 * sigF + 3
  }
  const smallLH = smallFs * 0.3528 * ls
  for (const line of sigLines) {
    const lineSize = line.small ? smallFs : fs
    const lineAdvance = line.small ? smallLH : LH
    doc.setFont('helvetica', line.bold ? 'bold' : 'normal')
    doc.setFontSize(lineSize)
    doc.text(line.text, cx, sy, { align: 'center' })
    sy += lineAdvance
  }

  const pname = (p.common.patientName || 'letter').replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '-')
  const typeLabel = p.letterType === 'referral' ? 'Referral' : p.letterType === 'records' ? 'RecordsRequest' : 'Letter'
  doc.save(`${typeLabel}_${pname}_${(p.common.letterDate || '').replace(/\//g, '-')}.pdf`)
}

export function openLetterEmail(p: LetterExportParams) {
  const { letterType, common, referral, records, freetext, customSections } = p
  const subject = letterType === 'referral'
    ? `Referral: ${common.patientName || ''} - DOB: ${common.dob || ''}`
    : letterType === 'records'
    ? `Medical Records Request: ${common.patientName || ''}`
    : `Letter: ${common.patientName || ''}`

  const lines: string[] = []
  lines.push(common.letterDate || '')
  lines.push('')
  lines.push('To: ' + (common.recipientName || '[Recipient Name]'))
  if (common.recipientAddress) lines.push(common.recipientAddress)
  lines.push('')
  if (letterType !== 'freetext') {
    lines.push('Re: ' + (common.patientName || '[Patient Name]'))
    if (common.dob) lines.push('DOB: ' + common.dob)
  } else {
    lines.push('Subject: ' + (common.patientName || '[Subject]'))
  }
  lines.push('')
  if (letterType === 'referral') {
    lines.push(letterSalutation(common.recipientName))
    lines.push('')
    lines.push(`I am writing to refer to you ${common.patientName || '[Patient Name]'}, who was admitted to the ${referral.admissionUnit || '[Unit]'} from the ${formatDateForLetter(referral.admissionDateStart)} to the ${formatDateForLetter(referral.admissionDateEnd)}.`)
    lines.push('')
    const age = calculateAgeFromDOB(common.dob)
    const agePart = age !== null ? `${age} year old ` : ''
    const firstName = (common.patientName || '').split(' ')[0] || 'Patient'
    const title = referral.gender === 'male' ? 'Mr.' : referral.gender === 'female' ? 'Ms.' : ''
    lines.push(`Thank you for seeing ${title} ${common.patientName || '[Patient Name]'}. ${firstName} is a ${agePart}${referral.gender || '[gender]'} who presented with ${referral.presentingComplaint || '[presenting complaint]'}.`)
    if (referral.secondParagraph) { lines.push(''); lines.push(referral.secondParagraph) }
    lines.push('')
    lines.push(`${referral.referralReason || '[reason for referral]'}${referral.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}`)
    if (referral.showPastMedicalHistory && referral.pastMedicalHistory) { lines.push(''); lines.push('Past Medical History:'); lines.push(referral.pastMedicalHistory) }
    if (referral.showMedicationList && referral.medicationList) { lines.push(''); lines.push('Medication List:'); lines.push(referral.medicationList) }
    lines.push(''); lines.push('Please do not hesitate to contact me if there are any queries regarding this referral.')
  } else if (letterType === 'records') {
    lines.push('To whom it may concern,')
    lines.push('')
    lines.push(`I am writing to request any correspondence or documentation from their previous visits at ${records.recordsLocation || '[Location]'}.`)
    if (records.secondParagraphRecords) { lines.push(''); lines.push(records.secondParagraphRecords) }
  } else if (letterType === 'freetext') {
    lines.push(freetext.freeTextContent || '')
  } else if (letterType === 'custom') {
    lines.push(letterSalutation(common.recipientName))
    customSections.filter(s => s.content.trim()).forEach(s => {
      lines.push(''); lines.push(`${s.heading}:`)
      s.content.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => lines.push(l))
    })
    lines.push(''); lines.push('Please do not hesitate to contact me if you require any further information.')
  }
  lines.push(''); lines.push('Kind regards,')
  if (p.clinicianName) lines.push(p.clinicianName)
  if (p.credentials) lines.push(p.credentials)

  const body = encodeURIComponent(lines.join('\n'))
  const sub = encodeURIComponent(subject)
  const ua = navigator.userAgent
  const isIOS = /iPhone|iPad/i.test(ua)
  const isAndroid = /Android/i.test(ua)
  const outlookUrl = isIOS
    ? `ms-outlook://compose?subject=${sub}&body=${body}`
    : isAndroid
    ? `ms-outlook://emails/new?subject=${sub}&body=${body}`
    : `https://outlook.office.com/mail/deeplink/compose?subject=${sub}&body=${body}`
  if (isIOS || isAndroid) window.location.href = outlookUrl
  else window.open(outlookUrl, '_blank')
}
