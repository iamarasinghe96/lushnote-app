'use client'

import { useEffect, useState } from 'react'
import {
  HOLIDAY_KEYS, themeFor, resolveHolidayTheme, holidayBackgroundStyle,
  easterSunday, naidocStart, readHolidayOverride, writeHolidayOverride, type HolidayKey,
} from '@/lib/holidayTheme'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

const au = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

// When each theme next appears, computed the same way the header computes it —
// so this table is a check on the real logic, not a second description of it.
function nextDates(year: number) {
  const easter = easterSunday(year)
  const naidoc = naidocStart(year)
  const naidocEnd = new Date(naidoc.getFullYear(), naidoc.getMonth(), naidoc.getDate() + 7)
  return [
    { key: 'christmas' as HolidayKey, when: `20–26 December ${year}` },
    { key: 'australiaDay' as HolidayKey, when: `26 January ${year}` },
    { key: 'anzacDay' as HolidayKey, when: `25 April ${year}` },
    { key: 'easter' as HolidayKey, when: `Good Friday to Easter Monday — Easter Sunday is ${au(easter)}` },
    { key: 'naidoc' as HolidayKey, when: `First Sunday in July for a week — ${au(naidoc)} to ${au(naidocEnd)}` },
    { key: 'birthday' as HolidayKey, when: 'Each doctor’s own birthday, from their Settings → Profile' },
  ]
}

export default function AppearancePanel() {
  const [override, setOverride] = useState<HolidayKey | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const today = resolveHolidayTheme(new Date())

  useEffect(() => { setOverride(readHolidayOverride()) }, [])

  function apply(key: HolidayKey | null) {
    writeHolidayOverride(key)
    setOverride(key)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <h2 className="text-base font-semibold text-[#0f172a]">Header themes</h2>
        <p className="text-xs text-[#94a3b8]">
          On these days the header&apos;s blue background is replaced with a tiled illustration. Nothing else about the
          header changes. Dates are computed from the calendar — Easter included — so there is no yearly list to update.
        </p>
        <p className="text-xs text-[#475569]">
          Today: <strong>{today ? today.label : 'no theme — ordinary blue header'}</strong>
        </p>
      </div>

      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-[#0f172a]">Preview</h3>
          <span className="text-xs text-[#94a3b8]">
            Forces a theme in <em>this browser only</em>, across refreshes. Doctors are unaffected.
          </span>
          {override && (
            <button onClick={() => apply(null)}
              className="ml-auto px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569]">
              Stop previewing
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {HOLIDAY_KEYS.map(k => (
            <button key={k} onClick={() => apply(k)}
              className={`px-3 py-1.5 rounded-lg text-sm ${override === k ? 'bg-[#1d4ed8] text-white' : 'text-[#475569] border border-[var(--border)]'}`}>
              {themeFor(k).label}
            </button>
          ))}
        </div>

        {/* The same background rules the real header uses, at the same height. */}
        <div className="space-y-2 pt-1">
          {(override ? [override] : HOLIDAY_KEYS).map(k => {
            const t = themeFor(k)
            return (
              <div key={k}>
                <p className="text-[11px] uppercase tracking-wide text-[#94a3b8] mb-1">{t.label}</p>
                <div className="flex items-center justify-between px-4"
                  style={{ height: 60, borderRadius: 30, ...holidayBackgroundStyle(t) }}>
                  <span className="text-sm font-bold text-white truncate">
                    {t.banner ? t.banner.replace('{name}', 'Dr Jane Smith') : 'Dr Jane Smith'}
                  </span>
                  <span className="text-white font-semibold text-sm">LushNote</span>
                </div>
              </div>
            )
          })}
        </div>

        {override && (
          <p className="text-xs text-amber-700">
            Previewing <strong>{themeFor(override).label}</strong> — the app header shows it until you stop.
          </p>
        )}
      </div>

      <div className="rounded-2xl p-5 space-y-3" style={CARD}>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[#0f172a]">When they appear</h3>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setYear(y => y - 1)} className="px-2 py-1 rounded border border-[var(--border)] text-sm">←</button>
            <span className="text-sm font-medium text-[#475569]">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="px-2 py-1 rounded border border-[var(--border)] text-sm">→</button>
          </div>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {nextDates(year).map(d => (
            <li key={d.key} className="py-2 flex items-baseline gap-3">
              <span className="text-sm font-medium text-[#0f172a] w-32 shrink-0">{themeFor(d.key).label}</span>
              <span className="text-sm text-[#475569]">{d.when}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[#94a3b8]">
          Generate artwork at 1024×1024 with about <strong>two rows</strong> of motifs — the whole square is shrunk into
          a 60px-tall bar, so a busy five-row pattern renders each motif at around 12px. Then run{' '}
          <code>python3 scripts/build-holiday-tiles.py &lt;file&gt; &lt;key&gt;</code> — it mirrors the tile so the repeat is
          seamless, sizes it to 480×240 and compresses it under 30 KB. Add <code>--zoom 2.5</code> to crop into artwork
          that came out too busy. Until a file exists the theme falls back to a plain coloured gradient, so a missing
          image never breaks the header.
        </p>
      </div>
    </div>
  )
}
