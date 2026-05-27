import type { GeminiUsage } from '@/types'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const PRIMARY_MODEL = 'gemini-2.5-flash'
const CHAT_MODEL = 'gemini-2.5-flash-lite'

async function geminiPost(model: string, body: object): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    throw new Error(`Gemini API error ${res.status}: ${res.statusText}`)
  }
  const data = await res.json()
  return (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as string
}

export async function generateNote(prompt: string, systemPrompt: string): Promise<string> {
  return geminiPost(PRIMARY_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  })
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
  return geminiPost(PRIMARY_MODEL, {
    contents: [
      {
        parts: [
          { text: 'Transcribe this audio accurately. Return only the transcription text, no labels or prefixes.' },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      },
    ],
  })
}

export async function chatResponse(
  messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>,
  systemPrompt: string
): Promise<string> {
  return geminiPost(CHAT_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
  })
}

export function checkQuota(usageRecord: GeminiUsage, modelKey: string): boolean {
  const today = new Date().toISOString().split('T')[0]
  const record = usageRecord[modelKey]
  if (!record || record.date !== today) return true
  return record.count < 20
}
