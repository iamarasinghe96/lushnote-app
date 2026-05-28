import { WP_THEMES, type Note } from '@/types'

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

function formatContent(text: string): string {
  const lines = escapeHtml(text).split('\n')
  let html = '', inOl = false, inUl = false
  lines.forEach(line => {
    if (/^\d+\.\s/.test(line)) {
      if (!inOl) { html += '<ol>'; inOl = true }
      if (inUl) { html += '</ul>'; inUl = false }
      html += `<li>${line.replace(/^\d+\.\s/, '')}</li>`
    } else if (/^[-•]\s/.test(line)) {
      if (!inUl) { html += '<ul>'; inUl = true }
      if (inOl) { html += '</ol>'; inOl = false }
      html += `<li>${line.replace(/^[-•]\s/, '')}</li>`
    } else {
      if (inOl) { html += '</ol>'; inOl = false }
      if (inUl) { html += '</ul>'; inUl = false }
      if (line.trim()) html += `<p>${line}</p>`
    }
  })
  if (inOl) html += '</ol>'
  if (inUl) html += '</ul>'
  return html
}

export function buildPreviewHTML(f: Partial<Note>): string {
  const sections = PREVIEW_FIELD_ORDER
    .filter(key => (f as Record<string, string>)[key]?.trim())
    .map(key =>
      `<div class="preview-section"><h3>${FIELD_LABELS[key]}</h3><div class="preview-content">${formatContent((f as Record<string, string>)[key])}</div></div>`
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
