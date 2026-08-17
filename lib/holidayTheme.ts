// Which festive skin the header wears today.
//
// DELIBERATELY has no data source. Every date here is either fixed or
// computable, so there is no yearly file to fetch, no GitHub repo to track and
// nothing to go stale in January — Easter comes from the Computus algorithm,
// which is exact for any Gregorian year. The whole resolution is a handful of
// integer comparisons, runs synchronously during render, and costs no network.
// That is what lets the themed bar be correct on the FIRST paint: there is no
// async step for the plain blue to flash through.

export type HolidayKey = 'christmas' | 'australiaDay' | 'anzacDay' | 'easter' | 'naidoc' | 'birthday'

export interface HolidayTheme {
  key: HolidayKey
  label: string
  /** Tileable illustration in /public/holiday. Repeats across the bar. */
  image: string
  /** Shown until (or if) the image loads — never a bare blue flash. */
  fallback: string
  /** Scrim colour as an `r,g,b` triplet. */
  scrimRgb: string
  /** How hard the shading darkens the artwork BEHIND THE TEXT so white stays
   *  readable. The middle of the bar is never shaded. Adjustable per theme from
   *  the admin console; this is the starting point. */
  scrimOpacity: number
  /** Replaces the doctor's name line for the day. `{name}` is substituted. */
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
  birthday: {
    key: 'birthday',
    label: 'Birthday',
    image: '/holiday/birthday.webp',
    fallback: 'linear-gradient(90deg,#b4477f,#d4609b,#b4477f)',
    scrimRgb: '90,25,70', scrimOpacity: 0.45,
    banner: 'Happy Birthday {name}',
  },
}

export const HOLIDAY_KEYS = Object.keys(THEMES) as HolidayKey[]
export function themeFor(key: HolidayKey): HolidayTheme { return THEMES[key] }

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
 * `birthday` is DD/MM or DD/MM/YYYY — the year is ignored, only the day matters.
 * A 29 February birthday falls on 28 February in a common year so it is never
 * skipped for three years at a time.
 */
function isBirthday(date: Date, birthday?: string): boolean {
  const m = (birthday ?? '').match(/^(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (!m) return false
  const day = Number(m[1])
  const month = Number(m[2])
  if (!day || !month || month > 12 || day > 31) return false
  if (date.getDate() === day && date.getMonth() + 1 === month) return true
  const leapDay = day === 29 && month === 2
  const isLeap = new Date(date.getFullYear(), 1, 29).getMonth() === 1
  return leapDay && !isLeap && date.getDate() === 28 && date.getMonth() === 1
}

/**
 * The theme for a given day, or null for an ordinary one. A birthday wins over a
 * public holiday — it is the more personal of the two, and a doctor born on
 * Christmas Day should be greeted rather than shown the same tinsel as everyone
 * else.
 */
export function resolveHolidayTheme(date: Date, birthday?: string): HolidayTheme | null {
  if (isBirthday(date, birthday)) return THEMES.birthday
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
 *  image stays sharp at any width instead of being stretched, with a soft-edged
 *  patch of shading at each end so white text stays legible without dimming the
 *  illustration everywhere.
 *
 *  `--lg-tint-opacity: 0` matters: .ln-glass paints its brand tint on a ::before
 *  that sits ABOVE the host's own background, so without clearing it the blue
 *  would cover the artwork at 92% opacity. Zeroing the existing variable keeps
 *  the glass border, sheen and frost intact — only the colour wash goes. (The
 *  .ln-holiday class then turns the border, sheen and frost off too, since none
 *  of them read the tint.) */
export function holidayBackgroundStyle(theme: HolidayTheme, imageUrl?: string, scrimOpacity?: number): React.CSSProperties {
  const a = scrimOpacity ?? theme.scrimOpacity
  const solid = `rgba(${theme.scrimRgb},${a})`
  // Fade to the SAME colour at zero alpha, not to `transparent`. `transparent`
  // is rgba(0,0,0,0), so interpolating towards it drags the midpoint through
  // grey and leaves a dirty band across the artwork.
  const clear = `rgba(${theme.scrimRgb},0)`
  // Shade only where text sits — the name at the left, the wordmark and avatar
  // at the right — and leave the middle as the artwork's own colours. Fixed px
  // rather than percentages because the text blocks are a fixed width: on a
  // wide screen the two patches are a small fraction of the bar, and on a phone
  // they meet in the middle, which is also where the text reaches.
  const leftMask = `linear-gradient(90deg, ${solid} 0px, ${solid} 240px, ${clear} 400px)`
  const rightMask = `linear-gradient(270deg, ${solid} 0px, ${solid} 110px, ${clear} 240px)`
  return {
    ['--lg-tint-opacity' as string]: 0,
    backgroundColor: 'transparent',
    backgroundImage: `${leftMask}, ${rightMask}, url(${imageUrl || theme.image}), ${theme.fallback}`,
    backgroundRepeat: 'no-repeat, no-repeat, repeat-x, no-repeat',
    backgroundSize: 'cover, cover, auto 100%, cover',
    backgroundPosition: 'center, center, center, center',
    // The ordinary header casts a blue glow, which reads as a stray colour cast
    // once the bar is no longer blue.
    boxShadow: '0 4px 20px rgba(15,23,42,0.28)',
  } as React.CSSProperties
}
