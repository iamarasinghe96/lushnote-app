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

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [] })

  const url =
    'https://nominatim.openstreetmap.org/search'
    + '?format=jsonv2&addressdetails=1&limit=6&countrycodes=au&q='
    + encodeURIComponent(q)

  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'LushNote/1.0 (https://lushnote.com.au; clinical documentation app)',
        'Accept-Language': 'en-AU',
      },
    })
  } catch {
    return NextResponse.json({ results: [] })
  }

  if (!res.ok) return NextResponse.json({ results: [] })

  let data: NominatimItem[]
  try {
    data = await res.json()
  } catch {
    return NextResponse.json({ results: [] })
  }

  const results = Array.isArray(data) ? data.map(formatAddress) : []
  return NextResponse.json({ results })
}
