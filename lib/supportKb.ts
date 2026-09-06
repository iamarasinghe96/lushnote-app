// Shared between the AI assistant (still on the FAB) and support triage (now in
// Settings). Both send the same knowledge base to /api/chat, so it lives in one
// place rather than being duplicated across two trees that can drift apart.

export interface SupportTopic {
  key: string
  label: string
  prompt: string
}

export const LUSHNOTE_KB = `LushNote is a clinical note builder for clinicians.
Features: 116 clinical note templates, voice recording and transcription, AI note generation, patient management, referral/records/custom letters, hospital progress-note forms, and PDF/clipboard/email/Share export.
API: Users bring their own Gemini API key (free from aistudio.google.com) and optionally a Groq key.
Gemini limit: 20 notes/day free tier. A Groq key extends this significantly.
Templates: 116 built-in templates across Progress Notes, Assessments, Therapy Notes, Risk & Safety. Create your own in Settings > Templates.
Export: PDF (formatted A4), clipboard copy, email, and Share (attaches the PDF file). Print produces the same PDF as the download.
Personalisation: Set your professional identity, treatment approaches, and document style in Settings > Personalisation.
Common issues: Generation fails → check your API key in Settings > API Keys. Recording won't start → check microphone permissions in your browser settings. Recording stops when the phone is locked → iOS suspends web apps when the screen turns off, so keep the screen on during a session.

LushNote official policy (Terms of Service & Privacy Policy) — this is the ONLY source of truth for any privacy, data, security, storage, or terms question. Full policy: https://www.lushnote.com.au/terms
- Audio recordings: audio is streamed for transcription, converted to text, then immediately discarded. The audio file is NEVER stored, uploaded, or archived. Only the resulting transcript TEXT is kept, saved as part of the note in your account; you can review, edit, or delete it like any other note content.
- Clinical notes & letters: stored securely and encrypted, accessible only by you. No LushNote team member, developer, or administrator can view your patient data — there is no admin view.
- AI training: your notes, transcripts, and patient information are NEVER used to train or improve any AI model. Data is sent to AI providers only to fulfil your immediate request.
- Transcript redaction: optional (Settings > Transcripts) — removes patient names, DOB, phone numbers, and other identifiers before anything is sent to an AI provider.
- Account deletion: delete your account any time from Settings > Profile; all notes, patient profiles, and account details are permanently and irreversibly removed (no backups).
- Compliance: designed to comply with the Australian Privacy Act 1988 (Cth) and the Australian Privacy Principles; governed by Australian law.
- API keys: your Gemini/Groq keys are stored securely and used only for AI requests on your behalf.
- Contact: admin@lushnote.com.au.`
export const SUPPORT_TOPICS: SupportTopic[] = [
  { key: 'bug', label: 'Report a bug', prompt: 'Please describe the bug in a few sentences — what you did, what happened, and paste any error message you saw.' },
  { key: 'feature', label: 'Feature or UX suggestion', prompt: "Great — tell us your idea in a few sentences: what you'd like and why it would help." },
  { key: 'question', label: 'Ask a question', prompt: "Sure — describe your question in a sentence or two and we'll help." },
  { key: 'account', label: 'Account or privacy', prompt: 'Please describe your account or privacy question in a few sentences.' },
  { key: 'other', label: 'Something else', prompt: 'Please describe what you need help with, and paste any error you saw.' },
]

// Short chime when a new human reply arrives while the support chat is closed.
export function playSupportChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.value = 880
    o.connect(g); g.connect(ctx.destination)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    o.start(); o.stop(ctx.currentTime + 0.36)
    o.onended = () => ctx.close()
  } catch { /* audio not available */ }
}
