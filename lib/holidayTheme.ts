// Which festive skin the header wears today.
//
// DELIBERATELY has no data source. Every date here is either fixed or
// computable, so there is no yearly file to fetch, no GitHub repo to track and
// nothing to go stale in January — Easter comes from the Computus algorithm,
// which is exact for any Gregorian year. The whole resolution is a handful of
// integer comparisons, runs synchronously during render, and costs no network.
// That is what lets the themed bar be correct on the FIRST paint: there is no
// async step for the plain blue to flash through.

export type HolidayKey = 'christmas' | 'australiaDay' | 'anzacDay' | 'easter' | 'naidoc' | 'campaign'

export interface HolidayTheme {
  key: HolidayKey
  label: string
  /** Tileable illustration in /public/holiday. Repeats across the bar. */
  image: string
  /** Shown until (or if) the image loads — never a bare blue flash. */
  fallback: string
  /** Halo colour as an `r,g,b` triplet — a dark tone drawn from the theme. */
  scrimRgb: string
  /** How strong the halo around the white text is. Nothing else is darkened.
   *  Adjustable per theme from the admin console; this is the starting point. */
  scrimOpacity: number
  /** Replaces the doctor's name line while the theme is up. */
  banner?: string
}

const THEMES: Record<HolidayKey, HolidayTheme> = {
  christmas: {
    key: 'christmas',
    label: 'Christmas',
    image: '/holiday/christmas.webp',
    fallback: 'linear-gradient(90deg,#0b3d2e,#134e3a,#0b3d2e)',
    scrimRgb: '6,40,30', scrimOpacity: 0.55,
  },
  australiaDay: {
    key: 'australiaDay',
    label: 'Australia Day',
    image: '/holiday/australia-day.webp',
    fallback: 'linear-gradient(90deg,#0b2d6b,#12408f,#0b2d6b)',
    scrimRgb: '8,32,80', scrimOpacity: 0.50,
  },
  anzacDay: {
    key: 'anzacDay',
    label: 'Anzac Day',
    image: '/holiday/anzac-day.webp',
    fallback: 'linear-gradient(90deg,#1e2a3a,#2b3b50,#1e2a3a)',
    scrimRgb: '20,28,40', scrimOpacity: 0.55,
  },
  easter: {
    key: 'easter',
    label: 'Easter',
    image: '/holiday/easter.webp',
    fallback: 'linear-gradient(90deg,#6d5bb5,#8b7ad0,#6d5bb5)',
    scrimRgb: '60,45,110', scrimOpacity: 0.45,
  },
  naidoc: {
    key: 'naidoc',
    label: 'NAIDOC Week',
    image: '/holiday/naidoc.webp',
    fallback: 'linear-gradient(90deg,#7a2d10,#a8431a,#7a2d10)',
    scrimRgb: '70,26,10', scrimOpacity: 0.50,
  },
  // The only theme with no date of its own. Its window, name and message are
  // set in the admin console, so a bushfire appeal or a public-health notice can
  // go up the same afternoon without a deploy.
  campaign: {
    key: 'campaign',
    label: 'Campaign',
    image: '/holiday/campaign.webp',
    fallback: 'linear-gradient(90deg,#7f1d1d,#b91c1c,#7f1d1d)',
    scrimRgb: '60,10,10', scrimOpacity: 0.55,
  },
}

export const HOLIDAY_KEYS = Object.keys(THEMES) as HolidayKey[]
export function themeFor(key: HolidayKey): HolidayTheme { return THEMES[key] }

/** An admin-set awareness window: a name, a date range, and an optional line to
 *  show in place of the doctor's name. Dates are `YYYY-MM-DD`, both inclusive. */
export interface CampaignConfig {
  label: string
  start: string
  end: string
  banner?: string
}

// Compared as local calendar dates, not UTC instants: "until the 30th" has to
// mean the doctor's own 30th, or a campaign ends mid-afternoon in Australia.
// ISO strings sort correctly, so plain string comparison is the whole test.
function localISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function campaignActive(cfg: CampaignConfig | undefined, date: Date): boolean {
  if (!cfg?.start || !cfg?.end) return false
  const today = localISODate(date)
  return today >= cfg.start && today <= cfg.end
}

