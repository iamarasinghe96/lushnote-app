'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'

const ADMIN_UID = process.env.NEXT_PUBLIC_ADMIN_UID ?? ''

interface LetterheadRequest {
  id: string
  organizationKey: string
  organizationName: string
  requestedBy: string
  requestedByEmail: string
  requestedByName: string
  note: string
  headerUrl?: string | null
  footerUrl?: string | null
  status: 'pending' | 'done'
  createdAt: { seconds: number } | null
}

interface LetterheadDoc {
  id: string
  organizationKey: string
  organizationName: string
  headerUrl: string | null
  footerUrl: string | null
}

type Tab = 'requests' | 'letterheads'

export default function AdminLetterheadsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('requests')
  const [requests, setRequests] = useState<LetterheadRequest[]>([])
  const [letterheads, setLetterheads] = useState<LetterheadDoc[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Upload state
  const [uploadOrg, setUploadOrg] = useState('')
  const [headerPreview, setHeaderPreview] = useState<string | null>(null)
  const [footerPreview, setFooterPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const headerInputRef = useRef<HTMLInputElement>(null)
  const footerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loading) return
    if (!user || user.uid !== ADMIN_UID) { router.replace('/'); return }
    fetchAll()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  async function call(body: Record<string, unknown>) {
    const res = await fetch('/api/admin/letterhead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: user!.uid, ...body }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      throw new Error((j as { error?: string }).error ?? 'Request failed')
    }
    return res.json()
  }

  async function fetchAll() {
    setFetching(true)
    setError(null)
    try {
      const [rRes, lRes] = await Promise.all([
        call({ action: 'listRequests' }),
        call({ action: 'listLetterheads' }),
      ])
      setRequests((rRes as { requests: LetterheadRequest[] }).requests)
      setLetterheads((lRes as { letterheads: LetterheadDoc[] }).letterheads)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setFetching(false)
    }
  }

  async function markDone(requestId: string) {
    try {
      await call({ action: 'markDone', requestId })
      setRequests(prev => prev.map(r => r.id === requestId ? { ...r, status: 'done' } : r))
      setToast('Marked as done')
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Error')
    }
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleImagePick(slot: 'header' | 'footer', file: File) {
    const dataUrl = await readFileAsDataUrl(file)
    if (slot === 'header') setHeaderPreview(dataUrl)
    else setFooterPreview(dataUrl)
  }

  function prefillFromRequest(org: string) {
    setUploadOrg(org)
    setTab('letterheads')
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    setToast('Organisation name filled. Upload the cleaned-up images below.')
  }

  async function handleUpload() {
    if (!uploadOrg.trim()) { setToast('Organisation name required'); return }
    if (!headerPreview && !footerPreview) { setToast('Select at least one image'); return }
    setUploading(true)
    try {
      await call({
        action: 'upload',
        organizationName: uploadOrg.trim(),
        headerDataUrl: headerPreview,
        footerDataUrl: footerPreview,
      })
      setToast('Letterhead uploaded successfully')
      setUploadOrg('')
      setHeaderPreview(null)
      setFooterPreview(null)
      if (headerInputRef.current) headerInputRef.current.value = ''
      if (footerInputRef.current) footerInputRef.current.value = ''
      fetchAll()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-white">
        <svg width="32" height="32" viewBox="0 0 24 24" className="animate-spin text-[#10b981]" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
        </svg>
      </div>
    )
  }

  if (!user || user.uid !== ADMIN_UID) return null

  const pendingRequests = requests.filter(r => r.status === 'pending')
  const doneRequests = requests.filter(r => r.status === 'done')

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <header
        className="flex items-center justify-between px-4"
        style={{
          height: 52,
          background: 'linear-gradient(to right, #1d4ed8, #2563eb)',
          boxShadow: '0 2px 8px rgba(15,23,42,.12)',
        }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#5ad6a7] flex items-center justify-center shrink-0">
            <span className="text-white text-xs font-bold select-none">LN</span>
          </div>
          <span className="text-white font-semibold text-sm select-none">Admin - Letterheads</span>
        </div>
        <button
          onClick={() => router.push('/generate')}
          className="text-white/80 text-sm hover:text-white motion-safe:transition-colors"
        >
          ← Back to app
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
            <button onClick={fetchAll} className="ml-2 underline">Retry</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}>
          {(['requests', 'letterheads'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize motion-safe:transition-colors ${
                tab === t ? 'bg-[#2563eb] text-white' : 'text-[#475569] hover:text-[#0f172a]'
              }`}
            >
              {t === 'requests' ? `Requests${pendingRequests.length ? ` (${pendingRequests.length})` : ''}` : 'Letterheads'}
            </button>
          ))}
        </div>

        {fetching && (
          <div className="flex justify-center py-12">
            <svg width="24" height="24" viewBox="0 0 24 24" className="animate-spin text-[#2563eb]" aria-hidden>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
        )}

        {/* Requests tab */}
        {!fetching && tab === 'requests' && (
          <div className="space-y-4">
            {requests.length === 0 && (
              <p className="text-center text-[#94a3b8] text-sm py-12">No requests yet</p>
            )}
            {pendingRequests.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2">Pending</h2>
                <div className="space-y-3">
                  {pendingRequests.map(r => (
                    <RequestCard key={r.id} request={r} onMarkDone={markDone} onPrefill={prefillFromRequest} />
                  ))}
                </div>
              </div>
            )}
            {doneRequests.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-[#94a3b8] uppercase tracking-wide mb-2 mt-6">Done</h2>
                <div className="space-y-3">
                  {doneRequests.map(r => (
                    <RequestCard key={r.id} request={r} onMarkDone={markDone} onPrefill={prefillFromRequest} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Letterheads tab */}
        {!fetching && tab === 'letterheads' && (
          <div className="space-y-6">
            {/* Upload form */}
            <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}>
              <h2 className="text-sm font-semibold text-[#0f172a]">Upload / Update Letterhead</h2>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">Organisation name</label>
                <input
                  type="text"
                  value={uploadOrg}
                  onChange={e => setUploadOrg(e.target.value)}
                  placeholder="e.g. Royal Melbourne Hospital"
                  className="w-full border border-[var(--border)] rounded-xl px-3 py-2 text-sm bg-white text-[#0f172a] outline-none focus:ring-2 focus:ring-[#2563eb]/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <ImageSlot
                  label="Header image"
                  preview={headerPreview}
                  inputRef={headerInputRef}
                  onChange={file => handleImagePick('header', file)}
                  onClear={() => setHeaderPreview(null)}
                />
                <ImageSlot
                  label="Footer image"
                  preview={footerPreview}
                  inputRef={footerInputRef}
                  onChange={file => handleImagePick('footer', file)}
                  onClear={() => setFooterPreview(null)}
                />
              </div>

              <button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full py-2.5 rounded-xl bg-[#2563eb] text-white text-sm font-semibold disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform"
              >
                {uploading ? 'Uploading…' : 'Upload letterhead'}
              </button>
            </div>

            {/* Existing letterheads */}
            {letterheads.length === 0 && (
              <p className="text-center text-[#94a3b8] text-sm py-6">No letterheads uploaded yet</p>
            )}
            <div className="space-y-3">
              {letterheads.map(lh => (
                <div key={lh.id} className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}>
                  <div>
                    <p className="text-sm font-semibold text-[#0f172a]">{lh.organizationName}</p>
                    <p className="text-xs text-[#94a3b8]">{lh.organizationKey}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {lh.headerUrl ? (
                      <div>
                        <p className="text-xs text-[#475569] mb-1">Header</p>
                        <img src={lh.headerUrl} alt="Header" className="w-full rounded-lg border border-[var(--border)] object-contain max-h-20 bg-white" />
                      </div>
                    ) : <div className="text-xs text-[#94a3b8]">No header</div>}
                    {lh.footerUrl ? (
                      <div>
                        <p className="text-xs text-[#475569] mb-1">Footer</p>
                        <img src={lh.footerUrl} alt="Footer" className="w-full rounded-lg border border-[var(--border)] object-contain max-h-20 bg-white" />
                      </div>
                    ) : <div className="text-xs text-[#94a3b8]">No footer</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-[#0f172a] text-white text-xs rounded-full px-4 py-2 pointer-events-none select-none"
          style={{ boxShadow: '0 2px 8px rgba(15,23,42,.12)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function RequestCard({ request, onMarkDone, onPrefill }: {
  request: LetterheadRequest
  onMarkDone: (id: string) => void
  onPrefill: (org: string) => void
}) {
  const [marking, setMarking] = useState(false)
  const date = request.createdAt ? new Date(request.createdAt.seconds * 1000).toLocaleDateString('en-AU') : ''
  const hasAttachments = !!(request.headerUrl || request.footerUrl)

  async function handleMark() {
    setMarking(true)
    await onMarkDone(request.id)
    setMarking(false)
  }

  return (
    <div className="rounded-2xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 8px rgba(15,23,42,.06), 0 0 0 1px rgba(15,23,42,.04)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0f172a] truncate">{request.organizationName}</p>
          <p className="text-xs text-[#475569]">{request.requestedByName} &middot; {request.requestedByEmail}</p>
          {date && <p className="text-xs text-[#94a3b8]">{date}</p>}
        </div>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
          request.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'
        }`}>
          {request.status}
        </span>
      </div>
      {request.note && (
        <p className="text-xs text-[#475569] bg-[#f8fafc] rounded-lg px-3 py-2">{request.note}</p>
      )}

      {hasAttachments && (
        <div>
          <p className="text-[11px] font-medium text-[#94a3b8] mb-1">Attached by user (download &amp; clean up)</p>
          <div className="grid grid-cols-2 gap-2">
            {request.headerUrl && <RequestAttachment label="Header / top" url={request.headerUrl} />}
            {request.footerUrl && <RequestAttachment label="Footer / bottom" url={request.footerUrl} />}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 pt-1">
        <button
          onClick={() => onPrefill(request.organizationName)}
          className="text-xs text-[#2563eb] font-medium motion-safe:active:scale-95 motion-safe:transition-transform"
        >
          Prefill upload form →
        </button>
        {request.status === 'pending' && (
          <button
            onClick={handleMark}
            disabled={marking}
            className="text-xs text-[#475569] font-medium disabled:opacity-50 motion-safe:active:scale-95 motion-safe:transition-transform"
          >
            {marking ? 'Updating…' : 'Mark as done'}
          </button>
        )}
      </div>
    </div>
  )
}

function RequestAttachment({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block group">
      <p className="text-[11px] text-[#475569] mb-1">{label}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="w-full h-16 rounded-lg border border-[var(--border)] object-contain bg-white group-hover:border-[#2563eb] motion-safe:transition-colors" />
      <span className="text-[11px] text-[#2563eb] group-hover:underline">Open full size</span>
    </a>
  )
}

function ImageSlot({
  label,
  preview,
  inputRef,
  onChange,
  onClear,
}: {
  label: string
  preview: string | null
  inputRef: React.RefObject<HTMLInputElement>
  onChange: (file: File) => void
  onClear: () => void
}) {
  return (
    <div>
      <p className="text-xs font-medium text-[#475569] mb-1">{label}</p>
      {preview ? (
        <div className="relative">
          <img src={preview} alt={label} className="w-full rounded-lg border border-[var(--border)] object-contain max-h-24 bg-white" />
          <button
            onClick={onClear}
            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-[#0f172a]/60 text-white text-xs flex items-center justify-center"
            aria-label="Remove"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full h-20 rounded-lg border-2 border-dashed border-[var(--border)] text-xs text-[#94a3b8] hover:border-[#2563eb] hover:text-[#2563eb] motion-safe:transition-colors flex items-center justify-center"
        >
          Choose image
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onChange(f) }}
      />
    </div>
  )
}
