import { NextRequest, NextResponse } from 'next/server'
import { generateNote } from '@/lib/gemini'

// Address lookup powered by Gemini (server-side key — no per-user key needed).
// OpenStreetMap/Nominatim was weak at named facilities (clinics, hospitals,
// radiology centres) and its hard AU country filter returned nonsense for
// overseas queries. Gemini has broad, current knowledge of real institutions
// and their postal addresses, and honours any country named in the query.
//
// Addresses are a starting point the clinician reviews before sending, and the
// UI always offers an "Open in Google Maps" button for verification, so an
// occasional approximate result is acceptable — far better than wrong-country
// matches.

interface AddressCandidate {
  name?: string
  address?: string
  approximate?: boolean
}

const SYSTEM_PROMPT =
  'You are a precise address lookup assistant for an Australian medical app. ' +
  'Given a clinic, hospital, organisation, doctor practice, or partial address, ' +
  'return the most likely real-world postal address(es). Prefer Australian ' +
  'results when the location is ambiguous, but always honour a country, state, ' +
  'or city named in the query. Only return addresses you genuinely believe exist.'

function toResults(candidates: AddressCandidate[]): { label: string; value: string }[] {
  return candidates
    .filter(c => c && typeof c.address === 'string' && c.address.trim().length > 0)
    .slice(0, 4)
    .map(c => {
      const address = (c.address as string).trim()
      const oneLine = address.replace(/\s*\n+\s*/g, ', ')
      const namePart = c.name ? `${c.name.trim()} — ` : ''
      const approxPart = c.approximate ? ' (approx.)' : ''
      return { label: `${namePart}${oneLine}${approxPart}`, value: address }
    })
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })
  if (q.length > 300) return NextResponse.json({ results: [] })
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ results: [] })

  const prompt =
    `Find the postal address for: "${q}"\n\n` +
    'Return ONLY valid JSON — an array of up to 4 candidate addresses, most likely first. ' +
    'Each item must be: ' +
    '{ "name": "official place name", "address": "street line\\ncity STATE postcode\\ncountry", "approximate": true|false }. ' +
    'Put each part of the address on its own line using \\n. ' +
    'Set "approximate" to true when you are not certain of the exact street number. ' +
    'If you have no idea, return [].'

  try {
    const { text } = await generateNote(prompt, SYSTEM_PROMPT)
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return NextResponse.json({ results: [] })
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed)) return NextResponse.json({ results: [] })
    return NextResponse.json({ results: toResults(parsed as AddressCandidate[]) })
  } catch {
    return NextResponse.json({ results: [] })
  }
}
