import type { AnyTemplate, TemplateSection } from '@/types'

// Dictating a psychiatrist note is not the same as recording a session.
//
// Choosing "Start a psychiatrist note" already declares what is being written,
// and the modal then hands the doctor a checklist of topics to cover. Asking
// them to pick a template afterwards makes them state the same intention twice,
// and offers 116 choices for a decision already made.
//
// So dictation always uses Comprehensive Psychology Note. That creates a
// problem the picker was hiding: the checklist and the template disagree.

/**
 * The topics the Dictate modal asks the doctor to cover, mapped to the note
 * field each belongs in. This is the contract — if the modal asks for it, the
 * note must have somewhere to put it.
 *
 * Three of them (medications, scales, referrals) are NOT sections of
 * Comprehensive Psychology Note, so before this a doctor was told to dictate
 * their medications and their PHQ-9 score into a template with nowhere to hold
 * either. All three are first-class note fields with their own labels, their
 * own rows in the edit page and their own headings in the PDF — they were
 * simply missing from that template's section list.
 */
export const DICTATION_CORE_KEYS = [
  'presentation', 'history', 'medications', 'mse',
  'content', 'scales', 'risk', 'summary', 'nextsteps',
] as const

/** Canonical note order, so an added section lands where the edit page, the
 *  preview and the PDF already expect it rather than at the end. */
const CORE_ORDER = [
  'diagnosis', 'presentation', 'history', 'medications', 'mse',
  'content', 'scales', 'risk', 'referrals', 'summary', 'nextsteps',
]

const DEFAULT_LABELS: Record<string, string> = {
  presentation: 'Current Presentation',
  history: 'Past Medical & Psychiatric History',
  medications: 'Medications',
  mse: 'Mental State Examination',
  content: 'Session Content',
  scales: 'Rating Scales',
  risk: 'Risk Assessment',
  referrals: 'Referrals & Correspondence',
  summary: 'Session Summary',
  nextsteps: 'Next Steps',
}

/** The catch-all. Not a core field, so it rides in `extraSections` and carries
 *  its own label — a note keeps it even if the template is later deleted. */
export const OTHER_TOPICS_KEY = 'other-topics'
export const OTHER_TOPICS_LABEL = 'Other Topics Dictated'

/**
 * Appended to the template's own prompt. The marker list alone says a section
 * exists; it does not say this one is a bin for whatever the checklist has no
 * home for, and a model given a heading it has no rule for will leave it empty.
 *
 * Spoken clinical detail that matches nothing is exactly what must NOT be
 * dropped — a doctor who said it expects to see it.
 */
export const CATCHALL_INSTRUCTION = `
DICTATION — NOTHING SPOKEN MAY BE LOST.
This note was dictated aloud, so it wanders: the doctor may mention a collateral
call, an allergy, a carer's concern, a legal or safeguarding matter, or a
follow-up that belongs to none of the sections above.
- Put every such statement under [${OTHER_TOPICS_KEY}], verbatim or near enough
  that its meaning is unchanged, one per line under a short bold label.
- Never discard a clinical statement because no section fits it, and never
  stretch a section's meaning to absorb one that does not belong there.
- Leave [${OTHER_TOPICS_KEY}] out entirely if everything the doctor said already
  had a home. An empty catch-all is correct; a lost sentence is not.`.trim()

function sectionFor(key: string, existing: TemplateSection[]): TemplateSection {
  return existing.find(s => s.key === key)
    ?? { key, label: DEFAULT_LABELS[key] ?? key, core: true }
}

/**
 * Comprehensive Psychology Note, widened to hold everything the dictation
 * checklist asks for, plus a catch-all for everything it does not.
 *
 * Derived rather than edited into `data/clinical-templates.json`: the stored
 * template is what a doctor gets when they pick it deliberately from the picker
 * in any other pathway, and changing it there would rewrite the section order
 * of notes already saved against it. This shape belongs to dictation alone.
 *
 * Labels already on the base template win, so a section it defines keeps its own
 * wording and only genuinely-missing ones take a default.
 */
export function buildDictationTemplate(base: AnyTemplate): AnyTemplate {
  const existing: TemplateSection[] = ('sections' in base && base.sections) ? base.sections : []

  // Keep any section the template already had, even one the checklist omits —
  // widening must never silently drop part of the template it is widening.
  const keys = new Set<string>([...existing.map(s => s.key), ...DICTATION_CORE_KEYS, 'referrals'])
  const ordered = CORE_ORDER.filter(k => keys.has(k))
  // Anything the template carried that isn't a known core field keeps its place
  // at the end rather than being discarded.
  const unknown = existing.filter(s => !CORE_ORDER.includes(s.key) && s.key !== OTHER_TOPICS_KEY)

  const sections: TemplateSection[] = [
    ...ordered.map(k => sectionFor(k, existing)),
    ...unknown,
    { key: OTHER_TOPICS_KEY, label: OTHER_TOPICS_LABEL, core: false },
  ]

  return {
    ...base,
    sections,
    prompt: `${(base.prompt ?? '').trim()}\n\n${CATCHALL_INSTRUCTION}`.trim(),
  } as AnyTemplate
}
