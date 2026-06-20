import { NextRequest, NextResponse } from 'next/server'

// Address lookup via OpenStreetMap Nominatim (free, no API key). Proxied
// server-side so we can send a descriptive User-Agent per their usage policy
// and keep requests to ~1/sec (this is only triggered by a user button press).

interface NominatimAddress {
  house_number?: string
  road?: string
  suburb?: string
  neighbourhood?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  state?: string
  postcode?: string
}

interface NominatimItem {
  display_name: string
  name?: string
  address?: NominatimAddress
}

function formatAddress(item: NominatimItem): { label: string; value: string } {
  const a = item.address ?? {}
  const name = item.name ?? ''
  const street = [a.house_number, a.road].filter(Boolean).join(' ')
  const locality = a.suburb || a.neighbourhood || a.city || a.town || a.village || a.municipality || ''
  const cityLine = [locality, a.state, a.postcode].filter(Boolean).join(' ')
  const value = [name, street, cityLine].filter(Boolean).join('\n') || item.display_name
  return { label: item.display_name, value }
}

async function nominatimSearch(q: string): Promise<NominatimItem[]> {
  const url =
    'https://nominatim.openstreetmap.org/search'
    + '?format=jsonv2&addressdetails=1&limit=6&countrycodes=au&q='
    + encodeURIComponent(q)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'LushNote/1.0 (https://lushnote.com.au; clinical documentation app)',
        'Accept-Language': 'en-AU',
      },
    })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })

  let data = await nominatimSearch(q)

  // Many private clinics aren't indexed in OSM. If the full name returns nothing
  // and the query has multiple words, retry with just the last word (usually the
  // suburb/city) so the user at least gets a street-level starting point.
  if (data.length === 0 && q.includes(' ')) {
    const words = q.split(/\s+/).filter(Boolean)
    // Try last two words first (e.g. "Wodonga VIC"), then last word alone
    const fallbacks = words.length >= 2
      ? [words.slice(-2).join(' '), words[words.length - 1]]
      : [words[words.length - 1]]
    for (const fb of fallbacks) {
      data = await nominatimSearch(fb)
      if (data.length > 0) break
    }
  }

  const results = data.map(formatAddress)
  return NextResponse.json({ results })
}
