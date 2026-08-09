// One place for "send this document": attach the PDF, carry a subject line and
// the full body. Used identically by progress notes, letters and hospital forms.
//
// mailto: cannot carry an attachment — that is the protocol, not a gap in the
// app — so the OS share sheet is the only web route that attaches a file.
// Targets differ in what they honour: mail apps map `title` to the subject and
// `text` to the body, but several drop `text` once a file is present. The body
// is therefore also copied to the clipboard so it is never more than a paste
// away.

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
