import { NextRequest, NextResponse } from 'next/server'
import { generateNote } from '@/lib/gemini'

// Address lookup. Primary source is Geoapify (free Places/geocoding API, real
// business + address listings). Set GEOAPIFY_API_KEY (free, no card, 3k/day at
// geoapify.com). If the key is absent or Geoapify finds nothing, we fall back
// to Gemini (server key) which can guess well-known institutions. The UI also
// always offers an "Open in Google Maps" button for manual verification.

type Result = { label: string; value: string }

// ── Geoapify ──────────────────────────────────────────────────────────────
interface GeoapifyResult {
  name?: string
  housenumber?: string
  street?: string
  suburb?: string
  city?: string
  town?: string
  village?: string
  state?: string
  postcode?: string
  country?: string
  formatted?: string
}

function fromGeoapify(results: GeoapifyResult[]): Result[] {
  return results
    .map(r => {
      const street = [r.housenumber, r.street].filter(Boolean).join(' ')
      const locality = [r.city || r.town || r.village || r.suburb, r.state, r.postcode].filter(Boolean).join(' ')
      const country = r.country && r.country !== 'Australia' ? r.country : ''
      const value = [street, locality, country].filter(Boolean).join('\n')
      const label = r.formatted || value
      return { label, value: value || label }
    })
    .filter(x => x.value.trim().length > 0)
}

async function geoapifySearch(q: string, key: string): Promise<Result[]> {
  // bias (not filter) towards Australia: prefers AU results but still finds
  // overseas places when the query names another country/city.
  const url =
    'https://api.geoapify.com/v1/geocode/search' +
    '?text=' + encodeURIComponent(q) +
    '&format=json&limit=6&bias=countrycode:au' +
    '&apiKey=' + key
  try {
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as { results?: GeoapifyResult[] }
    return fromGeoapify(Array.isArray(data.results) ? data.results : [])
  } catch {
    return []
  }
}

// ── Gemini fallback ──────────────────────────────────────────────────────
interface AddressCandidate {
  name?: string
  address?: string
  approximate?: boolean
}

const GEMINI_SYSTEM =
  'You are a precise address lookup assistant for an Australian medical app. ' +
  'Given a clinic, hospital, organisation, doctor practice, or partial address, ' +
  'return the most likely real-world postal address(es). Prefer Australian ' +
  'results when the location is ambiguous, but always honour a country, state, ' +
  'or city named in the query. Only return addresses you genuinely believe exist.'

function fromGemini(candidates: AddressCandidate[]): Result[] {
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

async function geminiSearch(q: string): Promise<Result[]> {
  if (!process.env.GEMINI_API_KEY) return []
  const prompt =
    `Find the postal address for: "${q}"\n\n` +
    'Return ONLY valid JSON — an array of up to 4 candidate addresses, most likely first. ' +
    'Each item must be: ' +
    '{ "name": "official place name", "address": "street line\\ncity STATE postcode\\ncountry", "approximate": true|false }. ' +
    'Put each part of the address on its own line using \\n. ' +
    'Set "approximate" to true when you are not certain of the exact street number. ' +
    'If you have no idea, return [].'
  try {
    const { text } = await generateNote(prompt, GEMINI_SYSTEM)
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed)) return []
    return fromGemini(parsed as AddressCandidate[])
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length > 300) return NextResponse.json({ results: [] })

  const key = process.env.GEOAPIFY_API_KEY
  if (key) {
    const geo = await geoapifySearch(q, key)
    if (geo.length > 0) return NextResponse.json({ results: geo })
  }

  // No Geoapify key, or it found nothing — fall back to Gemini's best guess.
  const gemini = await geminiSearch(q)
  return NextResponse.json({ results: gemini })
}
