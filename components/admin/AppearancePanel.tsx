'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  HOLIDAY_KEYS, themeFor, resolveHolidayTheme, holidayBackgroundStyle,
  easterSunday, naidocStart, readHolidayOverride, writeHolidayOverride,
  campaignActive, campaignTheme, type CampaignConfig, type HolidayKey,
} from '@/lib/holidayTheme'
import { getHolidayAppearance, buildTileDataUrl, type HolidayAppearance } from '@/lib/holidayTiles'

const CARD = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

const au = (d: Date) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })

// When each theme next appears, computed the same way the header computes it —
// so this table is a check on the real logic, not a second description of it.
function nextDates(year: number, campaign?: CampaignConfig) {
  const easter = easterSunday(year)
  const naidoc = naidocStart(year)
  const naidocEnd = new Date(naidoc.getFullYear(), naidoc.getMonth(), naidoc.getDate() + 7)
  return [
    { key: 'christmas' as HolidayKey, when: `20–26 December ${year}` },
    { key: 'australiaDay' as HolidayKey, when: `26 January ${year}` },
    { key: 'anzacDay' as HolidayKey, when: `25 April ${year}` },
    { key: 'easter' as HolidayKey, when: `Good Friday to Easter Monday — Easter Sunday is ${au(easter)}` },
    { key: 'naidoc' as HolidayKey, when: `First Sunday in July for a week — ${au(naidoc)} to ${au(naidocEnd)}` },
    {
      key: 'campaign' as HolidayKey,
      when: campaign?.start && campaign?.end
        ? `${campaign.start} to ${campaign.end} — outranks every theme above`
        : 'Not set — no dates of its own; set a window below',
    },
  ]
}