/** The campaign theme wearing its configured name and message. */
export function campaignTheme(cfg: CampaignConfig): HolidayTheme {
  return {
    ...THEMES.campaign,
    label: cfg.label?.trim() || THEMES.campaign.label,
    banner: cfg.banner?.trim() || undefined,
  }
}

// Anonymous Gregorian Computus. Exact for any year in the Gregorian calendar,
// which is why no almanac is needed.
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)   // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

const DAY = 24 * 60 * 60 * 1000
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

// Good Friday through Easter Monday — the four days Australia actually observes,
// rather than Easter Sunday alone.
function inEaster(date: Date): boolean {
  const easter = midnight(easterSunday(date.getFullYear()))
  const today = midnight(date)
  return today >= easter - 2 * DAY && today <= easter + DAY
}

// NAIDOC Week runs Sunday to Sunday, starting the first Sunday in July —
// computable like Easter, so it needs no yearly list either.
export function naidocStart(year: number): Date {
  const july1 = new Date(year, 6, 1)
  return new Date(year, 6, 1 + ((7 - july1.getDay()) % 7))
}

function inNaidocWeek(date: Date): boolean {
  const start = midnight(naidocStart(date.getFullYear()))
  const today = midnight(date)
  return today >= start && today <= start + 7 * DAY
}

/**
 * The theme for a given day, or null for an ordinary one.
 *
 * A campaign is NOT resolved here: it has no date of its own, it comes from
 * Firestore, and it outranks everything this function can return — see the
 * header in app/(app)/layout.tsx.
 */
export function resolveHolidayTheme(date: Date): HolidayTheme | null {
  const d = date.getDate()
  const mo = date.getMonth() + 1
  if (mo === 12 && d >= 20 && d <= 26) return THEMES.christmas
  if (mo === 1 && d === 26) return THEMES.australiaDay
  if (mo === 4 && d === 25) return THEMES.anzacDay
  if (inEaster(date)) return THEMES.easter
  if (inNaidocWeek(date)) return THEMES.naidoc
  return null
}

// Admin-only preview, held in localStorage so it survives a refresh and reaches
// nobody else. Read synchronously alongside the date so a forced theme paints
// immediately too.
const OVERRIDE_KEY = 'ln_holiday_preview'

export function readHolidayOverride(): HolidayKey | null {
  if (typeof localStorage === 'undefined') return null
  const v = localStorage.getItem(OVERRIDE_KEY)
  return v && (HOLIDAY_KEYS as string[]).includes(v) ? v as HolidayKey : null
}

export function writeHolidayOverride(key: HolidayKey | null): void {
  if (typeof localStorage === 'undefined') return
  if (key) localStorage.setItem(OVERRIDE_KEY, key)
  else localStorage.removeItem(OVERRIDE_KEY)
}

/** The CSS the header applies. One tile repeated across the bar, so a small
 *  image stays sharp at any width instead of being stretched.
 *
 *  Nothing here dims the artwork. Legibility is handled by .ln-holiday-text,
 *  which gives the white text a soft halo following the letterforms, so the
 *  illustration stays visible between them; `--ln-holiday-halo` is its colour.
 *
 *  `--lg-tint-opacity: 0` matters: .ln-glass paints its brand tint on a ::before
 *  that sits ABOVE the host's own background, so without clearing it the blue
 *  would cover the artwork at 92% opacity. Zeroing the existing variable keeps
 *  the glass border, sheen and frost intact — only the colour wash goes. (The
 *  .ln-holiday class then turns the border, sheen and frost off too, since none
 *  of them read the tint.) */
export function holidayBackgroundStyle(theme: HolidayTheme, imageUrl?: string, scrimOpacity?: number): React.CSSProperties {
  return {
    ['--lg-tint-opacity' as string]: 0,
    ['--ln-holiday-halo' as string]: `rgba(${theme.scrimRgb},${scrimOpacity ?? theme.scrimOpacity})`,
    backgroundColor: 'transparent',
    backgroundImage: `url(${imageUrl || theme.image}), ${theme.fallback}`,
    backgroundRepeat: 'repeat-x, no-repeat',
    backgroundSize: 'auto 100%, cover',
    backgroundPosition: 'center, center',
    // The ordinary header casts a blue glow, which reads as a stray colour cast
    // once the bar is no longer blue.
    boxShadow: '0 4px 20px rgba(15,23,42,0.28)',
  } as React.CSSProperties
}
