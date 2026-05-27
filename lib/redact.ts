import type { TranscriptPrivacy } from '@/types'

export function applyTranscriptRedactions(
  text: string,
  privacy: TranscriptPrivacy
): string {
  let result = text

  if (privacy.redactNames) {
    result = result.replace(
      /\b(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Miss|Prof\.?)\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)?\b/g,
      '[NAME]'
    )
  }

  if (privacy.redactDOB) {
    result = result.replace(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, '[DOB]')
    result = result.replace(
      /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
      '[DOB]'
    )
  }

  if (privacy.redactOther) {
    result = result.replace(/\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]')
    result = result.replace(/\b(\+?61|0)[2-9]\d{8}\b/g, '[PHONE]')
    result = result.replace(
      /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Court|Ct|Place|Pl|Lane|Ln)\b/gi,
      '[ADDRESS]'
    )
  }

  return result
}
