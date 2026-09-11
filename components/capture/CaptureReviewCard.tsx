'use client'

import Modal from '@/components/ui/Modal'
import Input from '@/components/ui/Input'
import type { IntentClassification } from '@/lib/captureIntent'
import type { ActionKey, SuggestedAction } from '@/lib/suggestedActions'
import {
  actionBlocker,
  captureExcerpt,
  INTENT_LABEL,
  TEMPLATE_REASON_LABEL,
  type TemplateReason,
} from '@/lib/captureFlow'

// What the doctor sees after a capture finishes.
//
// Everything that used to be a step — naming the patient, choosing a template —
// has already run by the time this opens. So this card is the ONLY confirmation
// point, and it is shown every time: there is no "don't ask again", because the
// thing being confirmed (which patient, which document) is different on every
// capture and a remembered answer would be a remembered answer to a different
// question.
//
// The tap on an action button IS the confirmation. That puts the burden here:
// each button has to say what it will do before it is pressed, and the one that
// writes over a record has to look different from the ones that make a document.

interface Props {
  open: boolean
  /** `reading` while identity extraction is still out; `ready` once the card
   *  can be acted on. Never a fake progress bar — see below. */
  stage: 'reading' | 'ready'
  classification: IntentClassification | null
  transcript: string
  actions: SuggestedAction[]
  patientName: string
  onPatientNameChange: (v: string) => void
  /** The template a one-tap note will use. Null for a capture whose lead action
   *  is not a note — nothing to show, so nothing is claimed. */
  template: { title: string; reason: TemplateReason } | null
  onChangeTemplate: () => void
  onAction: (key: ActionKey) => void
  onClose: () => void
}

const ACTION_DETAIL: Record<ActionKey, string> = {
  'note': 'Writes a clinical note you can edit before saving',
  'patient-record': 'Updates the fields this capture covers',
  'letter': 'Opens the letter editor with this dictation loaded',
  'discharge-summary': 'Writes the discharge summary for this admission',
  'patient-pdf': 'Updates the record, then downloads the handover sheet',
  'hospital-form': 'Opens your workplace form with this entry',
  'other': 'Choose a template, letter or form yourself',
}

export default function CaptureReviewCard({
  open, stage, classification, transcript, actions,
  patientName, onPatientNameChange, template, onChangeTemplate, onAction, onClose,
}: Props) {
  const review = { transcript, patientName }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={stage === 'reading' ? 'Reading your capture' : 'Ready'}
      maxWidth="md"
      // A stray backdrop tap must not discard a capture that has not been turned
      // into anything yet. The X stays — leaving is deliberate, not accidental.
      dismissible={false}
    >
      <div className="px-5 pb-5 space-y-4">
        {stage === 'reading' ? (
          // Deliberately ONE line, not a checklist of steps ticking over.
          // Transcription already finished in the recording modal; the only work
          // left is reading who this is about. Animating three fake stages would
          // be inventing progress we are not making.
          <div className="py-6 space-y-3" aria-live="polite">
            <p className="text-sm text-[var(--text2)]">Working out who this is about…</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--blue-lt)]">
              <div className="h-full w-1/3 rounded-full bg-[var(--blue)] motion-safe:animate-[capture-scan_1.2s_ease-in-out_infinite]" />
            </div>
          </div>
        ) : (
          <>
            {classification && (
              <div>
                <p className="text-sm text-[var(--text)]">
                  Read as <span className="font-semibold">{INTENT_LABEL[classification.intent]}</span>
                </p>
                {classification.signals.length > 0 && (
                  // "Why did it think that" is the first question asked when it
                  // is wrong, and the doctor is the only one who can tell.
                  <p className="mt-0.5 text-xs text-[var(--text3)]">{classification.signals.slice(0, 2).join(' · ')}</p>
                )}
              </div>
            )}

            {transcript.trim() && (
              <p className="rounded-[var(--r)] bg-[var(--bg)] px-3 py-2 text-xs leading-relaxed text-[var(--text2)]">
                {captureExcerpt(transcript)}
              </p>
            )}

            {/* Solid white, per the house rule — glass never goes on an input. */}
            <Input
              label="Patient"
              value={patientName}
              onChange={e => onPatientNameChange(e.target.value)}
              placeholder="Who is this about?"
              autoComplete="off"
              hint={patientName ? undefined : 'Not named in the capture - type it, or add it later'}
            />

            {template && (
              <div className="flex items-center justify-between gap-3 rounded-[var(--r)] border border-[var(--border)] px-3 py-2">
                <p className="min-w-0 text-xs text-[var(--text2)]">
                  <span className="text-[var(--text3)]">Template</span>{' '}
                  <span className="font-medium text-[var(--text)]">{template.title}</span>{' '}
                  <span className="text-[var(--text3)]">· {TEMPLATE_REASON_LABEL[template.reason]}</span>
                </p>
                <button
                  type="button"
                  onClick={onChangeTemplate}
                  className="shrink-0 text-xs font-medium text-[var(--blue)] underline underline-offset-2"
                >
                  Change
                </button>
              </div>
            )}

            <div className="space-y-2">
              {actions.map(a => {
                const blocker = actionBlocker(a.key, review)
                return (
                  <button
                    key={a.key}
                    type="button"
                    disabled={blocker !== null}
                    onClick={() => onAction(a.key)}
                    className={`w-full rounded-[var(--r)] border px-4 py-3 text-left transition-colors
                      ${blocker !== null
                        ? 'cursor-not-allowed border-[var(--border)] opacity-50'
                        : a.primary
                          ? 'border-transparent bg-[#10b981] text-white hover:bg-[#059669] motion-safe:active:scale-[0.97]'
                          : 'border-[var(--border)] hover:border-[var(--blue)] hover:bg-[var(--blue-lt)] motion-safe:active:scale-[0.97]'}`}
                    style={{ willChange: 'transform' }}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {a.label}
                      {a.overwritesRecord && (
                        // Marked wherever it appears, primary or not. A doctor
                        // moving fast has to be able to tell "make me a
                        // document" from "change the record".
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
                          ${a.primary ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'}`}>
                          Replaces
                        </span>
                      )}
                    </span>
                    <span className={`mt-0.5 block text-xs ${a.primary ? 'text-white/80' : 'text-[var(--text3)]'}`}>
                      {blocker ?? ACTION_DETAIL[a.key]}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Shown every time. Accurate, not reassuring: the audio really is
                gone, and the transcript really is still on disk until this
                capture becomes a document or is discarded. */}
            <p className="text-center text-[11px] leading-relaxed text-[var(--text3)]">
              Audio discarded. Transcript kept until you save or discard it.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
