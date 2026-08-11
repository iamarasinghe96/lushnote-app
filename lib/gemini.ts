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

// Gemini defaults to temperature 1.0. That is right for prose, and wrong for
// pulling a fixed set of facts out of a note: it is why the same ward note came
// back complete on one run and missing its problem list on the next. Structured
// extraction callers pass a low temperature; note generation keeps the default.
export async function generateNote(
  prompt: string,
  systemPrompt: string,
  apiKey?: string,
  opts?: { temperature?: number },
): Promise<GeminiResult> {
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }
  if (systemPrompt.trim()) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] }
  }
  if (opts?.temperature !== undefined) {
    body.generationConfig = { temperature: opts.temperature, maxOutputTokens: 8192 }
  }
  return geminiPost(PRIMARY_MODEL, body, apiKey)
}

export async function transcribeAudio(audioBase64: string, mimeType: string, apiKey?: string): Promise<GeminiResult> {
  return geminiPost(PRIMARY_MODEL, {
    contents: [
      {
        parts: [
          { text: TRANSCRIBE_PROMPT },
          { inlineData: { mimeType, data: audioBase64 } },
        ],
      },
    ],
  }, apiKey)
}

// Read a photographed ward progress note. One call returns BOTH the transcribed
// text and the patient identifiers off the addressograph label, so a scanned note
// costs a single request instead of one to read and one to extract.
const OCR_PROMPT = `You are reading a photograph of a hospital progress note. It contains printed text (a patient identification label, form headings) and handwritten clinical entries.

Work down the WHOLE page from the top edge to the bottom edge and return every block you find, in order, as a section. Do not stop when you reach a long paragraph — keep going to the bottom of the written area.

A ward progress note is usually laid out in this order. Check EXPLICITLY for each one before you answer, and include every one that is present on the page:
1. A header line naming the ward round, unit, team or consultants, with the entry's date and time.
2. A PROBLEM LIST — a run of short lines each beginning with "#". This sits near the top and is the block most often missed. Every "#" line is a separate entry, including ones marked resolved or inactive.
3. A narrative section, often headed "Progress".
4. Observations ("Obs:") and examination findings.
5. A PLAN — a numbered list ("1." "2." "3." …) near the bottom. This is the second most often missed block. Every numbered item is a separate entry.

Rules:
- Transcribe faithfully and COMPLETELY. Do not skip, merge or summarise any line — a problem marked "resolved" matters as much as an active one.
- One written line per entry in "lines". Keep the "#" and the numbering as written.
- Indented sub-items stay attached to their parent: prefix a sub-item with two spaces per level of indent, e.g. "5. Aspirin 300mg load w/ 100mg daily ongoing" then "  a. Cease if no stroke". A sub-item is never promoted to a top-level item and never merged into its parent's line.
- The entry's date and time are the handwritten ones in the Date/Time column beside the entry. Never take them from the identification label's admission date, or any other date printed on the form. If the handwritten date is unclear, write what you can read and leave the rest as [illegible] — do not substitute a date from elsewhere on the page.
- Handwriting overruns: a word or phrase that did not fit often continues at the start of the next line or in the left margin. Reassemble those into the sentence they belong to rather than transcribing them where they physically sit.
- Expand nothing and invent nothing. Where a word is genuinely illegible write [illegible].
- Keep clinical abbreviations exactly as written (IDC, TOU, NH, LL, CWR, r/v, o/t, obs) and keep "b/g" (background) as written.
- Do not include the form's pre-printed furniture (barcodes, "Please sign each entry", store order numbers, page footers).
- heading: the block's own written heading if it has one, otherwise a short descriptive one you supply.
- NEVER return a heading with an empty "lines" array. If you can see a block well enough to name it, you must transcribe its lines. If the block is there but you genuinely cannot read it, put "[illegible]" as a line rather than leaving it empty.
- patientName: the patient's name in natural order with normal capitalisation. Labels usually print it SURNAME Given Names — reorder it to "Given Names Surname".
- urNumber: the UR / MRN number from the label, digits and letters only.
- dob: date of birth as DD/MM/YYYY.
- sex: "male" or "female" only, or "" if it is not printed.
- Leave any field you cannot read as an empty string.

Respond ONLY with this JSON and nothing else:
{"patientName":"","urNumber":"","dob":"","sex":"","sections":[{"heading":"","lines":[""]}]}`

export async function ocrClinicalImages(
  images: { data: string; mimeType: string }[],
  apiKey?: string,
): Promise<GeminiResult> {
  return geminiPost(PRIMARY_MODEL, {
    contents: [
      {
        parts: [
          { text: OCR_PROMPT },
          ...images.map(i => ({ inlineData: { mimeType: i.mimeType, data: i.data } })),
        ],
      },
    ],
    // Deterministic and with room to finish: a page of handwriting transcribed
    // section by section is a long reply, and at the default temperature the
    // same photo read differently every time.
    generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8192 },
  }, apiKey)
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
  systemPrompt: string,
  apiKey?: string
): Promise<GeminiResult> {
  return geminiPost(CHAT_MODEL, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages,
  }, apiKey)
}

export function checkQuota(usageRecord: GeminiUsage, modelKey: string): boolean {
  const today = quotaDate()
  const record = usageRecord[modelKey]
  if (!record || record.date !== today) return true
  return record.count < 20
}
