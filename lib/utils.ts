import { WP_THEMES } from '@/types'

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
    .replace(/'/g, '&#x27;')
}
