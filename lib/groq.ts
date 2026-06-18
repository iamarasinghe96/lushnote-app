const BASE_URL = 'https://api.groq.com/openai/v1'
const GENERATION_MODEL = 'llama-3.3-70b-versatile'
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export async function generateNoteGroq(
  prompt: string,
  systemPrompt: string,
  apiKey: string
): Promise<{ content: string; totalTokens: number }> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`${res.status}: ${err?.error?.message ?? res.statusText}`)
  }
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { total_tokens?: number }
  }
  return {
    content: data.choices?.[0]?.message?.content ?? '',
    totalTokens: data.usage?.total_tokens ?? 0,
  }
}

export async function transcribeAudioGroq(audioBlob: FormData, apiKey: string): Promise<string> {
  audioBlob.set('model', TRANSCRIPTION_MODEL)
  audioBlob.set('response_format', 'text')
  const res = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: audioBlob,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`${res.status}: ${err?.error?.message ?? res.statusText}`)
  }
  return res.text()
}

export function isRateLimited(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('429')
  }
  return false
}

export function parseGroqWaitSeconds(errorMessage: string): number {
  const match = errorMessage.match(/try again in (?:(\d+)h\s*)?(?:(\d+)m\s*)?(\d+\.?\d*)s/i)
  if (!match) return 60
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseFloat(match[3] || '0')
  return hours * 3600 + minutes * 60 + Math.ceil(seconds)
}
