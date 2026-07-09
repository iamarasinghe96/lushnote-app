import type { GeminiUsage } from '@/types'
import { quotaDate } from '@/lib/utils'

export const GEMINI_RATE_LIMIT_ERROR = 'GEMINI_RATE_LIMIT'
export const GEMINI_DAILY_LIMIT_ERROR = 'GEMINI_DAILY_LIMIT'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
const UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta'
const PRIMARY_MODEL = 'gemini-2.5-flash'
const CHAT_MODEL = 'gemini-2.5-flash-lite'

const TRANSCRIBE_PROMPT = 'Transcribe this audio accurately. Return only the transcription text, no labels or prefixes.'

export interface GeminiResult {
  text: string
  totalTokens: number
}

async function geminiPost(model: string, body: object, apiKey?: string): Promise<GeminiResult> {
  const key = apiKey || process.env.GEMINI_API_KEY
  const res = await fetch(
    `${BASE_URL}/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    if (res.status === 429) {
      // Google returns 429 for both per-day (RPD) and per-minute (RPM/TPM)
      // limits. Only a per-day exhaustion should lock the key out for the day.
      const detail = await res.text()
      throw new Error(/per\s*day/i.test(detail) ? GEMINI_DAILY_LIMIT_ERROR : GEMINI_RATE_LIMIT_ERROR)
    }
    throw new Error(`Gemini API error ${res.status}: ${res.statusText}`)
  }
  const data = await res.json()
  return {
    text: (data.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as string,
    totalTokens: (data.usageMetadata?.totalTokenCount ?? 0) as number,
  }
}

export async function generateNote(prompt: string, systemPrompt: string, apiKey?: string): Promise<GeminiResult> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }
  if (systemPrompt.trim()) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }
  return geminiPost(PRIMARY_MODEL, body, apiKey)
}

export async function transcribeAudio(audioBase64: string, mimeType: string): Promise<GeminiResult> {
  return geminiPost(PRIMARY_MODEL, {
    contents: [
      {
        parts: [
          { text: TRANSCRIBE_PROMPT },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      },
    ],
  })
}

interface GeminiFile {
  uri?: string
  name?: string
  state?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function deleteGeminiFile(name: string, key: string): Promise<void> {
  await fetch(`${BASE_URL}/${name}?key=${key}`, { method: 'DELETE' }).catch(() => {})
}

// Transcribes a complete recording of any length in a SINGLE Gemini call using
// the Files API. This replaces client-side segmentation: the whole audio is
// uploaded once (past Gemini's 20 MB inline limit), transcribed, and the
// temporary Gemini-side file is deleted. Far fewer round-trips, no chunk
// reassembly (which corrupted iOS mp4 recordings), and one quota unit per note.
export async function transcribeAudioViaFilesApi(bytes: Buffer, mimeType: string, apiKey?: string): Promise<GeminiResult> {
  const key = apiKey || process.env.GEMINI_API_KEY
  if (!key) throw new Error('No Gemini key available')

  // 1. Open a resumable upload session
  const startRes = await fetch(`${UPLOAD_BASE}/files?key=${key}`, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: 'session-recording' } }),
  })
  if (!startRes.ok) throw new Error(`Gemini upload start failed ${startRes.status}`)
  const uploadUrl = startRes.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini upload: no upload URL returned')

  // 2. Upload the bytes and finalize in one request
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Uint8Array(bytes),
  })
  if (!uploadRes.ok) throw new Error(`Gemini upload failed ${uploadRes.status}`)
  const uploaded = await uploadRes.json() as { file?: GeminiFile }
  let file = uploaded.file
  if (!file?.uri || !file?.name) throw new Error('Gemini upload: malformed response')
  const fileName = file.name

  // 3. Audio is usually ACTIVE immediately; poll briefly while PROCESSING
  let attempts = 0
  while (file.state === 'PROCESSING' && attempts < 15) {
    await sleep(1000)
    attempts++
    const statRes = await fetch(`${BASE_URL}/${fileName}?key=${key}`)
    if (!statRes.ok) break
    file = await statRes.json() as GeminiFile
  }
  if (file.state === 'FAILED') {
    await deleteGeminiFile(fileName, key)
    throw new Error('Gemini file processing failed')
  }

  // 4. Transcribe referencing the uploaded file, then always clean it up
  try {
    return await geminiPost(PRIMARY_MODEL, {
      contents: [
        {
          parts: [
            { text: TRANSCRIBE_PROMPT },
            { fileData: { mimeType, fileUri: file.uri } },
          ],
        },
      ],
    }, key)
  } finally {
    await deleteGeminiFile(fileName, key)
  }
}

export async function chatResponse(
  messages: Array<{ role: 'user' | 'model'; parts: [{ text: string }] }>,
  systemPrompt: string
): Promise<GeminiResult> {
  return geminiPost(CHAT_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
  })
}

export function checkQuota(usageRecord: GeminiUsage, modelKey: string): boolean {
  const today = quotaDate()
  const record = usageRecord[modelKey]
  if (!record || record.date !== today) return true
  return record.count < 20
}
