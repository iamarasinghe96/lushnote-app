import type { User, NoteLength } from '@/types'

const LENGTH_INSTRUCTION: Record<NoteLength, string> = {
  brief:    'Generate brief notes using dot points and short phrases. Most important information only.',
  balanced: 'Generate notes with full sentences and appropriate clinical detail.',
  detailed: 'Generate comprehensive, thorough notes. Use quotes and include explanations.',
}

export function getPersonalisationPrefix(profile: User, noteLength: NoteLength): string {
  const p = profile.personalisation
  const parts: string[] = []

  if (p?.professionalIdentity?.trim()) {
    parts.push(`Professional identity: ${p.professionalIdentity.trim()}`)
  }
  if (p?.treatmentApproaches?.trim()) {
    parts.push(`Treatment approaches used: ${p.treatmentApproaches.trim()}`)
  }
  if (p?.documentStyle?.trim()) {
    parts.push(`Document style preferences: ${p.documentStyle.trim()}`)
  }

  parts.push(LENGTH_INSTRUCTION[noteLength])

  return parts.join('\n\n')
}
