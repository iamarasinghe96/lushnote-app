'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/hooks/useAuth'
import HospitalAutocomplete from '@/components/ui/HospitalAutocomplete'
import type { HospitalFormDoc } from '@/types'

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

const DEFAULT_GEOMETRY = {
  tableTopMm: 42, tableLeftMm: 21, dateColMm: 19.5, notesColMm: 157,
  rowHeightMm: 6.83, rowsPerPage: 35, fontPt: 8,
  pid: { topMm: 14, leftMm: 125.5, widthMm: 70.5, rowHeightMm: 7.1, dobSexGapMm: 15.5, sexWidthMm: 20 },
}

export default function AdminHospitalFormsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [forms, setForms] = useState<HospitalFormDoc[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Upload form state
  const [name, setName] = useState('')
  const [campusInput, setCampusInput] = useState('')
  const [campuses, setCampuses] = useState<string[]>([])
  const [geometryText, setGeometryText] = useState(JSON.stringify(DEFAULT_GEOMETRY, null, 2))
  const [pages, setPages] = useState<(string | null)[]>([null, null])
  const [dateColLabel, setDateColLabel] = useState('Date / Time')
  const [notesColLabel, setNotesColLabel] = useState('Please sign each entry and print surname and designation')
  const [uploading, setUploading] = useState(false)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!user || user.uid !== ADMIN_UID) { router.replace('/'); return }
    fetchAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function call(body: Record<string, unknown>) {
    const token = user ? await user.getIdToken() : ''
    const res = await fetch('/api/admin/hospital-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? 'Request failed') }
    return res.json()
  }

  async function fetchAll() {
    setFetching(true); setError(null)
    try {
      const r = await call({ action: 'listForms' })
      setForms((r as { forms: HospitalFormDoc[] }).forms)
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') } finally { setFetching(false) }
  }

  function addCampus() {
    const v = campusInput.trim()
    if (!v) return
    if (!campuses.includes(v)) setCampuses(prev => [...prev, v])
    setCampusInput('')
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function pickPage(idx: number, file: File) {
    const dataUrl = await readFileAsDataUrl(file)
    setPages(prev => prev.map((p, i) => i === idx ? dataUrl : p))
  }

  function resetForm() {
    setName(''); setCampuses([]); setCampusInput('')
    setGeometryText(JSON.stringify(DEFAULT_GEOMETRY, null, 2))
    setPages([null, null]); setDateColLabel('Date / Time')
    setNotesColLabel('Please sign each entry and print surname and designation')
  }

  function editForm(f: HospitalFormDoc) {
    setName(f.name)
    setCampuses(f.organizationKeys)   // stored as keys; admin can re-add by name too
    setGeometryText(JSON.stringify(f.geometry, null, 2))
    setPages(f.pageBackgrounds.map(() => null))
    setDateColLabel(f.labels.dateCol)
    setNotesColLabel(f.labels.notesCol)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    setToast('Loaded — re-upload page images only if you want to replace them.')
  }

  async function handleUpload() {
    if (!name.trim()) { setToast('Form name required'); return }
    if (campuses.length === 0) { setToast('Add at least one campus'); return }
    let geometry: unknown
    try { geometry = JSON.parse(geometryText) } catch { setToast('Geometry is not valid JSON'); return }
    setUploading(true)
    try {
      await call({
        action: 'upload',
        name: name.trim(),
        organizationNames: campuses,
        geometry,
        labels: { dateCol: dateColLabel, notesCol: notesColLabel },
        pageDataUrls: pages,
      })
      setToast('Form saved')
      resetForm()
      fetchAll()
    } catch (e) { setToast(e instanceof Error ? e.message : 'Upload failed') } finally { setUploading(false) }
  }

  async function deleteForm(formKey: string, formName: string) {
    if (!window.confirm(`Delete form "${formName}"? This cannot be undone.`)) return
    setDeletingKey(formKey)
    try { await call({ action: 'deleteForm', formKey }); setForms(prev => prev.filter(f => f.formKey !== formKey)); setToast('Form deleted') }
    catch (e) { setToast(e instanceof Error ? e.message : 'Delete failed') } finally { setDeletingKey(null) }
  }

  if (loading) {
    return <div className="fixed inset-0 flex items-center justify-center bg-white"><svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
  }
  if (!user || user.uid !== ADMIN_UID) return null

  const card = { background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' } as const

  return (
    <div className="h-dvh overflow-y-auto bg-[#f8fafc]">
      <header className="flex items-center justify-between px-4" style={{ height: 52, background: 'linear-gradient(to right, #1d4ed8, #2563eb)', boxShadow: '0 2px 8px rgba(15,23,42,.12)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#5ad6a7] flex items-center justify-center shrink-0"><span className="text-white text-xs font-bold select-none">LN</span></div>
          <span className="text-white font-semibold text-sm select-none">Admin - Hospital Forms</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/letterheads" className="text-white/80 text-sm hover:text-white">Letterheads</Link>
          <button onClick={() => router.push('/generate')} className="text-white/80 text-sm hover:text-white">← App</button>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{error}<button onClick={fetchAll} className="ml-2 underline">Retry</button></div>}

        {/* Upload / edit form */}
        <div className="rounded-2xl p-5 space-y-4" style={card}>
          <h2 className="text-sm font-semibold text-[#0f172a]">Add / Update Form</h2>

          <div>
            <label className="text-xs font-medium text-[#475569]">Form name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. AWH Progress Notes (FAW0004)"
              className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
          </div>

          <div>
            <label className="text-xs font-medium text-[#475569]">Campuses that can use this form</label>
            <div className="flex gap-2 mt-1">
              <div className="flex-1"><HospitalAutocomplete label="" value={campusInput} onChange={setCampusInput} placeholder="Search a campus / workplace name" /></div>
              <button onClick={addCampus} className="shrink-0 px-3 rounded-lg bg-[#2563eb] text-white text-sm self-start py-2">Add</button>
            </div>
            {campuses.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {campuses.map(c => (
                  <span key={c} className="inline-flex items-center gap-1 text-xs bg-[#eff6ff] text-[#2563eb] rounded-full px-2 py-1">
                    {c}<button onClick={() => setCampuses(prev => prev.filter(x => x !== c))} aria-label="Remove">✕</button>
                  </span>
                ))}
              </div>
            )}
            <p className="text-[11px] text-[#94a3b8] mt-1">Campus names are slugged to org keys; a doctor sees the form when their active workplace matches.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-[#475569]">Date column label</label>
              <input value={dateColLabel} onChange={e => setDateColLabel(e.target.value)} className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[#475569]">Notes column label</label>
              <input value={notesColLabel} onChange={e => setNotesColLabel(e.target.value)} className="mt-1 w-full text-sm border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#475569]">Page background images (one full-page PNG per side, no lines removed)</label>
              <button onClick={() => setPages(prev => [...prev, null])} className="text-xs text-[#2563eb]">+ Add page</button>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-1">
              {pages.map((p, i) => (
                <PageSlot key={i} idx={i} preview={p} onPick={pickPage} onClear={() => setPages(prev => prev.map((x, j) => j === i ? null : x))} />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-[#475569]">Geometry (mm) — tune to match the uploaded background</label>
            <textarea value={geometryText} onChange={e => setGeometryText(e.target.value)} rows={12}
              className="mt-1 w-full text-xs font-mono border border-[var(--border)] rounded-lg px-3 py-2 bg-white outline-none focus:border-[#2563eb]" />
          </div>

          <div className="flex gap-2">
            <button onClick={handleUpload} disabled={uploading} className="flex-1 py-2.5 rounded-xl bg-[#2563eb] text-white text-sm font-semibold disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform">{uploading ? 'Saving…' : 'Save form'}</button>
            <button onClick={resetForm} className="px-4 rounded-xl border border-[var(--border)] text-sm text-[#475569]">Reset</button>
          </div>
        </div>

        {/* Existing forms */}
        {fetching ? (
          <div className="flex justify-center py-8"><svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></div>
        ) : forms.length === 0 ? (
          <p className="text-center text-[#94a3b8] text-sm py-6">No forms yet</p>
        ) : (
          <div className="space-y-3">
            {forms.map(f => (
              <div key={f.formKey} className="rounded-2xl p-4 space-y-3" style={card}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#0f172a] truncate">{f.name}</p>
                    <p className="text-xs text-[#94a3b8]">{f.formKey} · {f.pageBackgrounds.length} page(s)</p>
                    <p className="text-xs text-[#475569] mt-0.5">{f.organizationKeys.join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => editForm(f)} className="text-xs text-[#2563eb] font-medium px-2 py-1 rounded-lg hover:bg-[#eff6ff]">Edit</button>
                    <button onClick={() => deleteForm(f.formKey, f.name)} disabled={deletingKey === f.formKey} className="text-xs text-red-600 font-medium px-2 py-1 rounded-lg hover:bg-red-50 disabled:opacity-40">{deletingKey === f.formKey ? 'Deleting…' : 'Delete'}</button>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                  {f.pageBackgrounds.map((url, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} src={url} alt={`Page ${i + 1}`} className="h-24 rounded border border-[var(--border)] bg-white object-contain" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[#0f172a] text-white text-xs rounded-full px-4 py-2 pointer-events-none select-none">{toast}</div>}
    </div>
  )
}

function PageSlot({ idx, preview, onPick, onClear }: { idx: number; preview: string | null; onPick: (idx: number, file: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <p className="text-xs font-medium text-[#475569] mb-1">Page {idx + 1}</p>
      {preview ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt={`Page ${idx + 1}`} className="w-full rounded-lg border border-[var(--border)] object-contain max-h-32 bg-white" />
          <button onClick={onClear} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#0f172a]/60 text-white text-xs flex items-center justify-center" aria-label="Remove">✕</button>
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} className="w-full h-24 rounded-lg border-2 border-dashed border-[var(--border)] text-xs text-[#94a3b8] hover:border-[#2563eb] hover:text-[#2563eb] flex items-center justify-center">Choose PNG</button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onPick(idx, f) }} />
    </div>
  )
}
