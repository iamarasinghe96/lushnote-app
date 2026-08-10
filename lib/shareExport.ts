// One place for "send this document": attach the PDF, carry a subject line and a
// short cover note. Used identically by progress notes, letters and hospital forms.
//
// mailto: cannot carry an attachment — that is the protocol, not a gap in the
// app — so the OS share sheet is the only web route that attaches a file.
// Targets differ in what they honour: mail apps map `title` to the subject and
// `text` to the body, but several drop `text` once a file is present. The body
// is therefore also copied to the clipboard so it is never more than a paste
// away.

export interface CoverNoteParams {
  docLabel: string                              // "Progress Note", "Referral Letter", the form's name…
  recipientName?: string                        // letters address a named recipient
  intro?: string                                // the clinician's own emailPretext, if they set one
  details: { label: string; value?: string }[]  // patient identifiers, empty ones dropped
  clinicianName?: string
  credentials?: string
}

// The document itself is attached, so the body is a cover note, not a second copy
// of the note. Detail lines carry a bullet because some mail composers (Outlook
// mobile among them) paste shared text as HTML and swallow the newlines — with a
// bullet the identifiers stay readable even when they run together.
export function buildCoverNote(p: CoverNoteParams): string {
  const lines: string[] = [
    `Dear ${p.recipientName || 'Colleague'},`,
    '',
    p.intro || `Please find attached the ${p.docLabel} for the patient below.`,
    '',
  ]
  for (const d of p.details) if (d.value && d.value.trim()) lines.push(`• ${d.label}: ${d.value.trim()}`)
  lines.push('', `Attached: ${p.docLabel} (PDF)`, '', 'Regards,')
  if (p.clinicianName) lines.push(p.clinicianName)
  if (p.credentials) lines.push(p.credentials)
  return lines.join('\n')
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

// Returns false when the platform can't share files at all, so the caller falls
// back to download + mailto. A user cancel counts as handled.
export async function shareFile(file: File, subject: string, body: string): Promise<boolean> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (typeof nav.share !== 'function') return false
  if (nav.canShare && !nav.canShare({ files: [file] })) return false
  try {
    await navigator.share({ files: [file], title: subject, text: body })
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') return false
  }
  return true
}

export function openMailto(subject: string, body: string): void {
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export const SHARE_TOAST = {
  shared: 'PDF attached · body copied — paste it if the app leaves it blank',
  sharedNoCopy: 'PDF attached — pick your email app',
  mailto: 'PDF downloaded — attach it to the email',
  failed: 'Could not share the PDF.',
}