export default function AppearancePanel() {
  const { user } = useAuth()
  const [override, setOverride] = useState<HolidayKey | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [campaign, setCampaign] = useState<CampaignConfig>({ label: '', start: '', end: '', banner: '' })
  // Mirrors the header's own order, campaign first, so this line can't disagree
  // with what doctors are actually seeing.
  const today = (campaignActive(campaign, new Date()) ? campaignTheme(campaign) : null)
    ?? resolveHolidayTheme(new Date())

  const [tiles, setTiles] = useState<HolidayAppearance['tiles']>({})
  const [scrims, setScrims] = useState<HolidayAppearance['scrims']>({})
  const [editing, setEditing] = useState<HolidayKey | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [zoom, setZoom] = useState(2)
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setOverride(readHolidayOverride()) }, [])
  useEffect(() => { getHolidayAppearance().then(a => {
    setTiles(a.tiles); setScrims(a.scrims)
    if (a.campaign) setCampaign({ banner: '', ...a.campaign })
  }) }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  // Rebuild on every zoom change so the pill below shows exactly what would be
  // saved — the crop is the whole decision here, and describing it never worked.
  useEffect(() => {
    if (!file) { setDraft(null); return }
    let stale = false
    buildTileDataUrl(file, zoom).then(url => { if (!stale) setDraft(url) }).catch(() => setToast('Could not read that image'))
    return () => { stale = true }
  }, [file, zoom])

  function apply(key: HolidayKey | null) {
    writeHolidayOverride(key)
    setOverride(key)
  }

  function startEditing(key: HolidayKey) {
    setEditing(key); setFile(null); setDraft(null); setZoom(2)
  }

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/holiday-tile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Request failed')
    return res.json()
  }

  async function save() {
    if (!editing || !draft) return
    setBusy(true)
    try {
      const r = await call({ action: 'upload', key: editing, dataUrl: draft }) as { url: string }
      setTiles(prev => ({ ...prev, [editing]: r.url }))
      setEditing(null); setFile(null); setDraft(null)
      setToast('Saved — the header uses it from now on')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  // Saved on release rather than on every drag, so one adjustment is one write.
  async function saveScrim(key: HolidayKey, value: number) {
    try { await call({ action: 'scrim', key, scrimOpacity: value }) }
    catch (e) { setToast(e instanceof Error ? e.message : 'Could not save') }
  }

  async function saveCampaign() {
    setBusy(true)
    try {
      await call({ action: 'campaign', campaign })
      setToast(campaignActive(campaign, new Date())
        ? 'Live now — every doctor sees it'
        : 'Saved — it goes up on the start date')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Save failed')
    } finally { setBusy(false) }
  }

  async function clearCampaign() {
    setBusy(true)
    try {
      await call({ action: 'campaignClear' })
      setCampaign({ label: '', start: '', end: '', banner: '' })
      setToast('Campaign removed')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not remove')
    } finally { setBusy(false) }
  }

  async function reset(key: HolidayKey) {
    setBusy(true)
    try {
      await call({ action: 'reset', key })
      setTiles(prev => { const next = { ...prev }; delete next[key]; return next })
      setToast('Removed — back to the built-in artwork')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not remove')
    } finally { setBusy(false) }
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
              {k === 'campaign' ? campaignTheme(campaign).label : themeFor(k).label}
            </button>
          ))}
        </div>

        {/* The same background rules the real header uses, at the same height. */}
        <div className="space-y-4 pt-1">
          {(override ? [override] : HOLIDAY_KEYS).map(k => {
            const t = k === 'campaign' ? campaignTheme(campaign) : themeFor(k)
            const isEditing = editing === k
            const shown = isEditing && draft ? draft : tiles[k]
            return (
              <div key={k}>
                <div className="flex items-baseline gap-2 mb-1">
                  <p className="text-[11px] uppercase tracking-wide text-[#94a3b8]">{t.label}</p>
                  {k === 'campaign' && campaignActive(campaign, new Date()) && (
                    <span className="text-[11px] text-[#dc2626] font-medium">live now</span>
                  )}
                  {tiles[k] && <span className="text-[11px] text-[#059669]">custom artwork</span>}
                  <button onClick={() => (isEditing ? setEditing(null) : startEditing(k))}
                    className="ml-auto text-xs text-[#1d4ed8]">
                    {isEditing ? 'Cancel' : tiles[k] ? 'Replace' : 'Upload artwork'}
                  </button>
                  {tiles[k] && !isEditing && (
                    <button onClick={() => reset(k)} disabled={busy} className="text-xs text-[#dc2626] disabled:opacity-50">Remove</button>
                  )}
                </div>

                <div className="ln-glass ln-glass-brand lg-frost-sm ln-holiday flex items-center justify-between px-4"
                  style={{ height: 60, borderRadius: 30, ...holidayBackgroundStyle(t, shown, scrims[k]) }}>
                  <div className="ln-holiday-text flex flex-col min-w-0">
                    <span className="text-sm font-bold text-white leading-tight truncate">
                      {t.banner ? t.banner.replace('{name}', 'Dr Jane Smith') : 'Dr Jane Smith'}
                    </span>
                    <span className="text-xs text-white/70 leading-tight truncate">MBBS · Albury Wodonga Health</span>
                  </div>
                  <span className="ln-holiday-text text-white font-semibold text-sm">LushNote</span>
                </div>

                {k === 'campaign' && (
                  <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-3">
                    <p className="text-[11px] text-[#94a3b8]">
                      A one-off awareness window — a bushfire appeal, a public-health alert. While it runs it replaces
                      every other theme, because it is put up for a reason that matters more on the day. Leave it
                      empty and nothing changes.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs text-[#475569]">Name</span>
                        <input value={campaign.label} maxLength={60}
                          onChange={e => setCampaign(c => ({ ...c, label: e.target.value }))}
                          placeholder="Bushfire appeal"
                          className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-[#475569]">Header message (optional)</span>
                        <input value={campaign.banner ?? ''} maxLength={80}
                          onChange={e => setCampaign(c => ({ ...c, banner: e.target.value }))}
                          placeholder="Leave empty to keep the doctor's name"
                          className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-[#475569]">Starts</span>
                        <input type="date" value={campaign.start}
                          onChange={e => setCampaign(c => ({ ...c, start: e.target.value }))}
                          className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-[#475569]">Ends — inclusive</span>
                        <input type="date" value={campaign.end}
                          onChange={e => setCampaign(c => ({ ...c, end: e.target.value }))}
                          className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-white text-sm" />
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={saveCampaign} disabled={busy}
                        className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-medium disabled:opacity-50">
                        {busy ? 'Saving…' : 'Save campaign'}
                      </button>
                      <button onClick={clearCampaign} disabled={busy}
                        className="text-xs text-[#dc2626] disabled:opacity-50">Clear</button>
                      <span className="text-[11px] text-[#94a3b8]">
                        Both dates count as whole days in the doctor&apos;s own timezone.
                      </span>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-3 mt-1">
                  <span className="text-[11px] text-[#94a3b8] w-40 shrink-0">
                    Text highlight {Math.round((scrims[k] ?? t.scrimOpacity) * 100)}%
                  </span>
                  <input type="range" min={0} max={1} step={0.05}
                    value={scrims[k] ?? t.scrimOpacity}
                    onChange={e => setScrims(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                    onPointerUp={e => saveScrim(k, Number((e.target as HTMLInputElement).value))}
                    onKeyUp={e => saveScrim(k, Number((e.target as HTMLInputElement).value))}
                    className="flex-1" />
                  {scrims[k] !== undefined && (
                    <button onClick={() => { setScrims(prev => ({ ...prev, [k]: t.scrimOpacity })); saveScrim(k, t.scrimOpacity) }}
                      className="text-[11px] text-[#475569]">Default</button>
                  )}
                </label>

                {isEditing && (
                  <div className="mt-2 rounded-xl border border-[var(--border)] p-3 space-y-3">
                    <input ref={inputRef} type="file" accept="image/*" className="hidden"
                      onChange={e => setFile(e.target.files?.[0] ?? null)} />
                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={() => inputRef.current?.click()}
                        className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm text-[#475569]">
                        Choose image
                      </button>
                      <span className="text-xs text-[#94a3b8] truncate">{file ? file.name : 'No image chosen'}</span>
                    </div>

                    {file && (
                      <>
                        <label className="block">
                          <span className="text-xs text-[#475569]">Zoom — {zoom.toFixed(1)}×</span>
                          <input type="range" min={1} max={5} step={0.1} value={zoom}
                            onChange={e => setZoom(Number(e.target.value))} className="w-full" />
                          <span className="text-[11px] text-[#94a3b8]">
                            The bar is only 60px tall, so the whole image is shrunk into it. Zoom in until a single
                            motif is about half the height of the pill above.
                          </span>
                        </label>
                        <div className="flex items-center gap-2">
                          <button onClick={save} disabled={busy || !draft}
                            className="px-4 py-2 rounded-lg bg-[#1d4ed8] text-white text-sm font-medium disabled:opacity-50">
                            {busy ? 'Saving…' : 'Save artwork'}
                          </button>
                          {draft && (
                            <span className="text-[11px] text-[#94a3b8]">
                              {Math.round(draft.length * 0.75 / 1024)} KB · 480×240 · mirrored so the repeat is seamless
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {toast && <p className="text-xs text-[#475569]">{toast}</p>}

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
          {nextDates(year, campaign).map(d => (
            <li key={d.key} className="py-2 flex items-baseline gap-3">
              <span className="text-sm font-medium text-[#0f172a] w-32 shrink-0">
                {d.key === 'campaign' ? campaignTheme(campaign).label : themeFor(d.key).label}
              </span>
              <span className="text-sm text-[#475569]">{d.when}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[#94a3b8]">
          Upload artwork above — any size, any format. It is cropped, mirrored so the repeat has no seam, sized to
          480×240 and compressed under 30 KB in your browser before it is saved, with its own colours untouched. Nothing
          dims the artwork: the white text sits on a soft blurred wash that dissolves into the illustration instead of
          ending at an edge, and the slider sets how strong that is. Until artwork exists a theme falls back to a plain coloured
          gradient, so a missing image never breaks the header.
        </p>
      </div>
    </div>
  )
}
