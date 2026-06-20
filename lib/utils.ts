import { WP_THEMES, type Note, type AnyTemplate, type LetterType, type LetterCommonFields, type ReferralFields, type RecordsFields, type FreetextFields } from '@/types'

// Daily quota date aligned to Google's free-tier reset (US Pacific midnight),
// returned as YYYY-MM-DD. Using UTC here would reset hours early/late and
// diverge from the limit Google actually enforces.
export function quotaDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

export function getInitials(displayName: string): string {
  if (!displayName) return 'LN'
  const cleaned = displayName.replace(/^(doctor|dr\.?)\s+/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

export function applyWorkspaceTheme(themeIndex: number) {
  const theme = WP_THEMES[themeIndex] || WP_THEMES[0]
  document.documentElement.style.setProperty('--blue', theme.primary)
  document.documentElement.style.setProperty('--blue-dk', theme.dk)
  document.documentElement.style.setProperty('--blue-lt', theme.lt)
}

export function openSettings(tab: string): void {
  window.location.href = '/settings?tab=' + tab
}

export function toOrganizationKey(workplaceName: string): string {
  return workplaceName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function detectIdPattern(example: string): {
  regex: string
  template: string
  description: string
} | null {
  if (!example) return null

  const tokens: Array<{ type: 'digit' | 'alpha' | 'sep'; chars: string }> = []

  for (const ch of example) {
    const type = /[0-9]/.test(ch) ? 'digit' : /[A-Za-z]/.test(ch) ? 'alpha' : 'sep'
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) {
      last.chars += ch
    } else {
      tokens.push({ type, chars: ch })
    }
  }

  if (tokens.length === 0) return null

  let regex = '^'
  let template = ''
  const parts: string[] = []

  for (const token of tokens) {
    const n = token.chars.length
    if (token.type === 'digit') {
      regex += `\\d{${n}}`
      template += '#'.repeat(n)
      parts.push(`${n} digit${n === 1 ? '' : 's'}`)
    } else if (token.type === 'alpha') {
      regex += `[A-Za-z]{${n}}`
      template += 'A'.repeat(n)
      parts.push(`${n} letter${n === 1 ? '' : 's'}`)
    } else {
      regex += token.chars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      template += token.chars
    }
  }

  regex += '$'

  return { regex, template, description: parts.join(' + ') }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const FIELD_LABELS: Record<string, string> = {
  patient: 'Patient', reg_number: 'Reg Number', date: 'Date', time: 'Time',
  clinician: 'Clinician', session_number: 'Session Number', attendance: 'Attendance',
  diagnosis: 'Diagnosis', presentation: 'Presentation', history: 'History',
  medications: 'Medications', mse: 'Mental State Examination', content: 'Session Content',
  scales: 'Rating Scales', risk: 'Risk Assessment', referrals: 'Referrals & Correspondence',
  summary: 'Summary', nextsteps: 'Next Steps',
}

const PREVIEW_FIELD_ORDER = [
  'patient', 'reg_number', 'date', 'time', 'clinician', 'session_number', 'attendance',
  'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content', 'scales',
  'risk', 'referrals', 'summary', 'nextsteps',
]

function applyInlineBold(line: string): string {
  return line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

function formatContent(text: string): string {
  const lines = escapeHtml(text).split('\n')
  let html = '', inOl = false
  lines.forEach(line => {
    const subheading = line.match(/^#{1,3}\s+(.+)/)
    if (subheading) {
      if (inOl) { html += '</ol>'; inOl = false }
      html += `<p style="font-weight:600;margin-top:0.75em;margin-bottom:0.15em;">${applyInlineBold(subheading[1])}</p>`
    } else if (/^\d+\.\s/.test(line)) {
      if (!inOl) { html += '<ol>'; inOl = true }
      html += `<li>${applyInlineBold(line.replace(/^\d+\.\s/, ''))}</li>`
    } else if (/^[-•]\s/.test(line)) {
      if (!inOl) { html += '<ol>'; inOl = true }
      html += `<li>${applyInlineBold(line.replace(/^[-•]\s/, ''))}</li>`
    } else {
      if (inOl) { html += '</ol>'; inOl = false }
      if (line.trim()) html += `<p>${applyInlineBold(line)}</p>`
    }
  })
  if (inOl) html += '</ol>'
  return html
}

const NOTE_TEXT_LABELS: Record<string, string> = {
  patient: 'PATIENT', reg_number: 'REG NUMBER', date: 'DATE', time: 'TIME',
  clinician: 'CLINICIAN', session_number: 'SESSION NUMBER', attendance: 'ATTENDANCE',
  diagnosis: 'DIAGNOSIS', presentation: 'PRESENTATION', history: 'HISTORY',
  medications: 'MEDICATIONS', mse: 'MENTAL STATE EXAMINATION', content: 'SESSION CONTENT',
  scales: 'RATING SCALES', risk: 'RISK ASSESSMENT', referrals: 'REFERRALS & CORRESPONDENCE',
  summary: 'SUMMARY', nextsteps: 'NEXT STEPS',
}

const NOTE_TEXT_ORDER = [
  'patient', 'reg_number', 'date', 'time', 'clinician', 'session_number', 'attendance',
  'diagnosis', 'presentation', 'history', 'medications', 'mse', 'content', 'scales',
  'risk', 'referrals', 'summary', 'nextsteps',
]

export function buildNoteText(f: Partial<Note>): string {
  return NOTE_TEXT_ORDER
    .map(key => {
      const val = (f as Record<string, string>)[key]
      if (!val || !val.trim()) return ''
      return `${NOTE_TEXT_LABELS[key]}\n${val.trim()}`
    })
    .filter(Boolean)
    .join('\n\n')
}

export function buildCoverLetterEmail(
  f: Partial<Note>,
  profile: { displayName?: string; credentials?: string; emailPretext?: string }
): string {
  const pretext = profile.emailPretext || 'I reviewed this patient today and wanted to share the following progress note.'
  const body = buildNoteText(f)
  const sign = [profile.displayName, profile.credentials].filter(Boolean).join('\n')
  return `${pretext}\n\n${body}\n\nRegards,\n${sign}`
}

export function formatDateForLetter(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) return '[Date]'
  const parts = dateStr.split('/')
  if (parts.length !== 3) return dateStr
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]
  const day = parseInt(parts[0], 10)
  const month = months[parseInt(parts[1], 10) - 1] || '[Month]'
  const suffix = (d: number) => {
    if (d > 3 && d < 21) return 'th'
    switch (d % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }
  return `${day}${suffix(day)} of ${month} ${parts[2]}`
}

export function calculateAgeFromDOB(dob: string): number | null {
  if (!dob || dob.length !== 10) return null
  const parts = dob.split('/')
  if (parts.length !== 3) return null
  const d = new Date(
    parseInt(parts[2], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[0], 10)
  )
  if (isNaN(d.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - d.getFullYear()
  if (
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate())
  ) age--
  return age
}

export function buildLetterPreviewHTML(params: {
  letterType: LetterType
  common: LetterCommonFields
  referral?: ReferralFields
  records?: RecordsFields
  freetext?: FreetextFields
  letterheadHeaderUrl?: string | null
  letterheadFooterUrl?: string | null
  signatureUrl?: string | null
  signatureScale?: number
  fontSize?: number
  lineHeight?: number
  margin?: number
  clinicianName?: string
  credentials?: string
  providerNumber?: string
  workPhone?: string
  position?: string
  workplaceName?: string
}): string {
  const {
    letterType, common, referral, records, freetext,
    letterheadHeaderUrl, letterheadFooterUrl,
    signatureUrl, signatureScale, fontSize, lineHeight, margin, clinicianName, credentials,
    providerNumber, workPhone, position, workplaceName,
  } = params

  const baseFont = fontSize && fontSize > 0 ? fontSize : 11
  const baseLine = lineHeight && lineHeight > 0 ? lineHeight : 1.4
  const baseMargin = margin && margin > 0 ? margin : 20
  const smallFont = Math.max(8, baseFont - 1)

  const headerHtml = letterheadHeaderUrl
    ? `<img src="${escapeHtml(letterheadHeaderUrl)}" style="width:100%;display:block;" alt="Header" />`
    : `<div style="padding:14px 24px;border-bottom:2px solid #0072BB;display:flex;justify-content:space-between;align-items:center;">
         <strong style="font-size:15px;color:#1e293b;">${escapeHtml(clinicianName || 'LushNote')}</strong>
         ${credentials ? `<span style="font-size:11px;color:#64748b;">${escapeHtml(credentials)}</span>` : ''}
       </div>`

  const footerHtml = letterheadFooterUrl
    ? `<div style="margin-top:-14mm;position:relative;z-index:1;"><img src="${escapeHtml(letterheadFooterUrl)}" style="width:100%;display:block;" alt="Footer" /></div>`
    : `<div style="padding:8px 24px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;text-align:center;">
         ${escapeHtml(clinicianName || '')}${credentials ? ', ' + escapeHtml(credentials) : ''}
       </div>`

  const sigHeight = Math.round(50 * ((signatureScale && signatureScale > 0 ? signatureScale : 100) / 100))
  const signatureHtml = signatureUrl
    ? `<img src="${escapeHtml(signatureUrl)}" style="height:${sigHeight}px;object-fit:contain;display:block;margin:0 auto 4px;" alt="Signature" />`
    : ''

  const recipientBlock = `
    <p style="margin:0 0 4px;">${escapeHtml(common.letterDate || '')}</p><br>
    <p style="margin:0 0 2px;"><strong>To:</strong></p>
    <p style="margin:0 0 2px;">${escapeHtml(common.recipientName || '[Recipient Name]')}</p>
    ${common.recipientAddress
      ? `<p style="margin:0 0 16px;white-space:pre-line;">${escapeHtml(common.recipientAddress)}</p>`
      : '<br>'}
  `

  const reBlock = letterType !== 'freetext'
    ? `<p style="font-weight:700;margin:0 0 4px;">Re: ${escapeHtml(common.patientName || '[Patient Name]')}</p>
       ${common.dob ? `<p style="font-weight:700;margin:0 0 16px;">DOB: ${escapeHtml(common.dob)}</p>` : '<br>'}`
    : `<p style="font-weight:700;margin:0 0 16px;">Subject: ${escapeHtml(common.patientName || '[Subject]')}</p>`

  let bodyHtml = ''

  if (letterType === 'referral' && referral) {
    const title = referral.gender === 'male' ? 'Mr.' : referral.gender === 'female' ? 'Ms.' : ''
    const firstName = (common.patientName || '').split(' ')[0] || 'Patient'
    const age = calculateAgeFromDOB(common.dob)
    const agePart = age !== null ? `${age} year old ` : ''
    bodyHtml = `
      <p>To Dr. ${escapeHtml(referral.doctorName || '[Doctor Name]')},</p>
      <p>I am writing to refer to you ${escapeHtml(common.patientName || '[Patient Name]')}, who was admitted to the ${escapeHtml(referral.admissionUnit || '[Unit]')} from the ${formatDateForLetter(referral.admissionDateStart)} to the ${formatDateForLetter(referral.admissionDateEnd)}.</p>
      <p>Thank you for seeing ${title} ${escapeHtml(common.patientName || '[Patient Name]')}. ${escapeHtml(firstName)} is a ${agePart}${escapeHtml(referral.gender || '[gender]')} who presented with ${escapeHtml(referral.presentingComplaint || '[presenting complaint]')}.</p>
      ${referral.secondParagraph ? `<p>${escapeHtml(referral.secondParagraph)}</p>` : ''}
      <p>${escapeHtml(referral.referralReason || '[reason for referral]')}${referral.dischargeSummaryAttached ? ' A discharge summary is attached.' : ''}</p>
      ${referral.showPastMedicalHistory && referral.pastMedicalHistory
        ? `<p><strong><u>Past Medical History:</u></strong></p><p style="white-space:pre-line;">${escapeHtml(referral.pastMedicalHistory)}</p>`
        : ''}
      ${referral.showMedicationList && referral.medicationList
        ? `<p><strong><u>Medication List:</u></strong></p><p style="white-space:pre-line;">${escapeHtml(referral.medicationList)}</p>`
        : ''}
      <p>Please do not hesitate to contact me if there are any queries regarding this referral.</p>
    `
  } else if (letterType === 'records' && records) {
    bodyHtml = `
      <p>To whom it may concern,</p>
      <p>I am writing to request any correspondence or documentation from their previous visits at ${escapeHtml(records.recordsLocation || '[Location]')}. It would be greatly appreciated if any correspondence, treatments, and recent investigations could be provided to assist with their ongoing management.</p>
      ${records.secondParagraphRecords ? `<p>${escapeHtml(records.secondParagraphRecords)}</p>` : ''}
    `
  } else if (letterType === 'freetext' && freetext) {
    bodyHtml = freetext.freeTextContent
      ? freetext.freeTextContent.split('\n')
          .map(l => l.trim() ? `<p>${escapeHtml(l)}</p>` : '<br>').join('')
      : '<p style="color:#94a3b8;">[Letter content will appear here]</p>'
  }

  return `
    <div style="font-family:Arial,sans-serif;font-size:${baseFont}pt;line-height:${baseLine};color:#000;background:#fff;min-height:297mm;display:flex;flex-direction:column;max-width:210mm;">
      ${headerHtml}
      <div style="padding:8mm ${baseMargin}mm 0;flex:1;display:flex;flex-direction:column;">
        <div>
          ${recipientBlock}
          ${reBlock}
          ${bodyHtml}
        </div>
        <div style="margin-top:auto;padding-top:16px;text-align:center;position:relative;z-index:2;">
          ${signatureHtml}
          <p style="margin:0 0 2px;">Thank you and kind regards,</p>
          <p style="margin:0 0 2px;font-weight:700;">${escapeHtml(clinicianName || '')}${credentials ? ` (${escapeHtml(credentials)})` : ''}</p>
          ${(providerNumber || workPhone) ? `<p style="margin:0 0 2px;">${providerNumber ? 'Provider No: ' + escapeHtml(providerNumber) : ''}${providerNumber && workPhone ? ' | ' : ''}${workPhone ? 'Ph no: ' + escapeHtml(workPhone) : ''}</p>` : ''}
          ${position ? `<p style="margin:0 0 2px;font-size:${Math.max(7, baseFont - 2)}pt;">${escapeHtml(position)}</p>` : ''}
          ${workplaceName ? `<p style="margin:0;font-size:${Math.max(7, baseFont - 2)}pt;">${escapeHtml(workplaceName)}</p>` : ''}
        </div>
      </div>
      ${footerHtml}
    </div>
  `
}

export function formatDob(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8)
  if (digits.length >= 5) return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4)
  if (digits.length >= 3) return digits.slice(0, 2) + '/' + digits.slice(2)
  return digits
}

// Builds the full generation prompt for a template, appending any saved
// custom-field instructions so derived templates always include those sections.
export function buildTemplatePrompt(template: AnyTemplate): string {
  const base = (template.prompt ?? '').trim()
  if (!('customFields' in template) || !template.customFields?.length) return base

  const additions = template.customFields.map(f => {
    const targetLabel = FIELD_LABELS[f.targetField] ?? f.targetField
    return `\n\nADDITIONAL SECTION - "${f.label}" (incorporate this content within the ${targetLabel} section):\n${f.systemPrompt.trim()}`
  }).join('')

  return (base + additions).trim()
}

export function buildPreviewHTML(f: Partial<Note>): string {
  const sections = PREVIEW_FIELD_ORDER
    .filter(key => (f as Record<string, string>)[key]?.trim())
    .map(key =>
      `<div class="preview-section" data-field="${key}"><h3>${FIELD_LABELS[key]}</h3><div class="preview-content">${formatContent((f as Record<string, string>)[key])}</div></div>`
    )
    .join('')

  if (!sections) return '<div class="preview-empty"><p>Your note preview will appear here as you fill in the fields.</p></div>'

  return `<div class="preview-note">
    <div class="preview-header">
      <h2>${escapeHtml(f.patient || 'Patient Name')}</h2>
      <div class="preview-meta">${[f.date, f.time, f.clinician].filter(Boolean).map(v => escapeHtml(v!)).join(' · ')}</div>
      ${f.reg_number ? `<div class="preview-reg">ID: ${escapeHtml(f.reg_number)}</div>` : ''}
    </div>
    ${sections}
  </div>`
}