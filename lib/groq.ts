const BASE_URL = 'https://api.groq.com/openai/v1'
const GENERATION_MODEL = 'llama-3.3-70b-versatile'
const TRANSCRIPTION_MODEL = 'whisper-large-v3-turbo'

// Groq decommissions models on a published date, after which the name simply
// stops being served. Gemini already survives that by asking the key what it can
// run; without the same here, the day llama-3.3-70b-versatile retires every Groq
// call dies with a hard-coded name and no way back.
const resolvedGroqModel = new Map<string, string>()

function isModelGone(status: number, message: string): boolean {
  if (status === 404) return true
  return status === 400 && /does not exist|model_not_found|decommission|deprecat/i.test(message)
}

// Pick the closest live model to the one that vanished. Text wants the largest
// general-purpose chat model; transcription wants Whisper. Nothing is ranked by a
// version number written here, so the next retirement resolves the same way.
function scoreGroqModel(id: string, kind: 'text' | 'transcribe'): number {
  const n = id.toLowerCase()
  if (kind === 'transcribe') {
    if (!n.includes('whisper')) return -1
    return 10 + (n.includes('turbo') ? 20 : 0) + (n.includes('large') ? 10 : 0)
  }
  if (/whisper|tts|guard|embed|vision|moderation/.test(n)) return -1
  const size = n.match(/(\d+)\s*b\b/)
  return (n.includes('versatile') ? 40 : 0)
    + (size ? Math.min(Number(size[1]), 500) : 0)
    - (/preview|deprecated/.test(n) ? 50 : 0)
}

async function pickGroqModel(apiKey: string, failed: string, kind: 'text' | 'transcribe'): Promise<string | null> {
  const cacheKey = `${apiKey}:${failed}`
  const cached = resolvedGroqModel.get(cacheKey)
  if (cached) return cached
  try {
    const res = await fetch(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) return null
    const data = await res.json() as { data?: { id?: string }[] }
    const usable = (data.data ?? [])
      .map(m => String(m.id ?? ''))
      // The retired name is often still listed, so it must be excluded or the
      // retry picks it again — exactly how the Gemini fallback first failed.
      .filter(id => id && id !== failed && scoreGroqModel(id, kind) > 0)
    if (!usable.length) return null
    const choice = usable.reduce((best, id) => (scoreGroqModel(id, kind) > scoreGroqModel(best, kind) ? id : best))
    resolvedGroqModel.set(cacheKey, choice)
    return choice
  } catch {
    return null
  }
}

export async function generateNoteGroq(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  maxTokens?: number,
  // Groq defaults to temperature 1.0. Structured extraction callers pass a low
  // value so the same source stops producing a different set of fields each run.
  temperature?: number,
): Promise<{ content: string; totalTokens: number }> {
  // Groq's free-tier limiter counts estimated input + max_tokens against the
  // per-minute token cap, so short-answer callers (chat) pass a small maxTokens
  // to leave room for a large notes context in the input.
  const estimatedInputTokens = Math.ceil((systemPrompt.length + prompt.length) / 4)
  const max_tokens = maxTokens ?? Math.max(512, 12000 - estimatedInputTokens - 200)

  const send = (model: string) => fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens,
      ...(temperature !== undefined ? { temperature } : {}),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    }),
  })

  let res = await send(resolvedGroqModel.get(`${apiKey}:${GENERATION_MODEL}`) ?? GENERATION_MODEL)
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    const peek = await res.clone().json().catch(() => ({})) as { error?: { message?: string } }
    if (isModelGone(res.status, peek?.error?.message ?? '')) {
      const alternative = await pickGroqModel(apiKey, GENERATION_MODEL, 'text')
      if (alternative) res = await send(alternative)
    }
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
  audioBlob.set('response_format', 'text')
  const send = (model: string) => {
    audioBlob.set('model', model)
    return fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: audioBlob,
    })
  }

  let res = await send(resolvedGroqModel.get(`${apiKey}:${TRANSCRIPTION_MODEL}`) ?? TRANSCRIPTION_MODEL)
  if (!res.ok && (res.status === 404 || res.status === 400)) {
    const peek = await res.clone().json().catch(() => ({})) as { error?: { message?: string } }
    if (isModelGone(res.status, peek?.error?.message ?? '')) {
      const alternative = await pickGroqModel(apiKey, TRANSCRIPTION_MODEL, 'transcribe')
      if (alternative) res = await send(alternative)
    }
  }
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
