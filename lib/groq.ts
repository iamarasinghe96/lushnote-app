const BASE_URL = 'https://api.groq.com/openai/v1'
const GENERATION_MODEL = 'llama-3.3-70b-versatile'
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

export async function generateNoteGroq(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  maxTokens?: number,
  timeoutMs = 45000
): Promise<{ content: string; totalTokens: number }> {
  // Groq's free-tier limiter counts estimated input + max_tokens against the
  // per-minute token cap, so short-answer callers (chat) pass a small maxTokens
  // to leave room for a large notes context in the input.
  const estimatedInputTokens = Math.ceil((systemPrompt.length + prompt.length) / 4)
  const max_tokens = maxTokens ?? Math.max(512, 12000 - estimatedInputTokens - 200)

  // Hard timeout so a hanging call fails before the serverless wall (see gemini.ts).
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GENERATION_MODEL,
        max_tokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('Groq request timed out')
    throw err
  } finally {
    clearTimeout(timer)
  }
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
