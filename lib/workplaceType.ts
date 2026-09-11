import type { WorkplaceType } from '@/types'

// Guessing the setting from the workplace name.
//
// A doctor who has just typed "Albury Wodonga Health - Albury Campus" has
// already told us it is a hospital; making them say it again in the next field
// is asking twice. But a guess is only worth making when it is nearly certain —
// a wrong setting is worse than an unanswered one, because the doctor has to
// notice it was answered wrongly before they can fix it.
//
// So this returns null far more often than it guesses, and the caller leaves the
// field alone when it does.

/** The single list. Onboarding and Settings both render it; duplicating it was
 *  how the two could have drifted apart. */
export const WORKPLACE_TYPES: readonly WorkplaceType[] = [
  'Private Practice',
  'Hospital',
  'Community Mental Health',
  'Telehealth',
  'Other',
] as const

/**
 * Ordered, and the order is load-bearing.
 *
 * "Community Mental Health" contains "health", and an Australian hospital is
 * very often "<Place> Health" — so the community markers must be tested before
 * the hospital ones or every CMHT would be read as a hospital.
 */
const RULES: { type: WorkplaceType; markers: string[] }[] = [
  {
    type: 'Telehealth',
    markers: ['telehealth', 'telepsychiatry', 'telemedicine', 'online clinic', 'virtual clinic'],
  },
  {
    type: 'Community Mental Health',
    markers: [
      'community mental health', 'community health', 'cmht', 'camhs',
      'headspace', 'community care', 'mental health team',
    ],
  },
  {
    type: 'Hospital',
    markers: [
      'hospital', 'health service', 'health network', 'infirmary',
      'medical centre', 'medical center', 'health district', 'base health',
      // "<Place> Health" on its own — checked last within this group because it
      // is the loosest of them.
      ' health',
    ],
  },
  {
    type: 'Private Practice',
    markers: [
      'private practice', 'consulting rooms', 'psychiatry', 'psychology',
      'psychiatrist', 'psychologist', 'specialist centre', 'specialist center',
      'clinic', 'practice', 'rooms',
    ],
  },
]

/**
 * The setting this name implies, or null when nothing matches confidently.
 *
 * Null is the common answer and the right one: the caller keeps whatever the
 * field already shows, and the doctor picks for themselves.
 */
export function inferWorkplaceType(name: string): WorkplaceType | null {
  // Pad so a leading-edge marker like " health" can match the first word too.
  const haystack = ` ${(name || '').toLowerCase().replace(/\s+/g, ' ').trim()} `
  if (haystack.trim().length < 3) return null

  for (const rule of RULES) {
    if (rule.markers.some(m => haystack.includes(m))) return rule.type
  }
  return null
}
